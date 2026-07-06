# Local Test Database

The test suite must run against a **local** Postgres, not the managed
Supabase pooler. This is a security constraint, not a convenience:
`loadEnv()` in `packages/config/src/env.ts` refuses to start when
`ALLOW_TEST_AUTH=true` (which the tests require) is combined with a
`*.pooler.supabase.com` `DATABASE_URL` host, because test-auth bypasses
HubSpot signature/replay verification and would allow arbitrary tenant
impersonation over production data (audit finding M2, PR #52). Do **not**
weaken that guard — point the tests at a local DB instead.

## One-time setup

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

- **`ALLOW_TEST_AUTH=true is forbidden against a managed production
database`** — your `DATABASE_URL` still resolves to the pooler. Confirm
  `.env.test.local` exists at the repo root and contains the local
  `DATABASE_URL`.
- **`permission denied to set role hap_app`** — migrations have not been
  applied to the local DB (the role does not exist). Run `pnpm db:migrate`.
- **`docker exec hap-postgres psql ...` shows an empty DB** — inspect over
  TCP instead (`psql postgresql://hap:hap_local_dev@localhost:5433/hap_dev`);
  the host port is the reliable target.
