-- 0014 — Make the V2 workspace foundation additive for environments that
-- previously ran an early partial copy of the same tables.
--
-- 0013 is the canonical fresh schema. These ALTERs only add or relax columns
-- needed to converge older local/dev databases without dropping data.

ALTER TABLE "tenant_users" ADD COLUMN IF NOT EXISTS "name" text;
--> statement-breakpoint
ALTER TABLE "tenant_users" ADD COLUMN IF NOT EXISTS "daily_credit_cap" integer;
--> statement-breakpoint
ALTER TABLE "tenant_users" ADD COLUMN IF NOT EXISTS "weekly_credit_cap" integer;
--> statement-breakpoint
ALTER TABLE "tenant_users" ADD COLUMN IF NOT EXISTS "monthly_credit_cap" integer;
--> statement-breakpoint
ALTER TABLE "tenant_users" ADD COLUMN IF NOT EXISTS "uncapped" boolean DEFAULT false NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_users" ADD COLUMN IF NOT EXISTS "cap_period_state" jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_users" ALTER COLUMN "email" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "tenant_users" ALTER COLUMN "app_access_enabled" SET DEFAULT true;
--> statement-breakpoint

ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "delta_credits" integer;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_ledger' AND column_name = 'credits'
  ) THEN
    UPDATE "credit_ledger"
    SET "delta_credits" = COALESCE("delta_credits", "credits", 0)
    WHERE "delta_credits" IS NULL;
  ELSE
    UPDATE "credit_ledger"
    SET "delta_credits" = 0
    WHERE "delta_credits" IS NULL;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "credit_ledger" ALTER COLUMN "delta_credits" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "credit_ledger" ADD COLUMN IF NOT EXISTS "reason" text;
--> statement-breakpoint
UPDATE "credit_ledger"
SET "entity_ref" = COALESCE("entity_ref", 'legacy')
WHERE "entity_ref" IS NULL;
--> statement-breakpoint
ALTER TABLE "credit_ledger" ALTER COLUMN "entity_ref" SET NOT NULL;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_ledger' AND column_name = 'entry_type'
  ) THEN
    ALTER TABLE "credit_ledger" ALTER COLUMN "entry_type" DROP NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_ledger' AND column_name = 'credits'
  ) THEN
    ALTER TABLE "credit_ledger" ALTER COLUMN "credits" DROP NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'credit_ledger' AND column_name = 'result'
  ) THEN
    ALTER TABLE "credit_ledger" ALTER COLUMN "result" DROP NOT NULL;
  END IF;
END $$;
--> statement-breakpoint

ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "entity_ref" text;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'usage_events' AND column_name = 'entity_id'
  ) THEN
    UPDATE "usage_events"
    SET "entity_ref" = COALESCE("entity_ref", "entity_id", 'legacy')
    WHERE "entity_ref" IS NULL;
  ELSE
    UPDATE "usage_events"
    SET "entity_ref" = 'legacy'
    WHERE "entity_ref" IS NULL;
  END IF;
END $$;
--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "entity_ref" SET NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_events" ADD COLUMN IF NOT EXISTS "projected_credits" integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE "usage_events" ALTER COLUMN "hubspot_user_id" DROP NOT NULL;
--> statement-breakpoint

ALTER TABLE "account_research" ADD COLUMN IF NOT EXISTS "generated_by_hubspot_user_id" text;
--> statement-breakpoint
ALTER TABLE "account_research" ALTER COLUMN "status" SET DEFAULT 'ready';
--> statement-breakpoint

ALTER TABLE "outreach_drafts" ADD COLUMN IF NOT EXISTS "angle_key" text;
--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD COLUMN IF NOT EXISTS "included_people" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE "outreach_drafts" ADD COLUMN IF NOT EXISTS "approved_by" text;
--> statement-breakpoint

ALTER TABLE "buying_groups" ADD COLUMN IF NOT EXISTS "role_slots" jsonb DEFAULT '[]'::jsonb NOT NULL;
--> statement-breakpoint

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'warm_intros' AND column_name = 'target_contact_id'
  ) THEN
    ALTER TABLE "warm_intros" ALTER COLUMN "target_contact_id" DROP NOT NULL;
  END IF;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'warm_intros' AND column_name = 'status'
  ) THEN
    ALTER TABLE "warm_intros" ALTER COLUMN "status" DROP NOT NULL;
  END IF;
END $$;
