import { resolveHubSpotOAuthRedirectUri } from "@hap/config";
import { createDatabase, sql as drizzleSql } from "@hap/db";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { assertDbRoleEnforcesRls } from "./lib/db-role-guard.js";
import { sweepExpiredNonces } from "./lib/replay-nonce.js";
import { withTenantTxHandle } from "./lib/tenant-tx.js";
import { authMiddleware } from "./middleware/auth.js";
import { type CorrelationVariables, correlationMiddleware } from "./middleware/correlation.js";
import { nonceMiddleware } from "./middleware/nonce.js";
import { type TenantVariables, tenantMiddleware } from "./middleware/tenant.js";
import { createKeepAliveHandler } from "./routes/admin/keep-alive.js";
import { createLifecycleBootstrapRoute } from "./routes/admin/lifecycle-bootstrap.js";
import { createTrigifyPollHandler } from "./routes/admin/trigify-poll.js";
import { lifecycleWebhookRoutes } from "./routes/lifecycle.js";
import { createOAuthRoutes } from "./routes/oauth.js";
import { settingsRoutes } from "./routes/settings.js";
import { createSettingsTrigifyRoute } from "./routes/settings-trigify.js";
import { snapshotRoutes } from "./routes/snapshot.js";
import { createDbPollAllTenantsDeps } from "./services/trigify/poll-deps.js";
import { pollAllTenants } from "./services/trigify/poller.js";

type AppVars = TenantVariables & CorrelationVariables & { portalId?: string; rawBody?: string };

/**
 * Resolve the allowed CORS origin for a given request origin.
 *
 * Allow:
 *   - https://app.hubspot.com
 *   - https://*.hubspot.com
 *   - https://*.hubspotpreview-na1.com (and other regional preview hosts)
 *   - `*` ONLY in explicit dev/test (NODE_ENV === 'development' | 'test')
 *
 * The permissive branch is gated on an explicit allow-list rather than
 * `!== 'production'` so that an environment with NODE_ENV unset or set to an
 * unexpected value (e.g. a misconfigured preview deploy) fails closed to the
 * HubSpot allow-list instead of reflecting arbitrary origins (audit M4).
 */
function isDevLikeEnv(): boolean {
  return process.env.NODE_ENV === "development" || process.env.NODE_ENV === "test";
}

function resolveCorsOrigin(origin: string): string | null {
  if (!origin) {
    return isDevLikeEnv() ? "*" : null;
  }
  try {
    const url = new URL(origin);
    const host = url.hostname;
    if (host === "app.hubspot.com") return origin;
    if (host.endsWith(".hubspot.com")) return origin;
    if (host.endsWith(".hubspotpreview-na1.com")) return origin;
    if (/\.hubspotpreview-[a-z0-9-]+\.com$/.test(host)) return origin;
  } catch {
    // Fall through to dev/test permissive branch below
  }
  if (isDevLikeEnv()) return origin || "*";
  return null;
}

const app = new Hono<{ Variables: AppVars }>();

// Correlation middleware MUST be first — every request (including auth
// failures and CORS preflights) needs an X-Request-Id for Phase 5 QA tracing.
app.use("*", correlationMiddleware());

app.use(
  "*",
  cors({
    origin: (origin) => resolveCorsOrigin(origin ?? ""),
    allowMethods: ["GET", "POST", "PUT", "OPTIONS"],
    allowHeaders: ["Authorization", "Content-Type", "x-test-portal-id"],
    credentials: false,
    maxAge: 600,
  }),
);

// Public health endpoint — no auth, no tenant.
app.get("/health", (c) => {
  return c.json({ status: "ok", timestamp: new Date().toISOString() });
});

/**
 * Memoized db handle, keyed by DATABASE_URL so test cases that mutate the
 * env between requests still get a fresh client. In production the URL is
 * stable and we keep one wrapper per process — postgres.js handles the
 * actual connection pool internally. Without this we'd build a brand new
 * client on every request, churning sockets in the hot path.
 */
let cachedDb: { url: string; db: ReturnType<typeof createDatabase> } | null = null;
function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    // No production fallback. The app-level middleware runs before the
    // snapshot route's own DB check, so without this guard a misconfigured
    // deployment could silently authenticate tenants against localhost's
    // dev database. Fail loud at the first request instead.
    throw new Error(
      "DATABASE_URL is not set. The API refuses to fall back to a default dev URL in any environment.",
    );
  }
  if (cachedDb && cachedDb.url === url) return cachedDb.db;
  const db = createDatabase(url);
  cachedDb = { url, db };
  return db;
}

/**
 * Memoized RLS-role safety check (C1). The first authenticated request per
 * cold start verifies the connected DB role actually enforces RLS; the result
 * is cached so the check runs once, not on every request. In production a
 * bypass role (superuser/BYPASSRLS) rejects here — failing closed before any
 * tenant data is served — because RLS is the database-level tenant boundary
 * and it is inert under such a role. On failure we clear the cache so a
 * transient DB blip can be retried; a genuine misconfiguration keeps failing.
 */
let dbRoleCheck: Promise<void> | null = null;
function ensureDbRoleEnforcesRls(): Promise<void> {
  if (!dbRoleCheck) {
    dbRoleCheck = assertDbRoleEnforcesRls(getDb()).catch((error) => {
      dbRoleCheck = null;
      throw error;
    });
  }
  return dbRoleCheck;
}

