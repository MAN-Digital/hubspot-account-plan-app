import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const hubspotSignalRules = pgTable(
  "hubspot_signal_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    enabled: boolean("enabled").notNull().default(true),
    eventType: text("event_type").notNull(),
    objectType: text("object_type").notNull(),
    propertyName: text("property_name"),
    condition: jsonb("condition").notNull().default(sql`'{}'::jsonb`),
    listId: text("list_id"),
    eventName: text("event_name"),
    signalType: text("signal_type").notNull(),
    level: text("level").notNull(),
    lookbackDays: integer("lookback_days").notNull().default(30),
    expiresAfterDays: integer("expires_after_days").notNull().default(30),
    createdByHubspotUserId: text("created_by_hubspot_user_id"),
    updatedByHubspotUserId: text("updated_by_hubspot_user_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("hubspot_signal_rules_tenant_enabled_idx").on(table.tenantId, table.enabled),
    index("hubspot_signal_rules_tenant_event_idx").on(table.tenantId, table.eventType),
  ],
);
