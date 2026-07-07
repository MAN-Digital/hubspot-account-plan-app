import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const tenantUsers = pgTable(
  "tenant_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    hubspotUserId: text("hubspot_user_id").notNull(),
    email: text("email").notNull(),
    firstName: text("first_name"),
    lastName: text("last_name"),
    appRole: text("app_role").notNull().default("rep"),
    appAccessEnabled: boolean("app_access_enabled").notNull().default(false),
    creditCap: integer("credit_cap"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull().defaultNow(),
    settings: jsonb("settings")
      .$type<Record<string, unknown>>()
      .notNull()
      .default(sql`'{}'::jsonb`),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("tenant_users_tenant_hubspot_user_unique").on(table.tenantId, table.hubspotUserId),
    index("tenant_users_tenant_role_idx").on(table.tenantId, table.appRole),
    index("tenant_users_tenant_access_idx").on(table.tenantId, table.appAccessEnabled),
  ],
);
