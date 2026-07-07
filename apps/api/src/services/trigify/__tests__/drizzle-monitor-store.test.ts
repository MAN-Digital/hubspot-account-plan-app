/**
 * Tests for the Drizzle-backed MonitorStore (Stage A Task 9).
 *
 * Real Postgres (matches the convention in
 * `packages/db/src/schema/__tests__/trigify-signals-migration.test.ts` and
 * `apps/api/src/__tests__/snapshot-route.test.ts`) — this is the storage
 * seam `monitor-manager.ts` is driven by in production, so its DB-facing
 * behavior (dedup lookup, insert, status transitions, confirmed-spend
 * counting, listing) is verified against the real schema/constraints rather
 * than a mock.
 */

import { randomUUID } from "node:crypto";
import { createDatabase, tenants } from "@hap/db";
import { like } from "drizzle-orm";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createDrizzleMonitorStore } from "../drizzle-monitor-store";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";
const db = createDatabase(DATABASE_URL);

const PORTAL_PREFIX = `monstore-${randomUUID().slice(0, 8)}-`;
function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

async function seedTenant(name: string): Promise<string> {
  const [row] = await db.insert(tenants).values({ hubspotPortalId: portalId(), name }).returning();
  if (!row) throw new Error("tenant insert failed");
  return row.id;
}

beforeEach(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

afterAll(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

describe("createDrizzleMonitorStore", () => {
  it("findByTenantAndTarget returns null when no row exists", async () => {
    const tenantId = await seedTenant("Store-A");
    const store = createDrizzleMonitorStore(db);
    const found = await store.findByTenantAndTarget(
      tenantId,
      "linkedin-profile",
      "https://www.linkedin.com/in/nobody",
    );
    expect(found).toBeNull();
  });

  it("insert then findByTenantAndTarget returns the inserted row", async () => {
    const tenantId = await seedTenant("Store-B");
    const store = createDrizzleMonitorStore(db);
    const inserted = await store.insert({
      tenantId,
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/janedoe",
      status: "active",
      creditsSpent: 1,
      config: { cadence: "daily" },
      subscribedAt: new Date(),
    });
    expect(inserted.id).toBeDefined();

    const found = await store.findByTenantAndTarget(
      tenantId,
      "linkedin-profile",
      "https://www.linkedin.com/in/janedoe",
    );
    expect(found?.id).toBe(inserted.id);
  });

  it("insert rejects a duplicate (tenantId, monitorType, targetUrl) with the Postgres unique-violation surfaced via Drizzle's error.cause (code 23505)", async () => {
    // Drizzle (postgres-js driver) wraps the raw PostgresError in a
    // DrizzleQueryError; the driver's code/constraint fields live on
    // `error.cause`, NOT directly on the thrown error. monitor-manager.ts's
    // isDuplicateConstraintViolation must inspect `.cause`, not the thrown
    // error itself — this test pins that down against the real driver.
    const tenantId = await seedTenant("Store-C");
    const store = createDrizzleMonitorStore(db);
    await store.insert({
      tenantId,
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/dup",
      status: "active",
      creditsSpent: 1,
    });

    let caught: unknown;
    try {
      await store.insert({
        tenantId,
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/dup",
        status: "active",
        creditsSpent: 1,
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeDefined();
    const cause = (caught as { cause?: unknown }).cause as
      | { code?: string; constraint_name?: string }
      | undefined;
    expect(cause?.code).toBe("23505");
    expect(cause?.constraint_name).toBe("trigify_monitors_tenant_type_target_unique");
  });

  it("countConfirmedSince counts only rows created at/after the cutoff for this tenant", async () => {
    const tenantId = await seedTenant("Store-D");
    const store = createDrizzleMonitorStore(db);
    await store.insert({
      tenantId,
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/one",
      status: "active",
      creditsSpent: 1,
    });
    await store.insert({
      tenantId,
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/two",
      status: "active",
      creditsSpent: 1,
    });

    const farFuture = new Date(Date.now() + 60_000);
    const countBefore = await store.countConfirmedSince(tenantId, new Date(0));
    const countAfterFuture = await store.countConfirmedSince(tenantId, farFuture);
    expect(countBefore).toBe(2);
    expect(countAfterFuture).toBe(0);
  });

  it("countConfirmedSince never counts another tenant's monitors", async () => {
    const tenantA = await seedTenant("Store-E-A");
    const tenantB = await seedTenant("Store-E-B");
    const store = createDrizzleMonitorStore(db);
    await store.insert({
      tenantId: tenantA,
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/tenanta",
      status: "active",
      creditsSpent: 1,
    });

    const countForB = await store.countConfirmedSince(tenantB, new Date(0));
    expect(countForB).toBe(0);
  });

  it("updateStatus transitions status and sets pausedAt on pause", async () => {
    const tenantId = await seedTenant("Store-F");
    const store = createDrizzleMonitorStore(db);
    const inserted = await store.insert({
      tenantId,
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/pauseme",
      status: "active",
      creditsSpent: 1,
    });

    const at = new Date();
    const updated = await store.updateStatus(tenantId, inserted.id, "paused", at);
    expect(updated.status).toBe("paused");
    expect(updated.pausedAt?.getTime()).toBe(at.getTime());
  });

  it("updateStatus transitions status and sets deletedAt on delete", async () => {
    const tenantId = await seedTenant("Store-G");
    const store = createDrizzleMonitorStore(db);
    const inserted = await store.insert({
      tenantId,
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/deleteme",
      status: "active",
      creditsSpent: 1,
    });

    const at = new Date();
    const updated = await store.updateStatus(tenantId, inserted.id, "deleted", at);
    expect(updated.status).toBe("deleted");
    expect(updated.deletedAt?.getTime()).toBe(at.getTime());
  });

  it("updateStatus never mutates a monitor belonging to a different tenant", async () => {
    const tenantA = await seedTenant("Store-H-A");
    const tenantB = await seedTenant("Store-H-B");
    const store = createDrizzleMonitorStore(db);
    const inserted = await store.insert({
      tenantId: tenantA,
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/tenantaonly",
      status: "active",
      creditsSpent: 1,
    });

    await expect(store.updateStatus(tenantB, inserted.id, "deleted", new Date())).rejects.toThrow();

    const stillActive = await store.findByTenantAndTarget(
      tenantA,
      "linkedin-profile",
      "https://www.linkedin.com/in/tenantaonly",
    );
    expect(stillActive?.status).toBe("active");
  });

  it("listByTenant returns only this tenant's monitors", async () => {
    const tenantA = await seedTenant("Store-I-A");
    const tenantB = await seedTenant("Store-I-B");
    const store = createDrizzleMonitorStore(db);
    await store.insert({
      tenantId: tenantA,
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/aa",
      status: "active",
      creditsSpent: 1,
    });
    await store.insert({
      tenantId: tenantB,
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/bb",
      status: "active",
      creditsSpent: 1,
    });

    const listA = await store.listByTenant(tenantA);
    expect(listA).toHaveLength(1);
    expect(listA[0]?.targetUrl).toBe("https://www.linkedin.com/in/aa");
  });
});
