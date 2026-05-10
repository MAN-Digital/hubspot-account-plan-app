/**
 * Issue #28 / slice-12 Wave C — default-on HubSpot enrichment for new
 * tenant installs.
 *
 * Contract reference: docs/slice-12-preflight-notes.md §4.
 *
 * Locked guarantees this file enforces:
 *   1. A fresh OAuth install writes `settings.enrichmentEnabled = true`
 *      on the newly-inserted tenant row.
 *   2. A reinstall (same `hubspotPortalId`, conflict path) MUST NOT
 *      clobber a user-set `settings.enrichmentEnabled = false`. The
 *      default-on is wired into `.values({...})`, NOT into
 *      `onConflictDoUpdate.set`, so `settings` is left alone on conflict.
 *   3. Cross-tenant isolation: tenant A's disabled toggle MUST NOT leak
 *      to tenant B's fresh install, and tenant B's fresh install MUST
 *      NOT flip tenant A's disabled toggle back to `true`.
 *
 * DB-backed test — mirrors the boilerplate in
 * `apps/api/src/__tests__/oauth-success-page.test.ts` (Wave B).
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@hap/db";
import { createDatabase, createTestClient } from "@hap/db";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signState } from "../lib/oauth.js";
import { createOAuthRoutes } from "../routes/oauth.js";

const here = dirname(fileURLToPath(import.meta.url));
const cassettesDir = join(here, "..", "lib", "__tests__", "cassettes");

function loadCassette(name: string) {
  return JSON.parse(readFileSync(join(cassettesDir, name), "utf8")) as {
    response: { status: number; body: unknown };
  };
}

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";
const sqlClient = createTestClient(DATABASE_URL);
const db = createDatabase(DATABASE_URL);

// Numeric portal-id prefix unique to this test file. The route stores
// `String(identity.hubId)` on tenants.hubspotPortalId, so the prefix
// must be all-digit to survive the round trip and let `beforeEach`'s
// LIKE cleanup target only this file's rows. The random 4-digit suffix
// avoids collisions across concurrent test files; the per-test counter
// (`nextHubIdSuffix`) avoids collisions inside this file.
const PORTAL_PREFIX = `9${Math.floor(1000 + Math.random() * 8999)}`; // e.g. "92847"

const CONFIG = {
  clientId: "test-client-id",
  clientSecret: "test-client-secret",
  redirectUri: "http://localhost:3000/oauth/callback",
  scopes: ["oauth", "crm.objects.companies.read", "crm.objects.contacts.read"],
  stateTtlSeconds: 600,
};

const ROOT_KEK_BASE64 = Buffer.alloc(32, 7).toString("base64");
let savedRootKek: string | undefined;

beforeAll(async () => {
  await sqlClient`SELECT 1`;
  savedRootKek = process.env.ROOT_KEK;
  process.env.ROOT_KEK = ROOT_KEK_BASE64;
});

afterAll(async () => {
  if (savedRootKek !== undefined) {
    process.env.ROOT_KEK = savedRootKek;
  } else {
    delete process.env.ROOT_KEK;
  }
  await sqlClient.end({ timeout: 5 });
});

beforeEach(async () => {
  await db.delete(schema.tenants).where(like(schema.tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

function fakeFetchSequence(responses: Array<{ status: number; body: unknown }>): typeof fetch {
  let i = 0;
  return vi.fn(async () => {
    const r = responses[i++];
    if (!r) throw new Error("fakeFetchSequence exhausted");
    return new Response(JSON.stringify(r.body), {
      status: r.status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

// Per-test-file numeric suffix counter. Combined with PORTAL_PREFIX it
// produces unique numeric hub_ids (e.g. "928470001", "928470002", ...)
// that round-trip through `String(identity.hubId)` and are caught by
// the `LIKE '<PORTAL_PREFIX>%'` cleanup in beforeEach.
let nextHubIdSuffix = 1;

function identityResponseForHubId(hubId: number) {
  const identity = loadCassette("oauth-token-identity.json");
  const body = { ...(identity.response.body as Record<string, unknown>) };
  body.hub_id = hubId;
  return {
    status: identity.response.status,
    body,
    portalIdAsText: String(hubId),
  };
}

function freshHubIdForThisFile(): number {
  const suffix = String(nextHubIdSuffix++).padStart(4, "0");
  return Number.parseInt(`${PORTAL_PREFIX}${suffix}`, 10);
}

async function performInstallCallback(hubId?: number): Promise<{ portalIdAsText: string }> {
  const id = hubId ?? freshHubIdForThisFile();
  const ident = identityResponseForHubId(id);
  const exchange = loadCassette("oauth-token-exchange.json");
  const state = signState({
    secret: CONFIG.clientSecret,
    ttlSeconds: CONFIG.stateTtlSeconds,
  });

  const routes = createOAuthRoutes({
    config: CONFIG,
    db,
    fetch: fakeFetchSequence([
      { status: exchange.response.status, body: exchange.response.body },
      { status: ident.status, body: ident.body },
    ]),
  });

  const res = await routes.request(`/callback?code=auth-code&state=${encodeURIComponent(state)}`);
  expect(res.status).toBe(200);
  return { portalIdAsText: ident.portalIdAsText };
}

async function performReinstallCallback(portalIdAsText: string): Promise<void> {
  // Reuse the same portal id — triggers the onConflictDoUpdate path.
  const identity = loadCassette("oauth-token-identity.json");
  const body = { ...(identity.response.body as Record<string, unknown>) };
  body.hub_id = Number.parseInt(portalIdAsText, 10);
  const exchange = loadCassette("oauth-token-exchange.json");
  const state = signState({
    secret: CONFIG.clientSecret,
    ttlSeconds: CONFIG.stateTtlSeconds,
  });

  const routes = createOAuthRoutes({
    config: CONFIG,
    db,
    fetch: fakeFetchSequence([
      { status: exchange.response.status, body: exchange.response.body },
      { status: identity.response.status, body },
    ]),
  });

  const res = await routes.request(`/callback?code=auth-code&state=${encodeURIComponent(state)}`);
  expect(res.status).toBe(200);
}

async function readTenantSettings(portalIdAsText: string): Promise<Record<string, unknown> | null> {
  const rows = await db
    .select()
    .from(schema.tenants)
    .where(eq(schema.tenants.hubspotPortalId, portalIdAsText));
  const row = rows[0];
  if (!row) return null;
  return (row.settings ?? null) as Record<string, unknown> | null;
}

async function setTenantEnrichmentEnabled(portalIdAsText: string, enabled: boolean): Promise<void> {
  // Simulates `PUT /api/settings` writing `enrichmentEnabled` on the
  // tenant's settings JSONB. Slice-12 scope is backend-only (see
  // preflight §5), so we mutate the row directly rather than going
  // through the settings route.
  await db
    .update(schema.tenants)
    .set({ settings: { enrichmentEnabled: enabled } })
    .where(eq(schema.tenants.hubspotPortalId, portalIdAsText));
}

describe("Issue #28 — default-on enrichment for new tenant installs", () => {
  it("fresh install: tenant row has settings.enrichmentEnabled === true", async () => {
    const { portalIdAsText } = await performInstallCallback();

    const settings = await readTenantSettings(portalIdAsText);
    expect(settings).not.toBeNull();
    expect(settings).toEqual(expect.objectContaining({ enrichmentEnabled: true }));
  });

  it("reinstall preserves a user-set enrichmentEnabled=false (no clobber)", async () => {
    const { portalIdAsText } = await performInstallCallback();

    // Fresh install initialised it to true.
    expect(await readTenantSettings(portalIdAsText)).toEqual(
      expect.objectContaining({ enrichmentEnabled: true }),
    );

    // User disables enrichment via Settings UI / PUT /api/settings.
    await setTenantEnrichmentEnabled(portalIdAsText, false);
    expect(await readTenantSettings(portalIdAsText)).toEqual(
      expect.objectContaining({ enrichmentEnabled: false }),
    );

    // Reinstall the same portal — triggers onConflictDoUpdate.
    await performReinstallCallback(portalIdAsText);

    // The .values({...}) default MUST be ignored on conflict; the
    // onConflictDoUpdate.set MUST NOT touch settings.
    expect(await readTenantSettings(portalIdAsText)).toEqual(
      expect.objectContaining({ enrichmentEnabled: false }),
    );
  });

  it("cross-tenant isolation: tenant A's disabled toggle never leaks to tenant B (and B's install never flips A back)", async () => {
    // Tenant A: fresh install → default-on.
    const { portalIdAsText: portalA } = await performInstallCallback();
    expect(await readTenantSettings(portalA)).toEqual(
      expect.objectContaining({ enrichmentEnabled: true }),
    );

    // Tenant A disables enrichment.
    await setTenantEnrichmentEnabled(portalA, false);
    expect(await readTenantSettings(portalA)).toEqual(
      expect.objectContaining({ enrichmentEnabled: false }),
    );

    // Tenant B: a separate portal id — fresh install → default-on.
    const { portalIdAsText: portalB } = await performInstallCallback();
    expect(portalB).not.toBe(portalA);
    expect(await readTenantSettings(portalB)).toEqual(
      expect.objectContaining({ enrichmentEnabled: true }),
    );

    // Tenant A's setting must NOT have been flipped back by tenant B's
    // install path (a write into another tenant's row would be a
    // cross-tenant leakage; CLAUDE.md tenant-isolation rule).
    expect(await readTenantSettings(portalA)).toEqual(
      expect.objectContaining({ enrichmentEnabled: false }),
    );
  });
});
