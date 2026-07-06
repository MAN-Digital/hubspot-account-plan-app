/**
 * Vitest globalSetup — fail-fast test-environment preflight.
 *
 * Runs ONCE per suite (not per file), before any test file or setupFile.
 * Its whole job is to convert the two common misconfigurations into a single
 * actionable error instead of 100+ cryptic stack traces:
 *
 *   1. DATABASE_URL points at a managed/pooler host while ALLOW_TEST_AUTH is
 *      on — `loadEnv()` in packages/config/src/env.ts refuses this (audit M2,
 *      PR #52) and every test that loads env throws the same wall of text.
 *   2. DATABASE_URL is local but the DB is unreachable or un-migrated — every
 *      DB-touching test fails deep in postgres.js with a connection/relation
 *      error.
 *
 * Design constraints:
 *   - Fast (<1s on a configured machine): one dotenv resolution + one TCP query.
 *   - Never invokes docker. It only inspects and connects.
 *   - Does NOT import or modify the env.ts guard. It re-checks the same
 *     `.pooler.supabase.com` hostname heuristic locally so the two stay
 *     independent (the guard remains the single source of truth at runtime).
 *   - CI-safe: in CI, DATABASE_URL is a real process env var (localhost,
 *     hap_test) and migrations are applied by the workflow before `pnpm test`,
 *     so both checks pass with no overhead.
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

const here = dirname(fileURLToPath(import.meta.url));
const RUNBOOK = "docs/runbooks/local-test-database.md";
const FIX = "run `pnpm test:db:up` (see " + RUNBOOK + ")";

/** Mirror of vitest.setup.ts / drizzle.config.ts main-repo-root resolver. */
function resolveMainRepoRoot(start: string): string {
  const gitPath = join(start, ".git");
  if (!existsSync(gitPath)) return start;
  if (statSync(gitPath).isDirectory()) return start;
  const contents = readFileSync(gitPath, "utf8");
  const match = contents.match(/^gitdir:\s*(.+)$/m);
  if (!match) return start;
  return resolve(dirname(dirname(dirname(match[1].trim()))));
}

/**
 * Compute the effective env the test workers will see. Mirrors the exact load
 * order in vitest.setup.ts: main-repo `.env`, worktree `.env`, then
 * `.env.test.local` with override. A pre-set process.env var (e.g. CI's
 * DATABASE_URL) is preserved unless `.env.test.local` overrides it — same as
 * the workers.
 */
function resolveEffectiveEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  const mainRoot = resolveMainRepoRoot(here);
  const candidates = [join(mainRoot, ".env"), join(here, ".env"), join(here, ".env.test.local")];
  for (const path of candidates) {
    if (!existsSync(path)) continue;
    const override = path.endsWith(".env.test.local");
    config({ path, processEnv: env, override });
  }
  // Match vitest.setup.ts TEST_DEFAULTS fallback for a bare CI checkout.
  if (!env.DATABASE_URL) {
    env.DATABASE_URL = "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";
  }
  if (!env.ALLOW_TEST_AUTH) env.ALLOW_TEST_AUTH = "true";
  if (!env.NODE_ENV) env.NODE_ENV = "test";
  return env;
}

function isManagedHost(hostname: string): boolean {
  return hostname.toLowerCase().endsWith(".pooler.supabase.com");
}

export async function setup(): Promise<void> {
  const env = resolveEffectiveEnv();

  const rawUrl = env.DATABASE_URL;
  if (!rawUrl) {
    throw new Error(`[test-env] DATABASE_URL is not set. Tests need a local Postgres — ${FIX}.`);
  }

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`[test-env] DATABASE_URL is not a valid URL — ${FIX}.`);
  }

  // Check (a): managed host + test-auth is the forbidden combination.
  const testAuthOn = env.ALLOW_TEST_AUTH === "true" && env.NODE_ENV === "test";
  if (testAuthOn && isManagedHost(url.hostname)) {
    throw new Error(
      `[test-env] DATABASE_URL points at a managed production host ` +
        `(${url.hostname}) while ALLOW_TEST_AUTH=true. The test suite must run ` +
        `against a LOCAL Postgres — the env.ts guard (PR #52) refuses this ` +
        `combination to prevent tenant impersonation over production data.\n` +
        `Fix: ${FIX}.`,
    );
  }

  // Check (b): local URL must be reachable AND migrated. Cheap: one query for
  // the drizzle journal table. Import postgres.js lazily so a config-only
  // failure above never pays the connection cost.
  const { default: postgres } = await import("postgres");
  const sql = postgres(rawUrl, {
    max: 1,
    connect_timeout: 5,
    idle_timeout: 1,
    // Local dev DBs and the CI service container are plaintext.
    ssl: rawUrl.includes("sslmode=require") ? "require" : false,
    onnotice: () => {},
  });
  try {
    const rows = await sql`
      SELECT to_regclass('drizzle.__drizzle_migrations') AS journal,
             to_regclass('public.tenants') AS tenants
    `;
    const { journal, tenants } = rows[0] as {
      journal: string | null;
      tenants: string | null;
    };
    if (!journal || !tenants) {
      throw new Error(
        `[test-env] Connected to ${url.hostname}:${url.port || "5432"} but the ` +
          `schema is not migrated (missing ${!journal ? "drizzle journal" : "tenants table"}).\n` +
          `Fix: ${FIX}.`,
      );
    }
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("[test-env]")) throw err;
    // postgres.js connection errors sometimes carry an empty `message` but a
    // useful `code` (e.g. ECONNREFUSED / CONNECT_TIMEOUT). Prefer whichever is
    // non-empty so the operator always sees a cause.
    const errObj = err as { message?: string; code?: string } | undefined;
    const reason = errObj?.message || errObj?.code || String(err) || "connection failed";
    throw new Error(
      `[test-env] Cannot reach the local test database at ` +
        `${url.hostname}:${url.port || "5432"} (${reason}).\n` +
        `Is the container running? Fix: ${FIX}.`,
    );
  } finally {
    await sql.end({ timeout: 5 });
  }
}
