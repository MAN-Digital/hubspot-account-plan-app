import { sql } from "drizzle-orm";
import { boolean, index, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { snapshots } from "./snapshots.js";
import { tenants } from "./tenants.js";

export const outreachDrafts = pgTable(
  "outreach_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    snapshotId: uuid("snapshot_id").references(() => snapshots.id, { onDelete: "set null" }),
    angleKey: text("angle_key"),
    includedPeople: jsonb("included_people").notNull().default(sql`'[]'::jsonb`),
    envelope: jsonb("envelope").notNull().default(sql`'{}'::jsonb`),
    cadence: jsonb("cadence").notNull().default(sql`'{}'::jsonb`),
    copy: jsonb("copy").notNull().default(sql`'{}'::jsonb`),
    qa: jsonb("qa").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("draft"),
    approvedBy: text("approved_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outreach_drafts_tenant_company_idx").on(table.tenantId, table.companyId),
    index("outreach_drafts_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const outreachCampaigns = pgTable(
  "outreach_campaigns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    provider: text("provider").notNull().default("woodpecker"),
    externalCampaignId: text("external_campaign_id"),
    angleKey: text("angle_key"),
    primarySignalKey: text("primary_signal_key"),
    primarySignalHeadline: text("primary_signal_headline"),
    channelVariant: text("channel_variant").notNull().default("email"),
    name: text("name").notNull(),
    status: text("status").notNull().default("draft"),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdByHubspotUserId: text("created_by_hubspot_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outreach_campaigns_tenant_company_idx").on(table.tenantId, table.companyId),
    index("outreach_campaigns_tenant_provider_idx").on(table.tenantId, table.provider),
  ],
);

export const outreachCampaignMembers = pgTable(
  "outreach_campaign_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    campaignId: uuid("campaign_id")
      .notNull()
      .references(() => outreachCampaigns.id, { onDelete: "cascade" }),
    contactId: text("contact_id"),
    personKey: text("person_key").notNull(),
    draftId: uuid("draft_id").references(() => outreachDrafts.id, { onDelete: "set null" }),
    externalProspectId: text("external_prospect_id"),
    snippets: jsonb("snippets").notNull().default(sql`'{}'::jsonb`),
    customFields: jsonb("custom_fields").notNull().default(sql`'{}'::jsonb`),
    exportStatus: text("export_status").notNull().default("pending"),
    addedByHubspotUserId: text("added_by_hubspot_user_id"),
    addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("outreach_campaign_members_tenant_campaign_person_unique").on(
      table.tenantId,
      table.campaignId,
      table.personKey,
    ),
    index("outreach_campaign_members_tenant_campaign_idx").on(table.tenantId, table.campaignId),
    index("outreach_campaign_members_tenant_contact_idx").on(table.tenantId, table.contactId),
  ],
);

export const outreachConfig = pgTable(
  "outreach_config",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    positioning: jsonb("positioning").notNull().default(sql`'{}'::jsonb`),
    vocabulary: jsonb("vocabulary").notNull().default(sql`'{}'::jsonb`),
    frameworks: jsonb("frameworks").notNull().default(sql`'{}'::jsonb`),
    exportProvider: text("export_provider"),
    settings: jsonb("settings").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [unique("outreach_config_tenant_unique").on(table.tenantId)],
);

export const outreachAngles = pgTable(
  "outreach_angles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    angleKey: text("angle_key").notNull(),
    name: text("name").notNull(),
    goal: text("goal").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    targetPersonas: jsonb("target_personas").notNull().default(sql`'[]'::jsonb`),
    channels: jsonb("channels").notNull().default(sql`'[]'::jsonb`),
    frameworks: jsonb("frameworks").notNull().default(sql`'[]'::jsonb`),
    tone: text("tone"),
    guardrails: jsonb("guardrails").notNull().default(sql`'{}'::jsonb`),
    disallowedClaims: jsonb("disallowed_claims").notNull().default(sql`'[]'::jsonb`),
    qaRules: jsonb("qa_rules").notNull().default(sql`'[]'::jsonb`),
    cadenceTemplate: jsonb("cadence_template").notNull().default(sql`'{}'::jsonb`),
    enabledForReps: boolean("enabled_for_reps").notNull().default(true),
    createdByHubspotUserId: text("created_by_hubspot_user_id"),
    updatedByHubspotUserId: text("updated_by_hubspot_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("outreach_angles_tenant_key_unique").on(table.tenantId, table.angleKey),
    index("outreach_angles_tenant_enabled_idx").on(table.tenantId, table.enabled),
  ],
);
