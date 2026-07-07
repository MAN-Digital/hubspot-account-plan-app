/**
 * Tests for the real-database Trigify poll wiring (Stage A Task 16 — Bug 2
 * fix). `createDbPollAllTenantsDeps` is what `app.ts` mounts
 * `/admin/trigify-poll` against; without it the cron route had nothing real
 * to call and was never wired into the exported app.
 *
 * Uses the local test Postgres DB (same pattern as
 * apps/api/src/lib/__tests__/config-resolver.test.ts) — a real
 * `providerConfig` row with `providerName: "trigify", enabled: true` must
 * make `listEnabledTenants()` return that tenant, and `buildTenantDeps()`
 * must produce a `PollTenantDeps` whose `client` calls the tenant's
 * decrypted Trigify key.
 */

import { randomUUID } from "node:crypto";
import { createDatabase, providerConfig, tenants } from "@hap/db";
import { like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { clearConfigResolverCache } from "../../../lib/config-resolver";
import { __resetEncryptionCacheForTests, encryptProviderKey } from "../../../lib/encryption";
import { createDbPollAllTenantsDeps } from "../poll-deps";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);
const PORTAL_PREFIX = `polldeps-${randomUUID().slice(0, 8)}-`;
const ROOT_KEK_BASE64 = Buffer.alloc(32, 9).toString("base64");
let savedRootKek: string | undefined;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

beforeAll(() => {
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

beforeEach(async () => {
  clearConfigResolverCache();
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

describe("createDbPollAllTenantsDeps", () => {
  it("listEnabledTenants returns only tenants with an enabled trigify provider row", async () => {
    const [enabledTenant] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Enabled Trigify Co" })
      .returning();
    const [disabledTenant] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Disabled Trigify Co" })
      .returning();
    const [noRowTenant] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "No Provider Row Co" })
      .returning();
    if (!enabledTenant || !disabledTenant || !noRowTenant) {
      throw new Error("tenant seed failed");
    }

    await db.insert(providerConfig).values([
      {
        tenantId: enabledTenant.id,
        providerName: "trigify",
        enabled: true,
        apiKeyEncrypted: encryptProviderKey(enabledTenant.id, "trigify-key-enabled"),
        thresholds: { freshnessMaxDays: 30, minConfidence: 0.5 },
        settings: {},
      },
      {
        tenantId: disabledTenant.id,
        providerName: "trigify",
        enabled: false,
        apiKeyEncrypted: encryptProviderKey(disabledTenant.id, "trigify-key-disabled"),
        thresholds: { freshnessMaxDays: 30, minConfidence: 0.5 },
        settings: {},
      },
    ]);

    const deps = createDbPollAllTenantsDeps(db);
    const enabledIds = await deps.listEnabledTenants();

    expect(enabledIds).toContain(enabledTenant.id);
    expect(enabledIds).not.toContain(disabledTenant.id);
    expect(enabledIds).not.toContain(noRowTenant.id);
  });

  it("buildTenantDeps wires a client using the tenant's decrypted Trigify key", async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "Client Wiring Co" })
      .returning();
    if (!tenant) throw new Error("tenant seed failed");

    await db.insert(providerConfig).values({
      tenantId: tenant.id,
      providerName: "trigify",
      enabled: true,
      apiKeyEncrypted: encryptProviderKey(tenant.id, "trigify-key-for-fetch"),
      thresholds: { freshnessMaxDays: 30, minConfidence: 0.5 },
      settings: {},
    });

    const fetchSpy = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
    const deps = createDbPollAllTenantsDeps(db, { fetch: fetchSpy as unknown as typeof fetch });
    const tenantDeps = await deps.buildTenantDeps(tenant.id);

    await tenantDeps.client.getSocialSignalsFeed({ page: 1, pageSize: 50 });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [, init] = fetchSpy.mock.calls[0] as unknown as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer trigify-key-for-fetch");
  });

  it("buildTenantDeps throws when the tenant has no enabled trigify row (caller should not have listed it)", async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ hubspotPortalId: portalId(), name: "No Trigify Row Co" })
      .returning();
    if (!tenant) throw new Error("tenant seed failed");

    const deps = createDbPollAllTenantsDeps(db);
    await expect(deps.buildTenantDeps(tenant.id)).rejects.toThrow();
  });
});
