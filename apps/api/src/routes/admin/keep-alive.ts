/**
 * Slice 12 follow-up — Vercel cron endpoint to prevent Supabase auto-pause.
 *
 * GET /admin/keep-alive
 *   Mounted OUTSIDE /api/* and the tenant middleware because it is invoked
 *   by Vercel's scheduler, not by an authenticated tenant. Mirrors the
 *   /admin/lifecycle/bootstrap mount posture.
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
 *   - Missing env  -> 503 `keepalive_not_configured` (loud failure surfaces
 *     in Vercel cron alerts; never 500).
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
import { Hono } from "hono";

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
 * `lifecycle-bootstrap.ts` and `middleware/hubspot-signature.ts`:
 * `timingSafeEqual` throws on unequal `Buffer.byteLength`, so we gate on
 * length and still burn a compare against a padded buffer to keep timing
 * roughly flat across length-mismatch and content-mismatch paths.
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

export function createKeepAliveRoute(deps: KeepAliveDeps) {
  const env = deps.env ?? process.env;
  const app = new Hono();

  app.get("/", async (c) => {
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
  });

  return app;
}
