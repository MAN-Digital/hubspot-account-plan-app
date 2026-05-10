/**
 * Issue #16 / slice-12 Wave B — OAuth install success page.
 *
 * Verifies the polished `htmlSuccess(...)` helper introduced alongside
 * `htmlError(...)` in apps/api/src/routes/oauth.ts:
 *   1. `htmlSuccess(...)` returns a CSP-compliant HTML document with a
 *      user-initiated CTA back to HubSpot.
 *   2. The /oauth/callback success path (no returnUrl) renders that page
 *      and not the previous htmlError-as-success fallback.
 *   3. The /oauth/callback success path with a valid `returnUrl` still
 *      302-redirects unchanged.
 *
 * Contract reference: docs/slice-12-preflight-notes.md §3.
 */

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as schema from "@hap/db";
import { createDatabase, createTestClient } from "@hap/db";
import { eq, like } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { signState } from "../lib/oauth.js";
import { createOAuthRoutes, htmlSuccess } from "../routes/oauth.js";

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

const PORTAL_PREFIX = `slice12success-${randomUUID().slice(0, 8)}-`;

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

function identityResponseForPortal(portalId: string) {
  const identity = loadCassette("oauth-token-identity.json");
  const body = { ...(identity.response.body as Record<string, unknown>) };
  body.hub_id = Number.parseInt(portalId.replace(/\D/g, "").slice(0, 9) || "146425426", 10);
  return {
    status: identity.response.status,
    body,
    portalIdAsText: String(body.hub_id),
  };
}

describe("htmlSuccess helper", () => {
  it("returns a CSP-compliant HTML document with a user-initiated CTA to HubSpot", () => {
    const html = htmlSuccess(
      "Install successful",
      "Signal-First Account Workspace is now connected to portal qa-account.example.com.",
    );

    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toMatch(/<a[^>]*href="https:\/\/app\.hubspot\.com\/"/);
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<iframe");
    expect(html).not.toMatch(/<meta\s+http-equiv=["']?refresh["']?/i);
  });

  it("escapes interpolated values to prevent HTML injection", () => {
    const html = htmlSuccess('Install <script>alert(1)</script> "ok"', "portal & domain <hack>");
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<hack>");
    expect(html).not.toContain('"ok"');
    expect(html).toContain("&#60;");
    expect(html).toContain("&#62;");
    expect(html).toContain("&#38;");
  });

  it("never echoes a region-specific HubSpot domain in the primary CTA", () => {
    const html = htmlSuccess("Install successful", "portal abc");
    expect(html).not.toContain("app-eu1.hubspot.com");
    expect(html).not.toContain("app-na1.hubspot.com");
  });
});

describe("GET /oauth/callback — polished success page (no returnUrl)", () => {
  it("renders htmlSuccess (not htmlError) and includes the CTA back to HubSpot", async () => {
    const ident = identityResponseForPortal(`${PORTAL_PREFIX}${randomUUID().slice(0, 4)}`);
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
    expect(res.headers.get("content-type") ?? "").toMatch(/text\/html/);

    const body = await res.text();
    expect(body).toMatch(/<a[^>]*href="https:\/\/app\.hubspot\.com\/"/);
    expect(body).toContain("qa-account.example.com");
    // No meta-refresh — the 302-to-returnUrl branch handles auto-redirect.
    expect(body).not.toMatch(/<meta\s+http-equiv=["']?refresh["']?/i);
    // No inline script or third-party assets.
    expect(body).not.toContain("<script");
    expect(body).not.toContain("<iframe");

    // Cleanup
    const tenantRows = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.hubspotPortalId, ident.portalIdAsText));
    const tenantId = tenantRows[0]?.id;
    if (tenantId) {
      await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    }
  });

  it("falls back to portalIdAsText in success copy when hub_domain is empty", async () => {
    // Locks the documented `identity.hubDomain || portalIdAsText` fallback
    // (oauth.ts success path). If hub_domain comes back empty from
    // HubSpot, the success page MUST identify the connection by portal id,
    // not by an empty string. Addresses CodeRabbit coverage nit on PR #34.
    const ident = identityResponseForPortal(`${PORTAL_PREFIX}${randomUUID().slice(0, 4)}`);
    const identBodyEmptyDomain = {
      ...(ident.body as Record<string, unknown>),
      hub_domain: "",
    };
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
        { status: ident.status, body: identBodyEmptyDomain },
      ]),
    });

    const res = await routes.request(`/callback?code=auth-code&state=${encodeURIComponent(state)}`);
    expect(res.status).toBe(200);

    const body = await res.text();
    // Must NOT mention the (now empty) hub_domain.
    expect(body).not.toContain("qa-account.example.com");
    // MUST identify the connection by numeric portal id instead.
    expect(body).toContain(ident.portalIdAsText);

    // Cleanup
    const tenantRows = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.hubspotPortalId, ident.portalIdAsText));
    const tenantId = tenantRows[0]?.id;
    if (tenantId) {
      await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    }
  });
});

describe("GET /oauth/callback — returnUrl regression guard", () => {
  it("still 302-redirects when HubSpot supplies a valid returnUrl (no HTML body)", async () => {
    const ident = identityResponseForPortal(`${PORTAL_PREFIX}${randomUUID().slice(0, 4)}`);
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

    const returnUrl = "https://app.hubspot.com/some-marketplace-finalize-page";
    const res = await routes.request(
      `/callback?code=auth-code&state=${encodeURIComponent(state)}&returnUrl=${encodeURIComponent(returnUrl)}`,
    );

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(returnUrl);

    // Cleanup
    const tenantRows = await db
      .select()
      .from(schema.tenants)
      .where(eq(schema.tenants.hubspotPortalId, ident.portalIdAsText));
    const tenantId = tenantRows[0]?.id;
    if (tenantId) {
      await db.delete(schema.tenants).where(eq(schema.tenants.id, tenantId));
    }
  });
});
