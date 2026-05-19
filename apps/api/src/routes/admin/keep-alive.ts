/**
 * Slice 12 follow-up — Vercel cron endpoint to prevent Supabase auto-pause.
 *
 * GET /admin/keep-alive
 *   Mounted as a direct handler on the main Hono app (NOT a sub-app via
 *   `app.route`). The sub-app pattern with an inner `app.get("/")` registers
 *   the route as `/admin/keep-alive/` (with trailing slash) in Hono's
 *   production router, which doesn't match the bare `/admin/keep-alive` path
 *   that Vercel cron + curl hit. Direct registration sidesteps that quirk.
 *   The original sub-app implementation in PR #46 produced a 404 in
 *   production despite passing all local tests — see follow-up PR for
 *   the post-mortem.
 *
 *   Pings the DB (caller-supplied `ping`) and sweeps expired
 *   signed_request_nonce rows (caller-supplied `sweep`). Two birds:
 *     1) keep the Supabase free-tier project from auto-pausing after ~7d
 *        of DB inactivity
 *     2) actually run the long-dangling nonce TTL sweep the schema comment
 *        in signed-request-nonce.ts has promised since slice 3
 *
 * Auth:
 *   - Header `Authorization: Bearer <CRON_SECRET>` (Vercel cron convention).
 *   - Constant-time compare via length-safe `timingSafeEqual`.
 *   - Missing env  -> 503 `keepalive_not_configured`.
 *   - Missing/malformed header -> 401 `missing_cron_token`.
 *   - Wrong bearer (any length) -> 403 `invalid_cron_token`.
 *
 * Success:
 *   - 200 JSON `{ status: "ok", dbPingMs, sweptNonces, timestamp }`.
 *
 * Failure:
 *   - Ping or sweep throws -> 503 `database_unreachable`. We never leak
 *     the underlying error message (could contain host:port, table names,
 *     or other infrastructure details).
 */

import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";

const BEARER_PREFIX = "Bearer ";

export type KeepAliveDeps = {
  /** Run a cheap DB round-trip (e.g. `select 1`). Throws on unreachable DB. */
  ping: () => Promise<void>;
  /** Sweep expired signed_request_nonce rows. Returns count deleted. */
  sweep: () => Promise<{ deletedCount: number }>;
  /** Env source (defaults to process.env). Override in tests. */
  env?: Record<string, string | undefined>;
};

/**
 * Length-safe constant-time string compare. Mirrors the pattern used in
 * `lifecycle-bootstrap.ts` and `middleware/hubspot-signature.ts`.
 */
function safeEquals(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, "utf8");
  const bBuf = Buffer.from(b, "utf8");
  if (aBuf.byteLength !== bBuf.byteLength) {
    const padded = Buffer.alloc(aBuf.byteLength);
    timingSafeEqual(aBuf, padded);
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}

function extractBearer(header: string | undefined): string | null {
  if (!header?.startsWith(BEARER_PREFIX)) return null;
  const token = header.slice(BEARER_PREFIX.length);
  return token.length === 0 ? null : token;
}

/**
 * Build the keep-alive route handler. Mount with
 * `app.get("/admin/keep-alive", createKeepAliveHandler({...}))`.
 *
 * Returns a Hono handler rather than a sub-app on purpose — see file
 * header for the production-routing reason.
 */
export function createKeepAliveHandler(deps: KeepAliveDeps) {
  const env = deps.env ?? process.env;

  return async (c: Context) => {
    const expected = env.CRON_SECRET;
    if (!expected || expected.length === 0) {
      return c.json({ error: "keepalive_not_configured" }, 503);
    }

    const provided = extractBearer(c.req.header("authorization"));
    if (!provided) {
      return c.json({ error: "missing_cron_token" }, 401);
    }
    if (!safeEquals(provided, expected)) {
      return c.json({ error: "invalid_cron_token" }, 403);
    }

    const startedAt = Date.now();
    try {
      await deps.ping();
    } catch {
      return c.json({ error: "database_unreachable" }, 503);
    }
    const dbPingMs = Date.now() - startedAt;

    let sweptNonces: number;
    try {
      const swept = await deps.sweep();
      sweptNonces = swept.deletedCount;
    } catch {
      return c.json({ error: "database_unreachable" }, 503);
    }

    return c.json(
      {
        status: "ok",
        dbPingMs,
        sweptNonces,
        timestamp: new Date().toISOString(),
      },
      200,
    );
  };
}
