import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const buyingGroups = pgTable(
  "buying_groups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    dealId: text("deal_id"),
    roles: jsonb("roles").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    edits: jsonb("edits").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("buying_groups_tenant_company_idx").on(table.tenantId, table.companyId),
    index("buying_groups_tenant_deal_idx").on(table.tenantId, table.dealId),
  ],
);
