-- 0013 — V2 Stage B schema foundation.
--
-- Adds tenant-scoped storage for the account workspace expansion:
-- account research, outreach drafts/config, buying groups, notifications,
-- app-level team/RBAC, credit usage, and warm-intro records.
--
-- Hand-written like 0004-0012 (drizzle-kit snapshot tracking stops at 0003).
-- Every table is tenant-owned, cascades on tenant deletion, has RLS enabled
-- and forced, and grants DML only to the least-privilege hap_app role.

CREATE TABLE IF NOT EXISTS "account_research" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "status" text DEFAULT 'pending' NOT NULL,
  "sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "generated_by" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_by_hubspot_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_research" ADD CONSTRAINT "account_research_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_research_tenant_company_idx" ON "account_research" USING btree ("tenant_id","company_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "snapshot_id" uuid,
  "envelope" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "cadence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "copy" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "qa" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "approved_by_hubspot_user_id" text,
  "approved_at" timestamp with time zone,
  "exported_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_drafts" ADD CONSTRAINT "outreach_drafts_snapshot_id_snapshots_id_fk" FOREIGN KEY ("snapshot_id") REFERENCES "public"."snapshots"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_drafts_tenant_company_idx" ON "outreach_drafts" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_drafts_tenant_status_idx" ON "outreach_drafts" USING btree ("tenant_id","status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "positioning" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "vocabulary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "frameworks" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "angles" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "export_provider" text,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_config_tenant_unique" UNIQUE("tenant_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_config" ADD CONSTRAINT "outreach_config_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "buying_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "deal_id" text,
  "roles" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "edits" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "buying_groups" ADD CONSTRAINT "buying_groups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buying_groups_tenant_company_idx" ON "buying_groups" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "buying_groups_tenant_deal_idx" ON "buying_groups" USING btree ("tenant_id","deal_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "notification_settings" (
  "tenant_id" uuid PRIMARY KEY NOT NULL,
  "enabled" boolean DEFAULT false NOT NULL,
  "property_writes_enabled" boolean DEFAULT false NOT NULL,
  "min_tier" text DEFAULT 'A' NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "tenant_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "hubspot_user_id" text NOT NULL,
  "email" text NOT NULL,
  "first_name" text,
  "last_name" text,
  "app_role" text DEFAULT 'rep' NOT NULL,
  "app_access_enabled" boolean DEFAULT false NOT NULL,
  "credit_cap" integer,
  "period_start" timestamp with time zone DEFAULT now() NOT NULL,
  "settings" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "last_synced_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "tenant_users_tenant_hubspot_user_unique" UNIQUE("tenant_id","hubspot_user_id")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "tenant_users" ADD CONSTRAINT "tenant_users_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_users_tenant_role_idx" ON "tenant_users" USING btree ("tenant_id","app_role");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "tenant_users_tenant_access_idx" ON "tenant_users" USING btree ("tenant_id","app_access_enabled");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "hubspot_user_id" text,
  "entry_type" text NOT NULL,
  "action_type" text NOT NULL,
  "entity_ref" text,
  "credits" integer NOT NULL,
  "balance_after" integer,
  "result" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "credit_ledger" ADD CONSTRAINT "credit_ledger_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_tenant_user_idx" ON "credit_ledger" USING btree ("tenant_id","hubspot_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_tenant_action_idx" ON "credit_ledger" USING btree ("tenant_id","action_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_tenant_created_idx" ON "credit_ledger" USING btree ("tenant_id","created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "hubspot_user_id" text NOT NULL,
  "action_type" text NOT NULL,
  "entity_type" text,
  "entity_id" text,
  "credits" integer DEFAULT 0 NOT NULL,
  "result" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_tenant_user_idx" ON "usage_events" USING btree ("tenant_id","hubspot_user_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_tenant_action_idx" ON "usage_events" USING btree ("tenant_id","action_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_tenant_created_idx" ON "usage_events" USING btree ("tenant_id","created_at");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "warm_intros" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "target_contact_id" text NOT NULL,
  "mutual_connections" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "intro_requests" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "warm_intros" ADD CONSTRAINT "warm_intros_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warm_intros_tenant_company_idx" ON "warm_intros" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "warm_intros_tenant_target_idx" ON "warm_intros" USING btree ("tenant_id","target_contact_id");
--> statement-breakpoint

ALTER TABLE "account_research" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_research" FORCE ROW LEVEL SECURITY;
CREATE POLICY "account_research_tenant_select"
  ON "account_research"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "account_research_tenant_insert"
  ON "account_research"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "outreach_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_drafts" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outreach_drafts_tenant_select"
  ON "outreach_drafts"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "outreach_drafts_tenant_insert"
  ON "outreach_drafts"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "outreach_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_config" FORCE ROW LEVEL SECURITY;
CREATE POLICY "outreach_config_tenant_select"
  ON "outreach_config"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "outreach_config_tenant_insert"
  ON "outreach_config"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "buying_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "buying_groups" FORCE ROW LEVEL SECURITY;
CREATE POLICY "buying_groups_tenant_select"
  ON "buying_groups"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "buying_groups_tenant_insert"
  ON "buying_groups"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "notification_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "notification_settings" FORCE ROW LEVEL SECURITY;
CREATE POLICY "notification_settings_tenant_select"
  ON "notification_settings"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "notification_settings_tenant_insert"
  ON "notification_settings"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "tenant_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;
CREATE POLICY "tenant_users_tenant_select"
  ON "tenant_users"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_users_tenant_insert"
  ON "tenant_users"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_ledger" FORCE ROW LEVEL SECURITY;
CREATE POLICY "credit_ledger_tenant_select"
  ON "credit_ledger"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "credit_ledger_tenant_insert"
  ON "credit_ledger"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_events" FORCE ROW LEVEL SECURITY;
CREATE POLICY "usage_events_tenant_select"
  ON "usage_events"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "usage_events_tenant_insert"
  ON "usage_events"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

ALTER TABLE "warm_intros" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warm_intros" FORCE ROW LEVEL SECURITY;
CREATE POLICY "warm_intros_tenant_select"
  ON "warm_intros"
  FOR ALL
  USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "warm_intros_tenant_insert"
  ON "warm_intros"
  FOR INSERT
  WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "account_research" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_drafts" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_config" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "buying_groups" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "notification_settings" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_users" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "credit_ledger" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_events" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "warm_intros" TO hap_app;
