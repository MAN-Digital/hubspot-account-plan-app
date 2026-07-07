import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
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
    envelope: jsonb("envelope")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    cadence: jsonb("cadence").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    copy: jsonb("copy").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    qa: jsonb("qa").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
    status: text("status").notNull().default("draft"),
    approvedByHubspotUserId: text("approved_by_hubspot_user_id"),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
    exportedAt: timestamp("exported_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("outreach_drafts_tenant_company_idx").on(table.tenantId, table.companyId),
    index("outreach_drafts_tenant_status_idx").on(table.tenantId, table.status),
  ],
);
