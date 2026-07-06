import { index, integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * `trigify_monitors` — per-tenant subscription / credit-spend ledger.
 *
 * Mirrors OpenClaw's `monitors` table (`.../outreach-engine/signal_store.py`)
 * and backs the spend gate ported from `trigify_monitors.py` (Task 9):
 * dry-run preview by default, explicit confirm to spend credits, budget
 * ceiling, duplicate-monitor detection, and an audit trail of confirmed
 * spends. Subscribing a monitor is the ONLY credit-spend path in the whole
 * Trigify integration — the poller (Task 6) only reads the free feed.
 *
 * `monitorType` is the Trigify `MonitoringType` enum value (e.g.
 * `linkedin-profile`, `linkedin-posts`, `reddit-posts`, ... — see
 * `references/signal-types.md` "Monitoring source enum").
 * `targetUrl` is the subscribed LinkedIn/social URL.
 * `status` is `"pending" | "active" | "paused" | "deleted"` (managed by
 * monitor-manager.ts, not enforced at the DB layer as a CHECK — the
 * TypeScript service layer owns the state machine).
 * `creditsSpent` tracks cumulative spend for the budget-ceiling check.
 * `config` is a jsonb bag for monitor-specific filters (topics, cadence)
 * mirroring the Trigify subscription body shape.
 */
export const trigifyMonitors = pgTable(
  "trigify_monitors",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    monitorType: text("monitor_type").notNull(),
    targetUrl: text("target_url").notNull(),
    status: text("status").notNull().default("pending"),
    creditsSpent: integer("credits_spent").notNull().default(0),
    config: jsonb("config").$type<Record<string, unknown>>(),
    subscribedAt: timestamp("subscribed_at", { withTimezone: true }),
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("trigify_monitors_tenant_type_target_unique").on(
      table.tenantId,
      table.monitorType,
      table.targetUrl,
    ),
    index("trigify_monitors_tenant_status_idx").on(table.tenantId, table.status),
  ],
);
