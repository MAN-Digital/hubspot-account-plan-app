-- 0012 — Supabase advisor fix (2026-07-07): close the public exposure of the
-- `tenants` table and turn off PostgREST access to the app schema entirely.
--
-- Background: 0007 deliberately skipped `tenants` (it is the bootstrap lookup
-- used BEFORE app.tenant_id exists), leaving relrowsecurity = false. Combined
-- with Supabase's default grants to `anon`/`authenticated`, that exposed the
-- table through the project's public REST endpoint (advisor:
-- rls_disabled_in_public).
--
-- Design:
--  * ENABLE RLS on tenants, but do NOT force it: the table owner (migration /
--    app connection role) keeps its natural owner bypass for the bootstrap
--    path and lifecycle writes, mirroring the pre-0012 behavior exactly.
--  * READ: `tenants` is a bootstrap LOOKUP table — every granted database role
--    may SELECT it (policy USING true). Tenant resolution, nonce sweeps, and
--    lifecycle flows all enumerate/subquery tenants BEFORE tenant context
--    exists, and non-bypass roles (hap_app, test roles) must keep seeing it.
--    Read protection comes from GRANTS (anon/authenticated are revoked below),
--    not from row filtering.
--  * WRITE: gated to `hap_app` (plus the owner's natural bypass).
--  * `anon`/`authenticated` get NO policy (default-deny) AND lose all grants
--    on every table/sequence in public — this app never serves PostgREST.
--    Guarded: those roles only exist on Supabase, not on local dev Postgres.
-- Hand-written like 0004-0011 (drizzle-kit snapshot tracking stops at 0003).

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint

DROP POLICY IF EXISTS "tenants_app_role_all" ON "tenants";
--> statement-breakpoint
DROP POLICY IF EXISTS "tenants_read_all" ON "tenants";
--> statement-breakpoint
CREATE POLICY "tenants_read_all"
  ON "tenants"
  FOR SELECT
  USING (true);
--> statement-breakpoint
DROP POLICY IF EXISTS "tenants_app_role_write" ON "tenants";
--> statement-breakpoint
CREATE POLICY "tenants_app_role_write"
  ON "tenants"
  FOR ALL
  TO hap_app
  USING (true)
  WITH CHECK (true);
--> statement-breakpoint

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON ALL TABLES IN SCHEMA public FROM authenticated;
    REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;
  END IF;
END
$$;
