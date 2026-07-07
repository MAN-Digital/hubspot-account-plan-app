import { sql } from "drizzle-orm";
import { index, integer, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hubspotUserId: text("hubspot_user_id"),
    entryType: text("entry_type").notNull(),
    actionType: text("action_type").notNull(),
    entityRef: text("entity_ref"),
    credits: integer("credits").notNull(),
    balanceAfter: integer("balance_after"),
    result: text("result").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("credit_ledger_tenant_user_idx").on(table.tenantId, table.hubspotUserId),
    index("credit_ledger_tenant_action_idx").on(table.tenantId, table.actionType),
    index("credit_ledger_tenant_created_idx").on(table.tenantId, table.createdAt),
  ],
);
