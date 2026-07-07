/**
 * Tests for `routes/settings-trigify.ts` (Stage A Task 9).
 *
 * Route table:
 *   GET    /               — connection test + tenant's monitor list
 *   POST   /monitors/plan  — dry-run preview (no spend, no client call for create)
 *   POST   /monitors       — subscribe (spend-gated; requires confirm:true)
 *   POST   /monitors/:id/pause   — local state transition
 *   POST   /monitors/:id/delete  — local state transition
 *
 * These tests use the route-only harness pattern from
 * `apps/api/src/__tests__/snapshot-route.test.ts`'s
 * `buildSnapshotRouteOnlyApp` (inject tenantId/db directly, skip the full
 * auth stack) and a real local Postgres for the `trigifyMonitors` table +
 * `provider_config` row, with an injected `TrigifyClient` factory so no
 * network call is ever made.
 */

import { randomUUID } from "node:crypto";
import { createDatabase, providerConfig, tenants, trigifyMonitors } from "@hap/db";
import { like } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { TrigifyClient } from "../../adapters/signal/trigify-client";
import { __resetEncryptionCacheForTests, encryptProviderKey } from "../../lib/encryption";
import { createSettingsTrigifyRoute } from "../settings-trigify";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";
const db = createDatabase(DATABASE_URL);

const PORTAL_PREFIX = `trigifysettings-${randomUUID().slice(0, 8)}-`;
const ROOT_KEK_BASE64 = Buffer.alloc(32, 7).toString("base64");
let savedRootKek: string | undefined;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

async function seedTenantWithTrigifyKey(name: string, key = "trg-live-key-abc"): Promise<string> {
  const [tenant] = await db
    .insert(tenants)
    .values({ hubspotPortalId: portalId(), name })
    .returning();
  if (!tenant) throw new Error("tenant insert failed");
  await db.insert(providerConfig).values({
    tenantId: tenant.id,
    providerName: "trigify",
    enabled: true,
    apiKeyEncrypted: encryptProviderKey(tenant.id, key),
    thresholds: { freshnessMaxDays: 30, minConfidence: 0.5 },
    settings: { creditBudget: { daily: 5 } },
  });
  return tenant.id;
}

function makeFakeClient(overrides?: Partial<TrigifyClient>): TrigifyClient {
  return {
    getUsage: vi.fn().mockResolvedValue({ credits_used: 10, credits_remaining: 990 }),
    getLimits: vi.fn().mockResolvedValue({
      plan: "growth",
      max_lookback_window_ms: 2_592_000_000,
    }),
    createSubscription: vi.fn().mockResolvedValue({ data: [{ id: "sub-1" }] }),
    listSubscriptions: vi.fn(),
    getSocialSignalsFeed: vi.fn(),
    ...overrides,
  } as unknown as TrigifyClient;
}

function buildApp(tenantId: string, clientFactory: () => TrigifyClient) {
  const app = new Hono<{
    Variables: { tenantId?: string; db?: ReturnType<typeof createDatabase> };
  }>();
  app.use("*", async (c, next) => {
    c.set("tenantId", tenantId);
    c.set("db", db);
    await next();
  });
  app.route("/api/settings/trigify", createSettingsTrigifyRoute({ clientFactory }));
  return app;
}

beforeEach(() => {
  savedRootKek = process.env.ROOT_KEK;
  process.env.ROOT_KEK = ROOT_KEK_BASE64;
  __resetEncryptionCacheForTests();
});

afterAll(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
  if (savedRootKek === undefined) {
    delete process.env.ROOT_KEK;
  } else {
    process.env.ROOT_KEK = savedRootKek;
  }
  __resetEncryptionCacheForTests();
});

describe("GET /api/settings/trigify", () => {
  it("returns the connection status (via FREE getUsage) and the tenant's monitor list", async () => {
    const tenantId = await seedTenantWithTrigifyKey("Conn-A");
    const app = buildApp(tenantId, () => makeFakeClient());

    const res = await app.request("/api/settings/trigify");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      connected: boolean;
      usage: { credits_used: number };
      monitors: unknown[];
    };
    expect(body.connected).toBe(true);
    expect(body.usage.credits_used).toBe(10);
    expect(body.monitors).toEqual([]);
  });

  it("returns connected=false (never 500) when the tenant has no trigify provider_config row", async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "No-Config" })
      .returning();
    if (!tenant) throw new Error("tenant insert failed");
    const app = buildApp(tenant.id, () => makeFakeClient());

    const res = await app.request("/api/settings/trigify");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean };
    expect(body.connected).toBe(false);
  });

  it("returns connected=false when the live getUsage call fails (bad/revoked key)", async () => {
    const tenantId = await seedTenantWithTrigifyKey("Conn-B");
    const app = buildApp(tenantId, () =>
      makeFakeClient({ getUsage: vi.fn().mockRejectedValue(new Error("401")) }),
    );

    const res = await app.request("/api/settings/trigify");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connected: boolean };
    expect(body.connected).toBe(false);
  });

  it("never leaks the API key in the response body", async () => {
    const tenantId = await seedTenantWithTrigifyKey("Conn-C", "trg-super-secret-key");
    const app = buildApp(tenantId, () => makeFakeClient());
    const res = await app.request("/api/settings/trigify");
    const raw = await res.text();
    expect(raw).not.toContain("trg-super-secret-key");
  });
});

