import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const accountResearch = pgTable(
  "account_research",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    status: text("status").notNull().default("ready"),
    sections: jsonb("sections").notNull().default(sql`'{}'::jsonb`),
    sources: jsonb("sources").notNull().default(sql`'[]'::jsonb`),
    generatedByHubspotUserId: text("generated_by_hubspot_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("account_research_tenant_company_idx").on(table.tenantId, table.companyId),
    index("account_research_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const accountDataGaps = pgTable(
  "account_data_gaps",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    gapType: text("gap_type").notNull(),
    propertyName: text("property_name"),
    label: text("label").notNull(),
    severity: text("severity").notNull().default("medium"),
    status: text("status").notNull().default("open"),
    ownerHubspotUserId: text("owner_hubspot_user_id"),
    ownerName: text("owner_name"),
    impact: text("impact"),
    suggestedAction: text("suggested_action"),
    projectedCredits: integer("projected_credits").notNull().default(0),
    source: text("source").notNull().default("hubspot"),
    resolutionRef: text("resolution_ref"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("account_data_gaps_tenant_company_idx").on(table.tenantId, table.companyId),
    index("account_data_gaps_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const accountGenerationRuns = pgTable(
  "account_generation_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    requestedByHubspotUserId: text("requested_by_hubspot_user_id"),
    trigger: text("trigger").notNull().default("workspace"),
    requestedScopeItems: jsonb("requested_scope_items").notNull().default(sql`'[]'::jsonb`),
    peopleConstraints: jsonb("people_constraints").notNull().default(sql`'{}'::jsonb`),
    projectedCreditMin: integer("projected_credit_min").notNull().default(0),
    projectedCreditMax: integer("projected_credit_max").notNull().default(0),
    debitedCredits: integer("debited_credits").notNull().default(0),
    returnedOutputCounts: jsonb("returned_output_counts").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("requested"),
    blockers: jsonb("blockers").notNull().default(sql`'[]'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("account_generation_runs_tenant_company_idx").on(table.tenantId, table.companyId),
    index("account_generation_runs_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const accountGenerationLineItems = pgTable(
  "account_generation_line_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => accountGenerationRuns.id, { onDelete: "cascade" }),
    module: text("module").notNull(),
    projectedCreditMin: integer("projected_credit_min").notNull().default(0),
    projectedCreditMax: integer("projected_credit_max").notNull().default(0),
    debitedCredits: integer("debited_credits").notNull().default(0),
    outputRef: text("output_ref"),
    outputCount: integer("output_count").notNull().default(0),
    providerRef: text("provider_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("account_generation_line_items_tenant_run_idx").on(table.tenantId, table.runId),
    index("account_generation_line_items_tenant_module_idx").on(table.tenantId, table.module),
  ],
);
