import { sql } from "drizzle-orm";
import { index, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

export const warmIntros = pgTable(
  "warm_intros",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    companyId: text("company_id").notNull(),
    targetContactId: text("target_contact_id").notNull(),
    mutualConnections: jsonb("mutual_connections")
      .$type<unknown[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    introRequests: jsonb("intro_requests").$type<unknown[]>().notNull().default(sql`'[]'::jsonb`),
    status: text("status").notNull().default("draft"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("warm_intros_tenant_company_idx").on(table.tenantId, table.companyId),
    index("warm_intros_tenant_target_idx").on(table.tenantId, table.targetContactId),
  ],
);