// Memoize the tenant middleware too so we build it once per process,
// not on every request. The middleware itself is stateless given a db handle.
let cachedTenantMw: ReturnType<typeof tenantMiddleware> | null = null;
let cachedTenantMwForDb: ReturnType<typeof createDatabase> | null = null;
function getTenantMw() {
  const db = getDb();
  if (cachedTenantMw && cachedTenantMwForDb === db) return cachedTenantMw;
  cachedTenantMw = tenantMiddleware({ db });
  cachedTenantMwForDb = db;
  return cachedTenantMw;
}

// OAuth install + callback routes — mounted BEFORE auth middleware because
// these endpoints are unauthenticated by design (no tenant exists yet at
// install time; the callback creates the tenant).
app.route(
  "/oauth",
  createOAuthRoutes({
    config: {
      clientId: process.env.HUBSPOT_CLIENT_ID ?? "",
      clientSecret: process.env.HUBSPOT_CLIENT_SECRET ?? "",
      redirectUri: resolveHubSpotOAuthRedirectUri(),
      scopes: ["oauth", "crm.objects.companies.read", "crm.objects.contacts.read"],
      stateTtlSeconds: 600,
    },
    db: getDb(),
  }),
);

// HubSpot app-lifecycle webhook receiver — mounted OUTSIDE `/api/*` because
// deliveries come from HubSpot, not from an authenticated user session, and
// so they skip auth/tenant/nonce middleware. Authenticity is proven by the
// route's internal v3 signature check (see routes/lifecycle.ts).
app.route("/webhooks/hubspot/lifecycle", lifecycleWebhookRoutes({ db: getDb() }));

// Operator-only lifecycle subscription bootstrap — mounted OUTSIDE `/api/*`
// and the tenant middleware because it is gated on a static internal token
// rather than a HubSpot-signed request. Mirrors the webhook mount posture.
app.route("/admin/lifecycle", createLifecycleBootstrapRoute());

// Vercel cron — daily `select 1` + nonce TTL sweep. Mounted OUTSIDE `/api/*`
// because the caller is Vercel's scheduler, not an authenticated tenant. Auth
// is `Authorization: Bearer <CRON_SECRET>` (Vercel cron convention). Schedule
// lives in `apps/api/vercel.json` -> `crons[]`.
//
// Registered as a direct handler (not via `app.route` sub-app) because the
// sub-app + inner `app.get("/")` pattern that PR #46 used registers the path
// as `/admin/keep-alive/` in Hono's production router and 404s on the bare
// `/admin/keep-alive` path that Vercel cron + curl hit.
app.get(
  "/admin/keep-alive",
  createKeepAliveHandler({
    ping: async () => {
      await getDb().execute(drizzleSql`select 1`);
    },
    sweep: () => sweepExpiredNonces(getDb()),
  }),
);

// Trigify signal-feed poll — Vercel cron (daily, Hobby-plan limit) +
// GitHub Actions (6-hourly, see .github/workflows/trigify-poll.yml).
// Mounted OUTSIDE `/api/*` for the same reason as `/admin/keep-alive`: the
// caller is a scheduler, not an authenticated tenant. Auth is
// `Authorization: Bearer <CRON_SECRET>` — same convention, same handler
// shape as keep-alive. Schedule lives in `apps/api/vercel.json` -> `crons[]`.
//
// Registered as a direct handler (not a sub-app) for the identical reason
// documented on `/admin/keep-alive` above: a sub-app + inner `app.get("/")`
// registers the path WITH a trailing slash in Hono's production router and
// 404s on the bare path Vercel cron + the GHA workflow hit.
//
// Task 16 fix: this route existed (`routes/admin/trigify-poll.ts`) and was
// scheduled in `vercel.json`, but was NEVER mounted here — every real
// invocation 404'd. `createDbPollAllTenantsDeps` (services/trigify/poll-deps.ts)
// is the real-database wiring `poll` calls.
app.get(
  "/admin/trigify-poll",
  createTrigifyPollHandler({
    poll: () => pollAllTenants(createDbPollAllTenantsDeps(getDb())),
  }),
);

// Composed middleware chain for /api/* routes: auth -> tenant -> route.
app.use("/api/*", authMiddleware());
app.use("/api/*", async (c, next) => {
  const mw = getTenantMw();
  return mw(c, next);
});
app.use("/api/*", async (c, next) => {
  const tenantId = c.get("tenantId");
  if (!tenantId) {
    return next();
  }

  // Fail closed before serving tenant data if the DB role bypasses RLS.
  await ensureDbRoleEnforcesRls();

  const handle = await withTenantTxHandle(getDb(), tenantId);
  c.set("db", handle);
  try {
    await next();
    await handle.release();
  } catch (error) {
    await handle.abort(error instanceof Error ? error : new Error(String(error)));
    throw error;
  } finally {
    c.set("db", undefined);
  }
});
app.use("/api/*", nonceMiddleware());

app.route("/api/settings", settingsRoutes);
app.route("/api/settings/trigify", createSettingsTrigifyRoute());
app.route("/api/snapshot", snapshotRoutes);

export default app;
