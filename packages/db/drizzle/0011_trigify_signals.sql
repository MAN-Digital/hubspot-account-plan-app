-- Trigify Stage A Task 1 — signal substrate: `signals`, `company_signal_map`,
-- `trigify_monitors`.
--
-- See packages/db/src/schema/{signals,company-signal-map,trigify-monitors}.ts
-- for column-level design notes. Mirrors OpenClaw's
-- `signal_records` / `company_aliases` / `monitors` tables
-- (.../outreach-engine/signal_store.py).
--
-- Hand-written (not drizzle-kit generated) to match the established pattern
-- for this package: migrations 0004-0010 are all hand-written SQL because
-- drizzle-kit's snapshot tracking stops at 0003_snapshot.json. Running
-- `drizzle-kit generate` against the current schema produces a stale diff
-- (it does not know about 0004-0010's schema changes), so every migration
-- since 0004 has been authored directly against the schema TS files instead.
--
-- RLS + hap_app grants follow 0007_rls_policies.sql and
-- 0010_least_privilege_app_role.sql exactly: current_setting('app.tenant_id')
-- for tenant isolation, FORCE ROW LEVEL SECURITY so table owners are not
-- exempt, and explicit hap_app DML grants (though 0010's
-- ALTER DEFAULT PRIVILEGES already covers future tables — the explicit
-- grants here are defense-in-depth / self-documentation for this migration).

CREATE TABLE IF NOT EXISTS "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"dedupe_key" text NOT NULL,
	"source" text NOT NULL,
	"stream" text NOT NULL,
	"signal_type" text NOT NULL,
	"signal_class" text NOT NULL,
	"tier" text NOT NULL,
	"level" text NOT NULL,
	"target_id" text NOT NULL,
	"linkedin_url" text,
	"hs_contact_id" text,
	"hs_company_id" text,
	"evidence_url" text,
	"evidence_date" timestamp with time zone,
	"observed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"allowed_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"copy_assertable" boolean DEFAULT true NOT NULL,
	"headline" text NOT NULL,
	"detail" text,
	"confidence" numeric NOT NULL,
	"raw" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "signals_tenant_dedupe_key_unique" UNIQUE("tenant_id","dedupe_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "signals" ADD CONSTRAINT "signals_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_tenant_company_idx" ON "signals" USING btree ("tenant_id","hs_company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_tenant_contact_idx" ON "signals" USING btree ("tenant_id","hs_contact_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "signals_tenant_observed_idx" ON "signals" USING btree ("tenant_id","observed_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "company_signal_map" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"linkedin_url" text,
	"domain" text,
	"hs_company_id" text NOT NULL,
	"confidence" numeric NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "company_signal_map" ADD CONSTRAINT "company_signal_map_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_signal_map_tenant_linkedin_idx" ON "company_signal_map" USING btree ("tenant_id","linkedin_url");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_signal_map_tenant_domain_idx" ON "company_signal_map" USING btree ("tenant_id","domain");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "company_signal_map_tenant_company_idx" ON "company_signal_map" USING btree ("tenant_id","hs_company_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "trigify_monitors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"monitor_type" text NOT NULL,
	"target_url" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"credits_spent" integer DEFAULT 0 NOT NULL,
	"config" jsonb,
	"subscribed_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trigify_monitors_tenant_type_target_unique" UNIQUE("tenant_id","monitor_type","target_url")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "trigify_monitors" ADD CONSTRAINT "trigify_monitors_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "trigify_monitors_tenant_status_idx" ON "trigify_monitors" USING btree ("tenant_id","status");
--> statement-breakpoint

-- RLS — tenant isolation, mirroring 0007_rls_policies.sql exactly.
ALTER TABLE "signals" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "signals" FORCE ROW LEVEL SECURITY;
CREATE POLICY "signals_tenant_select"
  ON "signals"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "signals_tenant_insert"
  ON "signals"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "company_signal_map" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "company_signal_map" FORCE ROW LEVEL SECURITY;
CREATE POLICY "company_signal_map_tenant_select"
  ON "company_signal_map"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "company_signal_map_tenant_insert"
  ON "company_signal_map"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "trigify_monitors" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "trigify_monitors" FORCE ROW LEVEL SECURITY;
CREATE POLICY "trigify_monitors_tenant_select"
  ON "trigify_monitors"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "trigify_monitors_tenant_insert"
  ON "trigify_monitors"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

-- hap_app least-privilege DML grants, mirroring 0010's explicit-grant style.
-- Redundant with 0010's ALTER DEFAULT PRIVILEGES (which already covers
-- tables created after 0010), but explicit here for defense-in-depth and
-- so this migration is independently correct if ever replayed in isolation.
GRANT SELECT, INSERT, UPDATE, DELETE ON "signals" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "company_signal_map" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "trigify_monitors" TO hap_app;
