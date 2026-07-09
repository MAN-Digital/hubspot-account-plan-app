-- 0013 — V2 account-workspace backend foundation.
--
-- Hand-written to match migrations 0004-0012. These tables are tenant-scoped
-- substrate for the Stage B workspace: credit/audit logs, account generation,
-- people prospecting, outreach drafts/campaign reuse, buying groups, HubSpot
-- signal rules, settings, billing top-ups, and warm-intro storage.

CREATE TABLE IF NOT EXISTS "tenant_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "hubspot_user_id" text NOT NULL,
  "email" text,
  "name" text,
  "app_role" text DEFAULT 'rep' NOT NULL,
  "app_access_enabled" boolean DEFAULT true NOT NULL,
  "daily_credit_cap" integer,
  "weekly_credit_cap" integer,
  "monthly_credit_cap" integer,
  "uncapped" boolean DEFAULT false NOT NULL,
  "cap_period_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
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

CREATE TABLE IF NOT EXISTS "credit_ledger" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "hubspot_user_id" text,
  "action_type" text NOT NULL,
  "entity_ref" text NOT NULL,
  "delta_credits" integer NOT NULL,
  "balance_after" integer,
  "reason" text,
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
CREATE INDEX IF NOT EXISTS "credit_ledger_tenant_created_idx" ON "credit_ledger" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_tenant_action_idx" ON "credit_ledger" USING btree ("tenant_id","action_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "credit_ledger_tenant_user_idx" ON "credit_ledger" USING btree ("tenant_id","hubspot_user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "usage_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "hubspot_user_id" text,
  "action_type" text NOT NULL,
  "entity_ref" text NOT NULL,
  "projected_credits" integer DEFAULT 0 NOT NULL,
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
CREATE INDEX IF NOT EXISTS "usage_events_tenant_created_idx" ON "usage_events" USING btree ("tenant_id","created_at");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_tenant_action_idx" ON "usage_events" USING btree ("tenant_id","action_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "usage_events_tenant_user_idx" ON "usage_events" USING btree ("tenant_id","hubspot_user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "billing_topups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "requested_by_hubspot_user_id" text,
  "pack_key" text NOT NULL,
  "credits" integer NOT NULL,
  "amount" numeric NOT NULL,
  "currency" text DEFAULT 'USD' NOT NULL,
  "provider" text DEFAULT 'stripe' NOT NULL,
  "checkout_session_id" text,
  "checkout_url" text,
  "status" text DEFAULT 'pending' NOT NULL,
  "ledger_ref" uuid,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_topups" ADD CONSTRAINT "billing_topups_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "billing_topups" ADD CONSTRAINT "billing_topups_ledger_ref_credit_ledger_id_fk" FOREIGN KEY ("ledger_ref") REFERENCES "public"."credit_ledger"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_topups_tenant_status_idx" ON "billing_topups" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "billing_topups_tenant_requested_idx" ON "billing_topups" USING btree ("tenant_id","requested_by_hubspot_user_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "account_research" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "status" text DEFAULT 'ready' NOT NULL,
  "sections" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "sources" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "generated_by_hubspot_user_id" text,
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
CREATE INDEX IF NOT EXISTS "account_research_tenant_status_idx" ON "account_research" USING btree ("tenant_id","status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "account_data_gaps" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "gap_type" text NOT NULL,
  "property_name" text,
  "label" text NOT NULL,
  "severity" text DEFAULT 'medium' NOT NULL,
  "status" text DEFAULT 'open' NOT NULL,
  "owner_hubspot_user_id" text,
  "owner_name" text,
  "impact" text,
  "suggested_action" text,
  "projected_credits" integer DEFAULT 0 NOT NULL,
  "source" text DEFAULT 'hubspot' NOT NULL,
  "resolution_ref" text,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_data_gaps" ADD CONSTRAINT "account_data_gaps_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_data_gaps_tenant_company_idx" ON "account_data_gaps" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_data_gaps_tenant_status_idx" ON "account_data_gaps" USING btree ("tenant_id","status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "account_generation_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "requested_by_hubspot_user_id" text,
  "trigger" text DEFAULT 'workspace' NOT NULL,
  "requested_scope_items" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "people_constraints" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "projected_credit_min" integer DEFAULT 0 NOT NULL,
  "projected_credit_max" integer DEFAULT 0 NOT NULL,
  "debited_credits" integer DEFAULT 0 NOT NULL,
  "returned_output_counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_generation_runs" ADD CONSTRAINT "account_generation_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_generation_runs_tenant_company_idx" ON "account_generation_runs" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_generation_runs_tenant_status_idx" ON "account_generation_runs" USING btree ("tenant_id","status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "account_generation_line_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "module" text NOT NULL,
  "projected_credit_min" integer DEFAULT 0 NOT NULL,
  "projected_credit_max" integer DEFAULT 0 NOT NULL,
  "debited_credits" integer DEFAULT 0 NOT NULL,
  "output_ref" text,
  "output_count" integer DEFAULT 0 NOT NULL,
  "provider_ref" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_generation_line_items" ADD CONSTRAINT "account_generation_line_items_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "account_generation_line_items" ADD CONSTRAINT "acct_gen_line_items_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."account_generation_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_generation_line_items_tenant_run_idx" ON "account_generation_line_items" USING btree ("tenant_id","run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "account_generation_line_items_tenant_module_idx" ON "account_generation_line_items" USING btree ("tenant_id","module");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "people_prospecting_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "requested_by_hubspot_user_id" text,
  "source_mode" text DEFAULT 'apollo_harvest' NOT NULL,
  "max_contacts" integer NOT NULL,
  "filters" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "provider_requests" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'requested' NOT NULL,
  "projected_credit_min" integer DEFAULT 0 NOT NULL,
  "projected_credit_max" integer DEFAULT 0 NOT NULL,
  "debited_credits" integer DEFAULT 0 NOT NULL,
  "blocker_state" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_prospecting_runs" ADD CONSTRAINT "people_prospecting_runs_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_prospecting_runs_tenant_company_idx" ON "people_prospecting_runs" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_prospecting_runs_tenant_status_idx" ON "people_prospecting_runs" USING btree ("tenant_id","status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "people_prospecting_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "run_id" uuid NOT NULL,
  "provider" text NOT NULL,
  "provider_person_id" text,
  "hubspot_contact_id" text,
  "first_name" text,
  "last_name" text,
  "title" text,
  "company" text,
  "location" text,
  "linkedin_url" text,
  "email_status" text,
  "required_field_completeness" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "evidence_refs" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "duplicate_match" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'previewed' NOT NULL,
  "accepted_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_prospecting_candidates" ADD CONSTRAINT "people_prospecting_candidates_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "people_prospecting_candidates" ADD CONSTRAINT "people_prospecting_candidates_run_fk" FOREIGN KEY ("run_id") REFERENCES "public"."people_prospecting_runs"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_prospecting_candidates_tenant_run_idx" ON "people_prospecting_candidates" USING btree ("tenant_id","run_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_prospecting_candidates_tenant_status_idx" ON "people_prospecting_candidates" USING btree ("tenant_id","status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "people_prospecting_candidates_tenant_hs_contact_idx" ON "people_prospecting_candidates" USING btree ("tenant_id","hubspot_contact_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_drafts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "snapshot_id" uuid,
  "angle_key" text,
  "included_people" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "envelope" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "cadence" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "copy" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "qa" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "approved_by" text,
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

CREATE TABLE IF NOT EXISTS "outreach_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "provider" text DEFAULT 'woodpecker' NOT NULL,
  "external_campaign_id" text,
  "angle_key" text,
  "primary_signal_key" text,
  "primary_signal_headline" text,
  "channel_variant" text DEFAULT 'email' NOT NULL,
  "name" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "last_synced_at" timestamp with time zone,
  "created_by_hubspot_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_campaigns" ADD CONSTRAINT "outreach_campaigns_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_campaigns_tenant_company_idx" ON "outreach_campaigns" USING btree ("tenant_id","company_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_campaigns_tenant_provider_idx" ON "outreach_campaigns" USING btree ("tenant_id","provider");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_campaign_members" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "contact_id" text,
  "person_key" text NOT NULL,
  "draft_id" uuid,
  "external_prospect_id" text,
  "snippets" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "export_status" text DEFAULT 'pending' NOT NULL,
  "added_by_hubspot_user_id" text,
  "added_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_campaign_members_tenant_campaign_person_unique" UNIQUE("tenant_id","campaign_id","person_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_campaign_members" ADD CONSTRAINT "outreach_campaign_members_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_campaign_members" ADD CONSTRAINT "outreach_campaign_members_campaign_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."outreach_campaigns"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_campaign_members" ADD CONSTRAINT "outreach_campaign_members_draft_id_outreach_drafts_id_fk" FOREIGN KEY ("draft_id") REFERENCES "public"."outreach_drafts"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_campaign_members_tenant_campaign_idx" ON "outreach_campaign_members" USING btree ("tenant_id","campaign_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_campaign_members_tenant_contact_idx" ON "outreach_campaign_members" USING btree ("tenant_id","contact_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "outreach_config" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "positioning" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "vocabulary" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "frameworks" jsonb DEFAULT '{}'::jsonb NOT NULL,
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

CREATE TABLE IF NOT EXISTS "outreach_angles" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "angle_key" text NOT NULL,
  "name" text NOT NULL,
  "goal" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "target_personas" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "channels" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "frameworks" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "tone" text,
  "guardrails" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "disallowed_claims" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "qa_rules" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "cadence_template" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "enabled_for_reps" boolean DEFAULT true NOT NULL,
  "created_by_hubspot_user_id" text,
  "updated_by_hubspot_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "outreach_angles_tenant_key_unique" UNIQUE("tenant_id","angle_key")
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "outreach_angles" ADD CONSTRAINT "outreach_angles_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "outreach_angles_tenant_enabled_idx" ON "outreach_angles" USING btree ("tenant_id","enabled");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "buying_groups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "deal_id" text,
  "role_slots" jsonb DEFAULT '[]'::jsonb NOT NULL,
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

CREATE TABLE IF NOT EXISTS "hubspot_signal_rules" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "name" text NOT NULL,
  "enabled" boolean DEFAULT true NOT NULL,
  "event_type" text NOT NULL,
  "object_type" text NOT NULL,
  "property_name" text,
  "condition" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "list_id" text,
  "event_name" text,
  "signal_type" text NOT NULL,
  "level" text NOT NULL,
  "lookback_days" integer DEFAULT 30 NOT NULL,
  "expires_after_days" integer DEFAULT 30 NOT NULL,
  "created_by_hubspot_user_id" text,
  "updated_by_hubspot_user_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "hubspot_signal_rules" ADD CONSTRAINT "hubspot_signal_rules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hubspot_signal_rules_tenant_enabled_idx" ON "hubspot_signal_rules" USING btree ("tenant_id","enabled");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "hubspot_signal_rules_tenant_event_idx" ON "hubspot_signal_rules" USING btree ("tenant_id","event_type");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "warm_intros" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" uuid NOT NULL,
  "company_id" text NOT NULL,
  "mutual_connections" jsonb DEFAULT '[]'::jsonb NOT NULL,
  "intro_requests" jsonb DEFAULT '[]'::jsonb NOT NULL,
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

-- RLS — tenant isolation, matching the policy pattern from 0011.
ALTER TABLE "tenant_users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "tenant_users" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "tenant_users_tenant_select" ON "tenant_users";
DROP POLICY IF EXISTS "tenant_users_tenant_insert" ON "tenant_users";
CREATE POLICY "tenant_users_tenant_select" ON "tenant_users" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "tenant_users_tenant_insert" ON "tenant_users" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "credit_ledger" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "credit_ledger" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "credit_ledger_tenant_select" ON "credit_ledger";
DROP POLICY IF EXISTS "credit_ledger_tenant_insert" ON "credit_ledger";
CREATE POLICY "credit_ledger_tenant_select" ON "credit_ledger" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "credit_ledger_tenant_insert" ON "credit_ledger" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "usage_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "usage_events" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "usage_events_tenant_select" ON "usage_events";
DROP POLICY IF EXISTS "usage_events_tenant_insert" ON "usage_events";
CREATE POLICY "usage_events_tenant_select" ON "usage_events" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "usage_events_tenant_insert" ON "usage_events" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "billing_topups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "billing_topups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "billing_topups_tenant_select" ON "billing_topups";
DROP POLICY IF EXISTS "billing_topups_tenant_insert" ON "billing_topups";
CREATE POLICY "billing_topups_tenant_select" ON "billing_topups" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "billing_topups_tenant_insert" ON "billing_topups" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "account_research" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_research" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_research_tenant_select" ON "account_research";
DROP POLICY IF EXISTS "account_research_tenant_insert" ON "account_research";
CREATE POLICY "account_research_tenant_select" ON "account_research" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "account_research_tenant_insert" ON "account_research" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "account_data_gaps" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_data_gaps" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_data_gaps_tenant_select" ON "account_data_gaps";
DROP POLICY IF EXISTS "account_data_gaps_tenant_insert" ON "account_data_gaps";
CREATE POLICY "account_data_gaps_tenant_select" ON "account_data_gaps" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "account_data_gaps_tenant_insert" ON "account_data_gaps" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "account_generation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_generation_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_generation_runs_tenant_select" ON "account_generation_runs";
DROP POLICY IF EXISTS "account_generation_runs_tenant_insert" ON "account_generation_runs";
CREATE POLICY "account_generation_runs_tenant_select" ON "account_generation_runs" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "account_generation_runs_tenant_insert" ON "account_generation_runs" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "account_generation_line_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "account_generation_line_items" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "account_generation_line_items_tenant_select" ON "account_generation_line_items";
DROP POLICY IF EXISTS "account_generation_line_items_tenant_insert" ON "account_generation_line_items";
CREATE POLICY "account_generation_line_items_tenant_select" ON "account_generation_line_items" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "account_generation_line_items_tenant_insert" ON "account_generation_line_items" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "people_prospecting_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "people_prospecting_runs" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "people_prospecting_runs_tenant_select" ON "people_prospecting_runs";
DROP POLICY IF EXISTS "people_prospecting_runs_tenant_insert" ON "people_prospecting_runs";
CREATE POLICY "people_prospecting_runs_tenant_select" ON "people_prospecting_runs" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "people_prospecting_runs_tenant_insert" ON "people_prospecting_runs" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "people_prospecting_candidates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "people_prospecting_candidates" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "people_prospecting_candidates_tenant_select" ON "people_prospecting_candidates";
DROP POLICY IF EXISTS "people_prospecting_candidates_tenant_insert" ON "people_prospecting_candidates";
CREATE POLICY "people_prospecting_candidates_tenant_select" ON "people_prospecting_candidates" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "people_prospecting_candidates_tenant_insert" ON "people_prospecting_candidates" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "outreach_drafts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_drafts" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "outreach_drafts_tenant_select" ON "outreach_drafts";
DROP POLICY IF EXISTS "outreach_drafts_tenant_insert" ON "outreach_drafts";
CREATE POLICY "outreach_drafts_tenant_select" ON "outreach_drafts" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "outreach_drafts_tenant_insert" ON "outreach_drafts" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "outreach_campaigns" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_campaigns" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "outreach_campaigns_tenant_select" ON "outreach_campaigns";
DROP POLICY IF EXISTS "outreach_campaigns_tenant_insert" ON "outreach_campaigns";
CREATE POLICY "outreach_campaigns_tenant_select" ON "outreach_campaigns" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "outreach_campaigns_tenant_insert" ON "outreach_campaigns" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "outreach_campaign_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_campaign_members" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "outreach_campaign_members_tenant_select" ON "outreach_campaign_members";
DROP POLICY IF EXISTS "outreach_campaign_members_tenant_insert" ON "outreach_campaign_members";
CREATE POLICY "outreach_campaign_members_tenant_select" ON "outreach_campaign_members" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "outreach_campaign_members_tenant_insert" ON "outreach_campaign_members" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "outreach_config" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_config" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "outreach_config_tenant_select" ON "outreach_config";
DROP POLICY IF EXISTS "outreach_config_tenant_insert" ON "outreach_config";
CREATE POLICY "outreach_config_tenant_select" ON "outreach_config" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "outreach_config_tenant_insert" ON "outreach_config" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "outreach_angles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outreach_angles" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "outreach_angles_tenant_select" ON "outreach_angles";
DROP POLICY IF EXISTS "outreach_angles_tenant_insert" ON "outreach_angles";
CREATE POLICY "outreach_angles_tenant_select" ON "outreach_angles" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "outreach_angles_tenant_insert" ON "outreach_angles" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "buying_groups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "buying_groups" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "buying_groups_tenant_select" ON "buying_groups";
DROP POLICY IF EXISTS "buying_groups_tenant_insert" ON "buying_groups";
CREATE POLICY "buying_groups_tenant_select" ON "buying_groups" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "buying_groups_tenant_insert" ON "buying_groups" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "hubspot_signal_rules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "hubspot_signal_rules" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "hubspot_signal_rules_tenant_select" ON "hubspot_signal_rules";
DROP POLICY IF EXISTS "hubspot_signal_rules_tenant_insert" ON "hubspot_signal_rules";
CREATE POLICY "hubspot_signal_rules_tenant_select" ON "hubspot_signal_rules" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "hubspot_signal_rules_tenant_insert" ON "hubspot_signal_rules" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint
ALTER TABLE "warm_intros" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "warm_intros" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "warm_intros_tenant_select" ON "warm_intros";
DROP POLICY IF EXISTS "warm_intros_tenant_insert" ON "warm_intros";
CREATE POLICY "warm_intros_tenant_select" ON "warm_intros" FOR ALL USING ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
CREATE POLICY "warm_intros_tenant_insert" ON "warm_intros" FOR INSERT WITH CHECK ("tenant_id" = current_setting('app.tenant_id', true)::uuid);
--> statement-breakpoint

GRANT SELECT, INSERT, UPDATE, DELETE ON "tenant_users" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "credit_ledger" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "usage_events" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "billing_topups" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "account_research" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "account_data_gaps" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "account_generation_runs" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "account_generation_line_items" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "people_prospecting_runs" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "people_prospecting_candidates" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_drafts" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_campaigns" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_campaign_members" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_config" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "outreach_angles" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "buying_groups" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "hubspot_signal_rules" TO hap_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "warm_intros" TO hap_app;
