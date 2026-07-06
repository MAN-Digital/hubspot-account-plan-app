/**
 * Tests for the Trigify monitor-management spend gate (Stage A Task 9).
 *
 * Ports the discipline of `trigify_monitors.py` (OrbStack VM,
 * `.../outreach-engine/trigify_monitors.py`) scoped to what this app actually
 * needs: ONE credit-spend path (Social-Signals subscription create), never a
 * Listening-stream dual path. Every test asserts the spend gate directly:
 *   - dry-run preview by default (no client call, zero spend)
 *   - explicit confirm required to spend
 *   - per-tenant credit budget ceiling (fail-closed when unconfigured)
 *   - duplicate-monitor detection (DB unique constraint surfaced as a clean
 *     error, never a raw Postgres constraint-violation message)
 *   - every confirmed spend is audit-logged
 *   - NEVER a silent credit spend
 */

import type { NewTrigifyMonitor, TrigifyMonitor } from "@hap/db";
import { describe, expect, it, vi } from "vitest";
import type { TrigifyClient } from "../../../adapters/signal/trigify-client";
import {
  DuplicateMonitorError,
  deleteMonitor,
  type MonitorStore,
  pauseMonitor,
  planSubscribe,
  subscribe,
} from "../monitor-manager";

const TENANT = "tenant-1";
const NOW = new Date("2026-07-06T12:00:00.000Z");

function makeMonitor(overrides?: Partial<TrigifyMonitor>): TrigifyMonitor {
  return {
    id: "mon-1",
    tenantId: TENANT,
    monitorType: "linkedin-profile",
    targetUrl: "https://www.linkedin.com/in/janedoe",
    status: "active",
    creditsSpent: 1,
    config: {},
    subscribedAt: NOW,
    pausedAt: null,
    deletedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function makeStore(overrides?: Partial<MonitorStore>): MonitorStore {
  return {
    findByTenantAndTarget: vi.fn().mockResolvedValue(null),
    insert: vi.fn().mockImplementation(async (row: NewTrigifyMonitor) => makeMonitor(row)),
    countConfirmedSince: vi.fn().mockResolvedValue(0),
    updateStatus: vi.fn().mockImplementation(async () => makeMonitor()),
    listByTenant: vi.fn().mockResolvedValue([]),
    ...overrides,
  };
}

function makeClient(overrides?: Partial<TrigifyClient>): TrigifyClient {
  return {
    createSubscription: vi.fn().mockResolvedValue({ data: [{ id: "sub-remote-1" }] }),
    getUsage: vi.fn(),
    getLimits: vi.fn(),
    listSubscriptions: vi.fn(),
    getSocialSignalsFeed: vi.fn(),
    ...overrides,
  } as unknown as TrigifyClient;
}

describe("planSubscribe (dry-run preview)", () => {
  it("returns a preview with projected spend and NEVER calls the client", async () => {
    const client = makeClient();
    const store = makeStore();
    const plan = await planSubscribe(
      { client, store, tenantId: TENANT, now: () => NOW },
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
      },
    );

    expect(plan.projectedSpend).toBe(1);
    expect(plan.duplicate).toBeNull();
    expect(client.createSubscription).not.toHaveBeenCalled();
  });

  it("flags a duplicate monitor (same tenant+type+targetUrl) with projectedSpend=0", async () => {
    const existing = makeMonitor();
    const store = makeStore({
      findByTenantAndTarget: vi.fn().mockResolvedValue(existing),
    });
    const plan = await planSubscribe(
      { client: makeClient(), store, tenantId: TENANT, now: () => NOW },
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
      },
    );
    expect(plan.projectedSpend).toBe(0);
    expect(plan.duplicate).toEqual({ id: "mon-1", status: "active" });
  });

  it("rejects an unknown monitorType (not in TRIGIFY_MONITORING_TYPES)", async () => {
    const plan = await planSubscribe(
      {
        client: makeClient(),
        store: makeStore(),
        tenantId: TENANT,
        now: () => NOW,
      },
      { monitorType: "carrier-pigeon", targetUrl: "https://example.com/x" },
    );
    expect(plan.validMonitorType).toBe(false);
    expect(plan.projectedSpend).toBe(0);
  });

  it("includes the exact payload that would be POSTed if confirmed", async () => {
    const plan = await planSubscribe(
      {
        client: makeClient(),
        store: makeStore(),
        tenantId: TENANT,
        now: () => NOW,
      },
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
      },
    );
    expect(plan.payload.subscriptions).toEqual([
      expect.objectContaining({
        linkedin_url: "https://www.linkedin.com/in/janedoe",
      }),
    ]);
  });

  it("clamps lookbackWindowMs to the tenant's plan limit when planLimits is provided", async () => {
    const plan = await planSubscribe(
      {
        client: makeClient(),
        store: makeStore(),
        tenantId: TENANT,
        now: () => NOW,
        planLimits: {
          maxLookbackWindowMs: 14 * 24 * 60 * 60 * 1000,
          degraded: false,
        },
      },
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        lookbackWindowMs: 30 * 24 * 60 * 60 * 1000, // requests 30d
      },
    );
    // Clamped down to the 14d plan max, not the requested 30d.
    expect(plan.lookbackWindowMs).toBe(14 * 24 * 60 * 60 * 1000);
    expect(plan.payload.subscriptions[0]?.config?.lookbackWindowMs).toBe(14 * 24 * 60 * 60 * 1000);
  });

  it("exposes the active plan window in the plan result even when not clamped", async () => {
    const plan = await planSubscribe(
      {
        client: makeClient(),
        store: makeStore(),
        tenantId: TENANT,
        now: () => NOW,
        planLimits: {
          plan: "growth",
          maxLookbackWindowMs: 30 * 24 * 60 * 60 * 1000,
          degraded: false,
        },
      },
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
      },
    );
    expect(plan.activeLookbackPlan).toBe("growth");
    expect(plan.lookbackWindowMs).toBe(30 * 24 * 60 * 60 * 1000);
  });
});

