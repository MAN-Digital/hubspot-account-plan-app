import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const creditLedger = pgTable(
  "credit_ledger",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hubspotUserId: text("hubspot_user_id"),
    actionType: text("action_type").notNull(),
    entityRef: text("entity_ref").notNull(),
    deltaCredits: integer("delta_credits").notNull(),
    balanceAfter: integer("balance_after"),
    reason: text("reason"),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("credit_ledger_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("credit_ledger_tenant_action_idx").on(table.tenantId, table.actionType),
    index("credit_ledger_tenant_user_idx").on(table.tenantId, table.hubspotUserId),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hubspotUserId: text("hubspot_user_id"),
    actionType: text("action_type").notNull(),
    entityRef: text("entity_ref").notNull(),
    projectedCredits: integer("projected_credits").notNull().default(0),
    credits: integer("credits").notNull().default(0),
    result: text("result").notNull(),
    metadata: jsonb("metadata").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("usage_events_tenant_created_idx").on(table.tenantId, table.createdAt),
    index("usage_events_tenant_action_idx").on(table.tenantId, table.actionType),
    index("usage_events_tenant_user_idx").on(table.tenantId, table.hubspotUserId),
  ],
);

export const billingTopups = pgTable(
  "billing_topups",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    requestedByHubspotUserId: text("requested_by_hubspot_user_id"),
    packKey: text("pack_key").notNull(),
    credits: integer("credits").notNull(),
    amount: numeric("amount", { mode: "number" }).notNull(),
    currency: text("currency").notNull().default("USD"),
    provider: text("provider").notNull().default("stripe"),
    checkoutSessionId: text("checkout_session_id"),
    checkoutUrl: text("checkout_url"),
    status: text("status").notNull().default("pending"),
    ledgerRef: uuid("ledger_ref").references(() => creditLedger.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("billing_topups_tenant_status_idx").on(table.tenantId, table.status),
    index("billing_topups_tenant_requested_idx").on(table.tenantId, table.requestedByHubspotUserId),
  ],
);
