/**
 * Vercel cron endpoint — `/admin/trigify-poll` (Stage A Task 6).
 *
 * Auth pattern copied EXACTLY from `routes/admin/keep-alive.ts` (same
 * Bearer CRON_SECRET convention, same constant-time compare, same error
 * codes/status shape) so operators only need to reason about one cron auth
 * pattern in this app.
 *
 * For every tenant with an enabled `trigify` provider row: pull the free
 * social-signals feed, normalize, match to a HubSpot company, upsert into
 * `signals` idempotent on `(tenantId, dedupeKey)`. READS ONLY — see
 * `services/trigify/poller.ts` file header for the zero-credit-spend hard
 * scope rule. Schedule lives in `apps/api/vercel.json` -> `crons[]`.
 *
 * Auth:
 *   - Header `Authorization: Bearer <CRON_SECRET>`.
 *   - Missing env -> 503 `trigify_poll_not_configured`.
 *   - Missing/malformed header -> 401 `missing_cron_token`.
 *   - Wrong bearer -> 403 `invalid_cron_token`.
 *
 * Success: 200 JSON `{ status: "ok", tenantsPolled, signalsRecorded,
 * skipped, errors, timestamp }`. A per-tenant poll failure does NOT fail
 * the whole request — it's surfaced in `errors[]` so one tenant's outage
 * never blocks the cron tick for everyone else.
 *
 * Failure: the poll driver itself throwing (e.g. a DB connection failure
 * before any tenant loop starts) -> 503 `poll_failed`. The underlying error
 * message is NEVER echoed to the caller (could contain connection strings,
 * table names, or other infrastructure details) — mirrors `keep-alive.ts`.
 */

import { timingSafeEqual } from "node:crypto";
import type { Context } from "hono";
import type { PollAllTenantsResult } from "../../services/trigify/poller.js";

const BEARER_PREFIX = "Bearer ";

export type TrigifyPollDeps = {
  /** Run the full multi-tenant poll. Throws only on a driver-level failure. */
  poll: () => Promise<PollAllTenantsResult>;
  /** Env source (defaults to process.env). Override in tests. */
  env?: Record<string, string | undefined>;
};

/** Length-safe constant-time string compare. Mirrors `keep-alive.ts`. */
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
 * Build the trigify-poll route handler. Mount with
 * `app.get("/admin/trigify-poll", createTrigifyPollHandler({...}))` —
 * registered as a direct handler (not a sub-app), mirroring `keep-alive.ts`'s
 * production-routing fix (a sub-app + inner `app.get("/")` registers the
 * path WITH a trailing slash in Hono's production router, 404ing the bare
 * path Vercel cron hits).
 */
export function createTrigifyPollHandler(deps: TrigifyPollDeps) {
  const env = deps.env ?? process.env;

  return async (c: Context) => {
    const expected = env.CRON_SECRET;
    if (!expected || expected.length === 0) {
      return c.json({ error: "trigify_poll_not_configured" }, 503);
    }

    const provided = extractBearer(c.req.header("authorization"));
    if (!provided) {
      return c.json({ error: "missing_cron_token" }, 401);
    }
    if (!safeEquals(provided, expected)) {
      return c.json({ error: "invalid_cron_token" }, 403);
    }

    let summary: PollAllTenantsResult;
    try {
      summary = await deps.poll();
    } catch {
      return c.json({ error: "poll_failed" }, 503);
    }

    return c.json(
      {
        status: "ok",
        tenantsPolled: summary.tenantsPolled,
        signalsRecorded: summary.signalsRecorded,
        skipped: summary.skipped,
        errors: summary.errors,
        timestamp: new Date().toISOString(),
      },
      200,
    );
  };
}
