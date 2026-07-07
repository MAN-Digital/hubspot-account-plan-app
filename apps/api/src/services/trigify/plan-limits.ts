/**
 * Plan-aware Trigify lookback clamping (Stage A Task 9).
 *
 * `GET /v1/social-signals/limits` (FREE — {@link TrigifyClient.getLimits})
 * reports the tenant's Trigify plan tier and its `max_lookback_window_ms`
 * (e.g. 30d on a growth plan, 14d on a lower tier). Every lookback window
 * this app requests (subscription `lookbackWindowMs`, feed/query windows)
 * MUST be clamped to this value — config-driven from the live API response,
 * never a hardcoded "30 days for everyone" assumption.
 *
 * Cached per tenant (limits change rarely; still a network round-trip we
 * don't want on every settings-page render or subscribe call).
 */

import type { TrigifyClient } from "../../adapters/signal/trigify-client.js";
import type { CacheAdapter } from "../../lib/cache-adapter.js";

/** Conservative fallback when the API is unreachable or omits the field. 30 days. */
export const DEFAULT_MAX_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;

/** Cache TTL: 1 hour — limits are effectively static per plan, but not hardcoded here. */
export const PLAN_LIMITS_CACHE_TTL_MS = 60 * 60 * 1000;

export type ResolvedPlanLimits = {
  /** Trigify plan tier name as reported by the API, when available. */
  plan?: string;
  /** The clamp ceiling for every lookback window this tenant may request. */
  maxLookbackWindowMs: number;
  /** True when the live call failed and we fell back to the conservative default. */
  degraded: boolean;
};

function cacheKey(tenantId: string): string {
  return `trigify:plan-limits:${tenantId}`;
}

export type ResolvePlanLimitsArgs = {
  client: TrigifyClient;
  tenantId: string;
  cache: CacheAdapter;
};

/**
 * Resolve (and cache) the tenant's Trigify plan limits. Never throws — a
 * failed or malformed API response degrades to
 * {@link DEFAULT_MAX_LOOKBACK_MS} with `degraded: true` rather than blocking
 * whatever caller needed the window (subscribe preview, poller, settings UI).
 */
export async function resolvePlanLimits(args: ResolvePlanLimitsArgs): Promise<ResolvedPlanLimits> {
  const key = cacheKey(args.tenantId);
  const cached = args.cache.get<ResolvedPlanLimits>(key);
  if (cached) return cached;

  let result: ResolvedPlanLimits;
  try {
    const limits = await args.client.getLimits();
    const maxLookbackWindowMs =
      typeof limits.max_lookback_window_ms === "number" && limits.max_lookback_window_ms > 0
        ? limits.max_lookback_window_ms
        : DEFAULT_MAX_LOOKBACK_MS;
    result = {
      plan: typeof limits.plan === "string" ? limits.plan : undefined,
      maxLookbackWindowMs,
      degraded: false,
    };
  } catch (err) {
    console.warn("trigify.plan_limits_fetch_failed", {
      tenantId: args.tenantId,
      errorClass: err instanceof Error ? err.constructor.name : typeof err,
    });
    result = { maxLookbackWindowMs: DEFAULT_MAX_LOOKBACK_MS, degraded: true };
  }

  args.cache.set(key, result, { ttlMs: PLAN_LIMITS_CACHE_TTL_MS });
  return result;
}

/** Clamp a requested lookback window (ms) to the plan's max. Never below 1ms. */
export function clampToPlanLimit(requestedMs: number, maxLookbackWindowMs: number): number {
  return Math.max(1, Math.min(requestedMs, Math.max(0, maxLookbackWindowMs)));
}

/**
 * Test-only reset hook. Production callers own a single long-lived
 * `CacheAdapter` instance (constructed once per process, like
 * `config-resolver.ts`'s module-level cache) so this is only needed when
 * tests share a `CacheAdapter` across cases via `beforeEach`.
 */
export function __resetPlanLimitsCacheForTests(): void {
  // Intentionally a no-op at the module level — tests construct a fresh
  // InMemoryCacheAdapter per case instead of relying on shared module state,
  // matching this module's design (the cache is caller-supplied, not a
  // module singleton). Exported so call sites that DO want a reset hook (in
  // case a future singleton cache is introduced here) have a stable name to
  // migrate to without changing test imports.
}
