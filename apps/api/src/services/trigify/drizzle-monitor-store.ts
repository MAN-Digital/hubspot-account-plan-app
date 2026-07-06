/**
 * Drizzle-backed {@link MonitorStore} implementation (Stage A Task 9).
 *
 * The real storage seam `monitor-manager.ts` is driven by in production —
 * every method is scoped to `trigifyMonitors` rows for the given `tenantId`,
 * never a cross-tenant read/write. `insert` relies on the DB's own
 * `trigify_monitors_tenant_type_target_unique` constraint as the
 * belt-and-braces duplicate guard (see `monitor-manager.ts`'s
 * `isDuplicateConstraintViolation` — it inspects the raw driver error's
 * `code`/`constraint` fields, which postgres.js/node-postgres both surface
 * for a `23505` unique-violation).
 */

import {
  type Database,
  type NewTrigifyMonitor,
  type TrigifyMonitor,
  trigifyMonitors,
} from "@hap/db";
import { and, eq, gte } from "drizzle-orm";
import type { MonitorStore, TrigifyMonitorStatus } from "./monitor-manager.js";

export function createDrizzleMonitorStore(db: Database): MonitorStore {
  return {
    async findByTenantAndTarget(
      tenantId: string,
      monitorType: string,
      targetUrl: string,
    ): Promise<TrigifyMonitor | null> {
      const rows = await db
        .select()
        .from(trigifyMonitors)
        .where(
          and(
            eq(trigifyMonitors.tenantId, tenantId),
            eq(trigifyMonitors.monitorType, monitorType),
            eq(trigifyMonitors.targetUrl, targetUrl),
          ),
        )
        .limit(1);
      return rows[0] ?? null;
    },

    async insert(row: NewTrigifyMonitor): Promise<TrigifyMonitor> {
      const [inserted] = await db.insert(trigifyMonitors).values(row).returning();
      if (!inserted) {
        throw new Error("drizzle-monitor-store: insert returned no row");
      }
      return inserted;
    },

    async countConfirmedSince(tenantId: string, since: Date): Promise<number> {
      const rows = await db
        .select()
        .from(trigifyMonitors)
        .where(and(eq(trigifyMonitors.tenantId, tenantId), gte(trigifyMonitors.createdAt, since)));
      return rows.length;
    },

    async updateStatus(
      tenantId: string,
      monitorId: string,
      status: TrigifyMonitorStatus,
      at: Date,
    ): Promise<TrigifyMonitor> {
      const statusTimestampColumn =
        status === "paused" ? { pausedAt: at } : status === "deleted" ? { deletedAt: at } : {};

      const [updated] = await db
        .update(trigifyMonitors)
        .set({ status, updatedAt: at, ...statusTimestampColumn })
        .where(and(eq(trigifyMonitors.id, monitorId), eq(trigifyMonitors.tenantId, tenantId)))
        .returning();

      if (!updated) {
        throw new Error(
          `drizzle-monitor-store: no monitor ${monitorId} found for this tenant (cannot update a different tenant's monitor)`,
        );
      }
      return updated;
    },

    async listByTenant(tenantId: string): Promise<TrigifyMonitor[]> {
      return db.select().from(trigifyMonitors).where(eq(trigifyMonitors.tenantId, tenantId));
    },
  };
}
