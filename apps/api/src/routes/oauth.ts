/**
 * Slice 3 Task 3b — OAuth install + callback routes.
 *
 * Mounted in `apps/api/src/index.ts` at `/oauth/*`, BEFORE `authMiddleware`
 * + `tenantMiddleware`. Both routes are deliberately unauthenticated:
 *   - `/oauth/install` runs pre-install (no tenant yet).
 *   - `/oauth/callback` creates or updates the tenant — the `tenantMiddleware`
 *     would have no tenant to resolve at this point.
 *
 * Callback flow (enforced order, see Solution Approach in the Slice 3 plan):
 *   1. Validate query error/state (tampering + expiry).
 *   2. Exchange code → access/refresh tokens.
 *   3. Fetch token identity → hub_id (portal id) + granted scopes.
 *   4. Upsert `tenants` ON CONFLICT(hubspot_portal_id).
 *   5. Encrypt tokens with the per-tenant KEK (`encryptProviderKey`).
 *   6. Upsert `tenant_hubspot_oauth` ON CONFLICT(tenant_id).
 *   7. Redirect to the HubSpot-supplied `returnUrl` (if any) or a success
 *      page.
 *
 * Error-UX:
 *   - Tampered/expired state → 400 friendly HTML.
 *   - HubSpot `error=access_denied` → 400 friendly HTML.
 *   - Token-exchange or identity 4xx → 502 (upstream failure, not user
 *     error). We surface the status code only — tokens or server errors
 *     are never echoed to the user.
 */

import { tenantHubspotOauth, tenants } from "@hap/db";
import { sql } from "drizzle-orm";
import { Hono } from "hono";
import { encryptProviderKey } from "../lib/encryption.js";
import {
  buildAuthorizeUrl,
  exchangeCodeForTokens,
  fetchTokenIdentity,
  OAuthHttpError,
  OAuthStateError,
  OAuthStateExpiredError,
  refreshAccessToken,
  signState,
  verifyState,
} from "../lib/oauth.js";

export type OAuthConfig = {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  /** TTL for the signed state value. Default 600 (10 min). */
  stateTtlSeconds: number;
};

export type OAuthDeps = {
  config: OAuthConfig;
  /** Drizzle handle. Never the global one at test time. */
  db: unknown;
  /** Injectable fetch for cassette-based tests. Defaults to global fetch. */
  fetch?: typeof fetch;
};

// Minimal drizzle contract for this route — avoids pulling the concrete
// drizzle-orm/postgres-js type into module tests. Route-internal only.
type OAuthDb = {
  insert: (table: unknown) => {
    values: (row: Record<string, unknown>) => {
      onConflictDoUpdate: (args: { target: unknown; set: Record<string, unknown> }) => {
        returning: () => Promise<{ id: string }[]>;
      };
      returning: () => Promise<{ id: string }[]>;
    };
  };
};

/**
 * Validate returnUrl to prevent open-redirect (CodeRabbit C1).
 * Only allow HubSpot-origin URLs — the returnUrl is supplied by HubSpot's
 * install flow and should always point back to a HubSpot domain.
 */
function isAllowedReturnUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === "app.hubspot.com" ||
      host.endsWith(".hubspot.com") ||
      host.endsWith(".hubspotpreview-na1.com") ||
      /\.hubspotpreview-[a-z0-9-]+\.com$/.test(host)
    );
  } catch {
    return false;
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[<>&"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

function htmlError(title: string, detail: string): string {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  return `<!doctype html><html><head><meta charset="utf-8"><title>${safeTitle}</title></head><body><h1>${safeTitle}</h1><p>${safeDetail}</p></body></html>`;
}

/**
 * Polished post-install success page (slice-12 / Issue #16).
 *
 * Rendered when the HubSpot install completes without a `returnUrl` query
 * parameter (or with one that fails the `isAllowedReturnUrl` open-redirect
 * guard). When HubSpot DOES supply a valid `returnUrl`, the route uses a
 * 302 redirect upstream of this helper — by the time `htmlSuccess` is
 * called, that path has already been proven unavailable, which is why
 * there is intentionally no `<meta http-equiv="refresh">` tag here (would
 * be dead code; see docs/slice-12-preflight-notes.md §3).
 *
 * CSP guarantees by construction:
 *   - No inline `<script>`, no `<iframe>`, no third-party assets, no web
 *     fonts, no remote images.
 *   - All interpolated values flow through `escapeHtml(...)`.
 *   - Primary CTA is a plain `<a>` to the region-agnostic
 *     https://app.hubspot.com/ root — never an `app-eu1.hubspot.com` or
 *     other region-specific origin (would mis-route US installs).
 */
export function htmlSuccess(title: string, detail: string): string {
  const safeTitle = escapeHtml(title);
  const safeDetail = escapeHtml(detail);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${safeTitle}</title><style>:root{color-scheme:light dark}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;line-height:1.5;margin:0;padding:48px 24px;display:flex;justify-content:center;background:#f6f8fb;color:#1f2937}main{max-width:520px;width:100%;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(16,24,40,.08),0 1px 2px rgba(16,24,40,.04);padding:40px 32px;text-align:center}.badge{display:inline-flex;align-items:center;justify-content:center;width:48px;height:48px;border-radius:999px;background:#e8f5ee;color:#0a7a3b;font-size:24px;font-weight:600;margin-bottom:16px}h1{font-size:22px;font-weight:600;margin:0 0 12px}p{font-size:15px;color:#4b5563;margin:0 0 24px}.cta{display:inline-block;padding:10px 20px;border-radius:8px;background:#ff7a59;color:#fff;text-decoration:none;font-weight:600;font-size:15px}.cta:hover{background:#e8623f}@media (prefers-color-scheme:dark){body{background:#0f172a;color:#e5e7eb}main{background:#1e293b;box-shadow:0 1px 3px rgba(0,0,0,.4)}p{color:#cbd5e1}.badge{background:#0a7a3b;color:#e8f5ee}}</style></head><body><main><div class="badge" aria-hidden="true">&#10003;</div><h1>${safeTitle}</h1><p>${safeDetail}</p><a class="cta" href="https://app.hubspot.com/">Return to HubSpot</a></main></body></html>`;
}

export function createOAuthRoutes(deps: OAuthDeps) {
  const { config } = deps;
  const db = deps.db as OAuthDb;
  const fetchImpl = deps.fetch ?? fetch;

  const app = new Hono();

  // -------------------------------------------------------------------------
  // GET /install — redirects to HubSpot's authorize URL with fresh state
  // -------------------------------------------------------------------------
  app.get("/install", (c) => {
    const state = signState({
      secret: config.clientSecret,
      ttlSeconds: config.stateTtlSeconds,
    });
    const url = buildAuthorizeUrl({
      clientId: config.clientId,
      redirectUri: config.redirectUri,
      scopes: config.scopes,
      state,
    });
    return c.redirect(url, 302);
  });

  // -------------------------------------------------------------------------
  // GET /callback — full ordered upsert flow documented above
  // -------------------------------------------------------------------------
  app.get("/callback", async (c) => {
    const error = c.req.query("error");
    if (error) {
      const description = c.req.query("error_description") ?? "(no description)";
      return c.html(htmlError("Install declined", `${error}: ${description}`), 400);
    }

    const code = c.req.query("code");
    const state = c.req.query("state");
    if (!code || !state) {
      return c.html(htmlError("Install failed", "missing required query parameters"), 400);
    }

    // Step 1 — state verification (tampering + expiry only; see
    // SECURITY.md §16.2 for the stateless-state tradeoff).
    try {
      verifyState({ secret: config.clientSecret, state, now: Date.now() });
    } catch (err) {
      if (err instanceof OAuthStateExpiredError) {
        return c.html(
          htmlError(
            "Install link expired",
            "This install link has expired. Click the Install button in HubSpot again.",
          ),
          400,
        );
      }
      if (err instanceof OAuthStateError) {
        return c.html(
          htmlError(
            "Install failed",
            "state validation failed — request did not originate from this app",
          ),
          400,
        );
      }
      throw err;
    }

    // Step 2 — exchange code for tokens.
    let tokens: Awaited<ReturnType<typeof exchangeCodeForTokens>>;
    try {
      tokens = await exchangeCodeForTokens({
        clientId: config.clientId,
        clientSecret: config.clientSecret,
        code,
        redirectUri: config.redirectUri,
        fetch: fetchImpl,
      });
    } catch (err) {
      if (err instanceof OAuthHttpError) {
        return c.html(
          htmlError("HubSpot token exchange failed", `upstream returned ${err.status}`),
          502,
        );
      }
      throw err;
    }

    // Step 3 — identity (hub_id + scopes).
    let identity: Awaited<ReturnType<typeof fetchTokenIdentity>>;
    try {
      identity = await fetchTokenIdentity({
        accessToken: tokens.accessToken,
        fetch: fetchImpl,
      });
    } catch (err) {
      if (err instanceof OAuthHttpError) {
        return c.html(
          htmlError("HubSpot identity lookup failed", `upstream returned ${err.status}`),
          502,
        );
      }
      throw err;
    }

    const portalIdAsText = String(identity.hubId);

    // Step 4 — upsert tenant keyed on hubspot_portal_id (source of truth
    // for portal identity; see plan Solution Approach).
    const tenantInsert = await db
      .insert(tenants)
      .values({
        hubspotPortalId: portalIdAsText,
        name: identity.hubDomain || portalIdAsText,
        settings: { enrichmentEnabled: true },
      })
      .onConflictDoUpdate({
        target: tenants.hubspotPortalId,
        set: {
          isActive: true,
          deactivatedAt: null,
          deactivationReason: null,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    const tenantRow = tenantInsert[0];
    if (!tenantRow) {
      return c.html(htmlError("Install failed", "tenant upsert did not return a row"), 500);
    }
    const tenantId = tenantRow.id;

    // Step 5 — encrypt tokens with the per-tenant KEK.
    const accessTokenEncrypted = encryptProviderKey(tenantId, tokens.accessToken);
    const refreshTokenEncrypted = encryptProviderKey(tenantId, tokens.refreshToken);
    const expiresAt = new Date(Date.now() + tokens.expiresIn * 1000);

    // Step 6 — upsert tenant_hubspot_oauth keyed on tenant_id.
    await db
      .insert(tenantHubspotOauth)
      .values({
        tenantId,
        accessTokenEncrypted,
        refreshTokenEncrypted,
        expiresAt,
        scopes: identity.scopes,
      })
      .onConflictDoUpdate({
        target: tenantHubspotOauth.tenantId,
        set: {
          accessTokenEncrypted,
          refreshTokenEncrypted,
          expiresAt,
          scopes: identity.scopes,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    // Step 7 — redirect. HubSpot passes `returnUrl` on some install flows.
    // SECURITY (CodeRabbit C1): validate returnUrl to prevent open-redirect.
    // Only allow HubSpot-origin URLs or relative paths.
    const returnUrl = c.req.query("returnUrl");
    if (returnUrl && isAllowedReturnUrl(returnUrl)) {
      return c.redirect(returnUrl, 302);
    }
    return c.html(
      htmlSuccess(
        "Install successful",
        `Signal-First Account Workspace is now connected to portal ${identity.hubDomain || portalIdAsText}. Next, open the app settings in HubSpot to finish setup. You can close this tab when you are done, or return to HubSpot to continue.`,
      ),
      200,
    );
  });

  return app;
}

// Stub export so `refreshAccessToken` is reachable via the module (used by
// the Task 4 hubspot-client refactor). Keeping the import live so it does
// not get tree-shaken or flagged as unused.
export { refreshAccessToken };
