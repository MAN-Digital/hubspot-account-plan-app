#!/usr/bin/env node
/**
 * One-command local test-database bootstrap: `pnpm test:db:up`.
 *
 * Idempotent. Safe to run repeatedly. Does four things, in order:
 *   1. `docker compose up -d postgres` — start the local Postgres service.
 *   2. Wait for the container healthcheck to report healthy.
 *   3. Create `.env.test.local` from `.env.test.example` if it is missing.
 *   4. Run Drizzle migrations against the local test DB (`pnpm db:migrate`),
 *      which reads the same `.env` chain and therefore targets the local DB.
 *
 * This exists so a fresh machine goes from clone to green tests with a single
 * command, instead of hitting 129 cryptic `loadEnv()` guard throws and then
 * following manual runbook steps. See docs/runbooks/local-test-database.md.
 *
 * NOT used in CI: CI provisions its own postgres service container and applies
 * migrations in the workflow (.github/workflows/ci.yml). This script is a
 * local-developer convenience only.
 */
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "..");

const COMPOSE_SERVICE = "postgres";
const CONTAINER_NAME = "hap-postgres";
const HEALTH_TIMEOUT_MS = 60_000;
const HEALTH_POLL_MS = 2_000;

function log(msg) {
  process.stdout.write(`[test:db:up] ${msg}\n`);
}

function fail(msg) {
  process.stderr.write(`[test:db:up] ERROR: ${msg}\n`);
  process.exit(1);
}

function run(cmd, args, opts = {}) {
  const res = spawnSync(cmd, args, { cwd: repoRoot, encoding: "utf8", ...opts });
  return res;
}

/** Resolve `docker compose` (v2 plugin) or `docker-compose` (v1 standalone). */
function resolveCompose() {
  const v2 = run("docker", ["compose", "version"], { stdio: "ignore" });
  if (v2.status === 0) return { cmd: "docker", base: ["compose"] };
  const v1 = run("docker-compose", ["version"], { stdio: "ignore" });
  if (v1.status === 0) return { cmd: "docker-compose", base: [] };
  fail(
    "Docker Compose not found. Install Docker Desktop (or the docker compose " +
      "plugin) and ensure the Docker daemon is running.",
  );
  return null; // unreachable
}

function dockerDaemonUp() {
  const res = run("docker", ["info"], { stdio: "ignore" });
  return res.status === 0;
}

/** Poll `docker inspect` until the container health status is "healthy". */
function waitForHealthy() {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  let lastStatus = "unknown";
  while (Date.now() < deadline) {
    const res = run("docker", [
      "inspect",
      "-f",
      "{{if .State.Health}}{{.State.Health.Status}}{{else}}no-healthcheck{{end}}",
      CONTAINER_NAME,
    ]);
    lastStatus = (res.stdout || "").trim();
    if (lastStatus === "healthy") return true;
    if (lastStatus === "no-healthcheck") {
      // No healthcheck defined — fall back to a short settle wait.
      log("container has no healthcheck; waiting 3s for it to settle");
      spawnSync("sleep", ["3"]);
      return true;
    }
    log(`waiting for ${CONTAINER_NAME} to become healthy (status: ${lastStatus})`);
    spawnSync("sleep", [String(HEALTH_POLL_MS / 1000)]);
  }
  fail(
    `${CONTAINER_NAME} did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s ` +
      `(last status: ${lastStatus}). Check \`docker compose logs ${COMPOSE_SERVICE}\`.`,
  );
  return false; // unreachable
}

function ensureEnvTestLocal() {
  const target = join(repoRoot, ".env.test.local");
  const example = join(repoRoot, ".env.test.example");
  if (existsSync(target)) {
    log(".env.test.local already exists — leaving it untouched");
    return;
  }
  if (!existsSync(example)) {
    fail(".env.test.example is missing; cannot scaffold .env.test.local");
  }
  copyFileSync(example, target);
  log("created .env.test.local from .env.test.example");
}

function runMigrations() {
  log("applying Drizzle migrations to the local test DB (pnpm db:migrate)");
  const res = run("pnpm", ["db:migrate"], { stdio: "inherit" });
  if (res.status !== 0) {
    fail("pnpm db:migrate failed — see output above");
  }
}

function main() {
  if (!dockerDaemonUp()) {
    fail("Docker daemon is not running. Start Docker Desktop and retry.");
  }
  const compose = resolveCompose();

  log(`starting ${COMPOSE_SERVICE} service`);
  const up = run(compose.cmd, [...compose.base, "up", "-d", COMPOSE_SERVICE], {
    stdio: "inherit",
  });
  if (up.status !== 0) fail("`docker compose up -d postgres` failed");

  waitForHealthy();
  ensureEnvTestLocal();
  runMigrations();

  log("done — local test DB is up and migrated. Run `pnpm test`.");
}

main();
