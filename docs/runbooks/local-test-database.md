# Local Test Database

The test suite must run against a **local** Postgres, not the managed
Supabase pooler. This is a security constraint, not a convenience:
`loadEnv()` in `packages/config/src/env.ts` refuses to start when
`ALLOW_TEST_AUTH=true` (which the tests require) is combined with a
`*.pooler.supabase.com` `DATABASE_URL` host, because test-auth bypasses
HubSpot signature/replay verification and would allow arbitrary tenant
impersonation over production data (audit finding M2, PR #52). Do **not**
weaken that guard — point the tests at a local DB instead.

## TL;DR

```bash
pnpm test:db:up   # once per machine (idempotent — safe to re-run)
pnpm test         # forever after
```

`pnpm test:db:up` starts the local Postgres, waits for it to be healthy,
scaffolds `.env.test.local` from `.env.test.example` if missing, and applies
all migrations. After that, `pnpm test` just works.

If the DB is misconfigured, the suite fails fast with **one** actionable
error (from `vitest.globalSetup.ts`) instead of 100+ stack traces — the
error names the problem and tells you to run `pnpm test:db:up`.

The manual steps below are the same thing broken out, for when you want to
understand or debug what the one-command script does.

## One-time setup (manual equivalent)

1. **Start the local Postgres** defined in `docker-compose.yml` (service
   `postgres`, container `hap-postgres`, host port **5433**, user `hap`,
   password `hap_local_dev`, database `hap_dev`):

   ```bash
   docker compose up -d postgres
   ```

2. **Create `.env.test.local`** at the repo root (gitignored via
   `.gitignore` `.env.*`). Copy `.env.test.example` and keep the local
   `DATABASE_URL` line:

   ```bash
   cp .env.test.example .env.test.local
   ```

   `vitest.setup.ts` and `packages/db/drizzle.config.ts` both load
   `.env` first, then `.env.test.local` with `override: true`, so this
   file's `DATABASE_URL` wins over the repo-root managed URL for tests and
   for `pnpm db:migrate` alike.

3. **Apply all migrations** to the local DB. Because `db:migrate` reads
   the same env chain, running it from the repo root targets the local
   container automatically:

   ```bash
   pnpm db:migrate
   ```

   Migration `0010_least_privilege_app_role.sql` creates the `hap_app`
   role (NOSUPERUSER / NOBYPASSRLS) that the RLS tests switch into with
   `SET LOCAL ROLE hap_app`. The local `hap` user is a superuser, so it
   may `SET ROLE hap_app` without an explicit membership grant — no extra
   grant migration is needed.

## Verify

```bash
psql "postgresql://hap:hap_local_dev@localhost:5433/hap_dev" -c \
  "SET ROLE hap_app; SELECT current_user; RESET ROLE;"
```

`current_user` should report `hap_app`. Then run the suite:

```bash
pnpm test
```

## Troubleshooting

- **`[test-env] DATABASE_URL points at a managed production host ...`** — the
  fail-fast preflight caught a pooler URL. Run `pnpm test:db:up` (or ensure
  `.env.test.local` exists with the local `DATABASE_URL`).
- **`[test-env] ... schema is not migrated`** — the local DB is reachable but
  empty. Run `pnpm test:db:up` (or `pnpm db:migrate`).
- **`[test-env] Cannot reach the local test database ...`** — the container
  isn't running. Run `pnpm test:db:up` (or `docker compose up -d postgres`).
- **`permission denied to set role hap_app`** — migrations have not been
  applied to the local DB (the role does not exist). Run `pnpm db:migrate`.
- **`docker exec hap-postgres psql ...` shows an empty DB** — inspect over
  TCP instead (`psql postgresql://hap:hap_local_dev@localhost:5433/hap_dev`);
  the host port is the reliable target.

## CI

CI does **not** use this script. The `.github/workflows/ci.yml` test job
provisions its own `postgres:16` service container
(`hap:hap_ci@localhost:5432/hap_test`), sets `DATABASE_URL` to it via job
env, runs `pnpm db:migrate`, then `pnpm test`. The globalSetup preflight
runs there too and passes: `localhost` is not a managed host and migrations
are applied before the suite. No docker steps are added to CI by this
tooling.
