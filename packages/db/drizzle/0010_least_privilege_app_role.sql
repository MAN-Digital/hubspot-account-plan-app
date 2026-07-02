-- C1 — Least-privilege application role for RLS enforcement.
--
-- The RLS policies in 0007_rls_policies.sql only take effect when the
-- connecting role neither is a superuser nor carries BYPASSRLS. The Supabase
-- project `postgres.<ref>` pooler role is BOTH, so connecting the production
-- app as that role silently defeats every tenant-isolation policy.
--
-- This migration provisions `hap_app`: a NOSUPERUSER / NOBYPASSRLS role with
-- exactly the table DML the application needs and nothing more. It is created
-- NOLOGIN on purpose — the operator sets a password and enables login
-- out-of-band (secret never lives in the repo), then repoints the production
-- DATABASE_URL at this role. See docs/runbooks/least-privilege-db-role.md.
--
-- Idempotent: safe to run against an environment where the role already exists
-- (e.g. re-applied migrations, shared Supabase project).

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'hap_app') THEN
    CREATE ROLE hap_app NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END
$$;
--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO hap_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO hap_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO hap_app;
--> statement-breakpoint

-- Future tables/sequences created by the migration role are granted to hap_app
-- automatically, so new domain tables inherit least-privilege access without a
-- follow-up grant migration.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO hap_app;
--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO hap_app;
