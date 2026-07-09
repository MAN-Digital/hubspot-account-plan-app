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
    email: text("email"),
    name: text("name"),
    appRole: text("app_role").notNull().default("rep"),
    appAccessEnabled: boolean("app_access_enabled").notNull().default(true),
    dailyCreditCap: integer("daily_credit_cap"),
    weeklyCreditCap: integer("weekly_credit_cap"),
    monthlyCreditCap: integer("monthly_credit_cap"),
    uncapped: boolean("uncapped").notNull().default(false),
    capPeriodState: jsonb("cap_period_state").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("tenant_users_tenant_hubspot_user_unique").on(table.tenantId, table.hubspotUserId),
    index("tenant_users_tenant_role_idx").on(table.tenantId, table.appRole),
  ],
);