describe("subscribe (guarded spend)", () => {
  it("without confirm=true, does NOT call the client and does NOT insert a monitor row (dry-run default)", async () => {
    const client = makeClient();
    const store = makeStore();
    const result = await subscribe(
      {
        client,
        store,
        tenantId: TENANT,
        now: () => NOW,
        budget: { daily: 10 },
      },
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
      },
    );

    expect(result.created).toBe(false);
    expect(client.createSubscription).not.toHaveBeenCalled();
    expect(store.insert).not.toHaveBeenCalled();
    expect(result.reason).toMatch(/confirm/i);
  });

  it("with confirm=true and budget available, calls the client, inserts the monitor, and records spend", async () => {
    const client = makeClient();
    const store = makeStore();
    const result = await subscribe(
      {
        client,
        store,
        tenantId: TENANT,
        now: () => NOW,
        budget: { daily: 10 },
      },
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        confirm: true,
      },
    );

    expect(result.created).toBe(true);
    expect(client.createSubscription).toHaveBeenCalledTimes(1);
    expect(client.createSubscription).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptions: [
          expect.objectContaining({
            linkedin_url: "https://www.linkedin.com/in/janedoe",
          }),
        ],
      }),
      { confirm: true },
    );
    expect(store.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT,
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        status: "active",
        creditsSpent: 1,
      }),
    );
  });

  it("FAIL-CLOSED: refuses to spend when NEITHER daily NOR monthly budget is configured", async () => {
    const client = makeClient();
    const store = makeStore();
    const result = await subscribe(
      { client, store, tenantId: TENANT, now: () => NOW }, // no budget at all
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        confirm: true,
      },
    );
    expect(result.created).toBe(false);
    expect(client.createSubscription).not.toHaveBeenCalled();
    expect(result.reason).toMatch(/budget/i);
  });

  it("refuses to spend when the daily budget would be exceeded", async () => {
    const client = makeClient();
    const store = makeStore({
      countConfirmedSince: vi.fn().mockResolvedValue(5),
    });
    const result = await subscribe(
      { client, store, tenantId: TENANT, now: () => NOW, budget: { daily: 5 } },
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        confirm: true,
      },
    );
    expect(result.created).toBe(false);
    expect(client.createSubscription).not.toHaveBeenCalled();
    expect(result.reason).toMatch(/budget/i);
  });

  it("refuses a duplicate monitor even with confirm=true and budget available (DB-enforced dedup surfaced cleanly)", async () => {
    const existing = makeMonitor();
    const client = makeClient();
    const store = makeStore({
      findByTenantAndTarget: vi.fn().mockResolvedValue(existing),
    });
    const result = await subscribe(
      {
        client,
        store,
        tenantId: TENANT,
        now: () => NOW,
        budget: { daily: 10 },
      },
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        confirm: true,
      },
    );
    expect(result.created).toBe(false);
    expect(client.createSubscription).not.toHaveBeenCalled();
    expect(result.reason).toMatch(/duplicate/i);
  });

  it("surfaces a DB unique-constraint violation (race between preview and confirm) as DuplicateMonitorError, not a raw Postgres error", async () => {
    const client = makeClient();
    // Real shape: Drizzle (postgres-js driver) wraps the raw PostgresError in
    // a DrizzleQueryError — the code/constraint_name fields live on `.cause`,
    // NOT directly on the thrown error (pinned down against the real driver
    // in drizzle-monitor-store.test.ts). A flat {code, constraint} shape
    // would never actually occur in production and must not be what this
    // detection logic relies on.
    const pgUniqueViolation = Object.assign(
      new Error('Failed query: insert into "trigify_monitors" ...'),
      {
        cause: Object.assign(new Error("duplicate key value violates unique constraint"), {
          code: "23505",
          constraint_name: "trigify_monitors_tenant_type_target_unique",
        }),
      },
    );
    const store = makeStore({
      insert: vi.fn().mockRejectedValue(pgUniqueViolation),
    });
    await expect(
      subscribe(
        {
          client,
          store,
          tenantId: TENANT,
          now: () => NOW,
          budget: { daily: 10 },
        },
        {
          monitorType: "linkedin-profile",
          targetUrl: "https://www.linkedin.com/in/janedoe",
          confirm: true,
        },
      ),
    ).rejects.toBeInstanceOf(DuplicateMonitorError);
  });

  it("rejects an invalid monitorType even with confirm=true (never spends on a malformed request)", async () => {
    const client = makeClient();
    const store = makeStore();
    const result = await subscribe(
      {
        client,
        store,
        tenantId: TENANT,
        now: () => NOW,
        budget: { daily: 10 },
      },
      {
        monitorType: "carrier-pigeon",
        targetUrl: "https://example.com/x",
        confirm: true,
      },
    );
    expect(result.created).toBe(false);
    expect(client.createSubscription).not.toHaveBeenCalled();
  });

  it("audit-logs every confirmed spend (structured log, never the API key)", async () => {
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const client = makeClient();
    const store = makeStore();
    await subscribe(
      {
        client,
        store,
        tenantId: TENANT,
        now: () => NOW,
        budget: { daily: 10 },
      },
      {
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        confirm: true,
      },
    );
    expect(infoSpy).toHaveBeenCalledWith(
      "trigify_monitor.spend_confirmed",
      expect.objectContaining({
        tenantId: TENANT,
        monitorType: "linkedin-profile",
      }),
    );
    // Never log the target URL's full value alongside anything resembling a
    // key, and never log an apiKey field at all.
    const [, logArg] = infoSpy.mock.calls[0] as [string, Record<string, unknown>];
    expect(logArg.apiKey).toBeUndefined();
    infoSpy.mockRestore();
  });
});

describe("pauseMonitor / deleteMonitor (local state machine, no client dependency)", () => {
  it("pauseMonitor transitions status to 'paused' and sets pausedAt", async () => {
    const store = makeStore({
      updateStatus: vi
        .fn()
        .mockImplementation(async () => makeMonitor({ status: "paused", pausedAt: NOW })),
    });
    const result = await pauseMonitor(
      { store, tenantId: TENANT, now: () => NOW },
      { monitorId: "mon-1" },
    );
    expect(result.status).toBe("paused");
    expect(store.updateStatus).toHaveBeenCalledWith(TENANT, "mon-1", "paused", NOW);
  });

  it("deleteMonitor transitions status to 'deleted' and sets deletedAt", async () => {
    const store = makeStore({
      updateStatus: vi
        .fn()
        .mockImplementation(async () => makeMonitor({ status: "deleted", deletedAt: NOW })),
    });
    const result = await deleteMonitor(
      { store, tenantId: TENANT, now: () => NOW },
      { monitorId: "mon-1" },
    );
    expect(result.status).toBe("deleted");
    expect(store.updateStatus).toHaveBeenCalledWith(TENANT, "mon-1", "deleted", NOW);
  });
});