describe("POST /api/settings/trigify/monitors/plan", () => {
  it("returns a dry-run preview and never calls createSubscription", async () => {
    const tenantId = await seedTenantWithTrigifyKey("Plan-A");
    const createSubscription = vi.fn();
    const app = buildApp(tenantId, () => makeFakeClient({ createSubscription }));

    const res = await app.request("/api/settings/trigify/monitors/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      projectedSpend: number;
      duplicate: unknown;
    };
    expect(body.projectedSpend).toBe(1);
    expect(body.duplicate).toBeNull();
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("returns 400 for a malformed body", async () => {
    const tenantId = await seedTenantWithTrigifyKey("Plan-B");
    const app = buildApp(tenantId, () => makeFakeClient());
    const res = await app.request("/api/settings/trigify/monitors/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ monitorType: "linkedin-profile" }), // missing targetUrl
    });
    expect(res.status).toBe(400);
  });

  it("returns 400 when the tenant has no trigify key configured (nothing to preview against)", async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Plan-NoKey" })
      .returning();
    if (!tenant) throw new Error("tenant insert failed");
    const app = buildApp(tenant.id, () => makeFakeClient());
    const res = await app.request("/api/settings/trigify/monitors/plan", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/x",
      }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("trigify_not_configured");
  });
});

describe("POST /api/settings/trigify/monitors", () => {
  it("without confirm:true, does not spend and returns created:false", async () => {
    const tenantId = await seedTenantWithTrigifyKey("Sub-A");
    const createSubscription = vi.fn();
    const app = buildApp(tenantId, () => makeFakeClient({ createSubscription }));

    const res = await app.request("/api/settings/trigify/monitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean };
    expect(body.created).toBe(false);
    expect(createSubscription).not.toHaveBeenCalled();
  });

  it("with confirm:true and a configured daily budget, spends and persists the monitor", async () => {
    const tenantId = await seedTenantWithTrigifyKey("Sub-B");
    const createSubscription = vi.fn().mockResolvedValue({ data: [{ id: "sub-remote-1" }] });
    const app = buildApp(tenantId, () => makeFakeClient({ createSubscription }));

    const res = await app.request("/api/settings/trigify/monitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        confirm: true,
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as { created: boolean };
    expect(body.created).toBe(true);
    expect(createSubscription).toHaveBeenCalledTimes(1);

    const rows = await db.select().from(trigifyMonitors);
    expect(rows.some((r) => r.tenantId === tenantId && r.targetUrl.includes("janedoe"))).toBe(true);
  });

  it("refuses a duplicate subscribe request (second confirm for the same target)", async () => {
    const tenantId = await seedTenantWithTrigifyKey("Sub-C");
    const app = buildApp(tenantId, () => makeFakeClient());

    const body = JSON.stringify({
      monitorType: "linkedin-profile",
      targetUrl: "https://www.linkedin.com/in/dupe",
      confirm: true,
    });
    const first = await app.request("/api/settings/trigify/monitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(((await first.json()) as { created: boolean }).created).toBe(true);

    const second = await app.request("/api/settings/trigify/monitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
    });
    expect(second.status).toBe(200);
    const secondBody = (await second.json()) as {
      created: boolean;
      reason: string;
    };
    expect(secondBody.created).toBe(false);
    expect(secondBody.reason).toMatch(/duplicate/i);
  });
});

describe("POST /api/settings/trigify/monitors/:id/pause and /delete", () => {
  it("pauses a monitor belonging to this tenant", async () => {
    const tenantId = await seedTenantWithTrigifyKey("Life-A");
    const app = buildApp(tenantId, () => makeFakeClient());

    const create = await app.request("/api/settings/trigify/monitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/pauseme",
        confirm: true,
      }),
    });
    const created = (await create.json()) as { monitor: { id: string } };

    const paused = await app.request(`/api/settings/trigify/monitors/${created.monitor.id}/pause`, {
      method: "POST",
    });
    expect(paused.status).toBe(200);
    const pausedBody = (await paused.json()) as { status: string };
    expect(pausedBody.status).toBe("paused");
  });

  it("returns 404 (not a cross-tenant leak) when pausing a monitor id from another tenant", async () => {
    const tenantA = await seedTenantWithTrigifyKey("Life-B-A");
    const tenantB = await seedTenantWithTrigifyKey("Life-B-B");
    const appA = buildApp(tenantA, () => makeFakeClient());
    const appB = buildApp(tenantB, () => makeFakeClient());

    const create = await appA.request("/api/settings/trigify/monitors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/tenantaonly",
        confirm: true,
      }),
    });
    const created = (await create.json()) as { monitor: { id: string } };

    const crossTenantPause = await appB.request(
      `/api/settings/trigify/monitors/${created.monitor.id}/pause`,
      { method: "POST" },
    );
    expect(crossTenantPause.status).toBe(404);
  });
});
