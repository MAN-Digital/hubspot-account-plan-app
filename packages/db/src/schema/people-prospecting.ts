import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const peopleProspectingRuns = pgTable(
  "people_prospecting_runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    requestedByHubspotUserId: text("requested_by_hubspot_user_id"),
    sourceMode: text("source_mode").notNull().default("apollo_harvest"),
    maxContacts: integer("max_contacts").notNull(),
    filters: jsonb("filters").notNull().default(sql`'{}'::jsonb`),
    providerRequests: jsonb("provider_requests").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("requested"),
    projectedCreditMin: integer("projected_credit_min").notNull().default(0),
    projectedCreditMax: integer("projected_credit_max").notNull().default(0),
    debitedCredits: integer("debited_credits").notNull().default(0),
    blockerState: jsonb("blocker_state").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [
    index("people_prospecting_runs_tenant_company_idx").on(table.tenantId, table.companyId),
    index("people_prospecting_runs_tenant_status_idx").on(table.tenantId, table.status),
  ],
);

export const peopleProspectingCandidates = pgTable(
  "people_prospecting_candidates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    runId: uuid("run_id")
      .notNull()
      .references(() => peopleProspectingRuns.id, { onDelete: "cascade" }),
    provider: text("provider").notNull(),
    providerPersonId: text("provider_person_id"),
    hubspotContactId: text("hubspot_contact_id"),
    firstName: text("first_name"),
    lastName: text("last_name"),
    title: text("title"),
    company: text("company"),
    location: text("location"),
    linkedinUrl: text("linkedin_url"),
    emailStatus: text("email_status"),
    requiredFieldCompleteness: jsonb("required_field_completeness")
      .notNull()
      .default(sql`'{}'::jsonb`),
    evidenceRefs: jsonb("evidence_refs").notNull().default(sql`'[]'::jsonb`),
    duplicateMatch: jsonb("duplicate_match").notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("previewed"),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("people_prospecting_candidates_tenant_run_idx").on(table.tenantId, table.runId),
    index("people_prospecting_candidates_tenant_status_idx").on(table.tenantId, table.status),
    index("people_prospecting_candidates_tenant_hs_contact_idx").on(
      table.tenantId,
      table.hubspotContactId,
    ),
  ],
);
