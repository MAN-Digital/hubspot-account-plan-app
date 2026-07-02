# Runbook — Least-privilege database role (C1 RLS enforcement)

## Why

The RLS policies in `packages/db/drizzle/0007_rls_policies.sql` are the
database-level tenant boundary. **They are inert whenever the connecting role is
a superuser or carries `BYPASSRLS`.** The Supabase project pooler role
`postgres.<project-ref>` is both, so connecting the production app as that role
silently disables every tenant-isolation policy — tenant isolation then rests on
application-level `where tenant_id = …` filtering alone.

Migration `0010_least_privilege_app_role.sql` provisions `hap_app`, a
`NOSUPERUSER` / `NOBYPASSRLS` role with exactly the DML the app needs. This
runbook is the operator half: give it a password, and repoint the production
`DATABASE_URL` at it.

The code half is already shipped:

- `apps/api/src/lib/db-role-guard.ts` — `assertDbRoleEnforcesRls` fails `/api/*`
  closed in production if the connected role bypasses RLS.
- OAuth callback + lifecycle deactivation now set `app.tenant_id` on their
  writes, so they work correctly under a non-bypass role.

## Preconditions

- Migration `0010` has been applied to the target database (creates `hap_app`,
  `NOLOGIN`, with grants). Verify:
  ```sql
  select rolname, rolsuper, rolbypassrls, rolcanlogin
  from pg_roles where rolname = 'hap_app';
  -- expect: hap_app | f | f | f
  ```

## Steps (production)

1. **Set a strong password and enable login** (run in the Supabase SQL editor as
   `postgres`; the password never enters the repo):

   ```sql
   alter role hap_app with login password '<generate-a-strong-secret>';
   ```

2. **Build the pooler connection string.** Supabase's Supavisor pooler requires
   the project ref appended to the username: `hap_app.<project-ref>`. For this
   project the ref is `ucjpzljcppxsxtclnbdj`, so:

   ```
   postgresql://hap_app.ucjpzljcppxsxtclnbdj:<password>@aws-0-eu-west-1.pooler.supabase.com:5432/postgres
   ```

3. **Repoint the production `DATABASE_URL`** to that string in Vercel
   (Production scope only), then redeploy:

   ```
   vercel env rm DATABASE_URL production
   vercel env add DATABASE_URL production   # paste the hap_app URL
   ```

   Keep migrations running as `postgres` (they need DDL) — only the _runtime_
   `DATABASE_URL` switches to `hap_app`.

4. **Verify enforcement after deploy.** The boot guard runs on the first
   authenticated `/api/*` request; a bypass role now yields a 5xx instead of
   silently serving data. Confirm the role directly:
   ```sql
   -- connected as hap_app:
   select current_user, rolsuper, rolbypassrls
   from pg_roles where rolname = current_user;
   -- expect: hap_app | f | f
   ```
   Then smoke-test an install (OAuth callback writes `tenant_hubspot_oauth`) and
   an uninstall (lifecycle deletes it) to confirm the tenant-scoped writes work.

## Break-glass

If you must temporarily run the app under a bypass role (e.g. an incident),
set `HAP_ALLOW_DB_SUPERUSER=true` to downgrade the boot guard from throw to warn.
Remove it as soon as the least-privilege role is restored.

## Related: rotate the exposed production secrets (audit H1)

The production `.env` held live trust-root secrets on disk. Rotate and move them
to Vercel encrypted env / a secrets manager — do not keep production values on
any developer machine:

- `ROOT_KEK` — derives every tenant KEK; rotate via the versioned-envelope
  rollover in `apps/api/src/lib/encryption.ts` (new key version, re-wrap, retire).
- `SUPABASE_SERVICE_ROLE_KEY` — regenerate in the Supabase dashboard. Note it is
  no longer part of the app env (audit M1); application access uses `hap_app`.
- `HUBSPOT_CLIENT_SECRET` / `HUBSPOT_APP_CLIENT_SECRET` — rotate in the HubSpot
  app settings.
- `INTERNAL_BOOTSTRAP_TOKEN`, `CRON_SECRET`, `HUBSPOT_DEV_PORTAL_TOKEN` —
  regenerate.
