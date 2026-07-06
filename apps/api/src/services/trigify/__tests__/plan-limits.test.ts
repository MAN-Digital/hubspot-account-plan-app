/**
 * Tests for plan-aware Trigify lookback clamping (Stage A Task 9).
 *
 * `GET /v1/social-signals/limits` (FREE read) reports the tenant's Trigify
 * plan tier and its `max_lookback_window_ms`. Subscription/feed windows must
 * be clamped to this value — never hardcoded to 30 days regardless of plan
 * (e.g. a 14-day-max plan must not silently request a 30-day window). The
 * result is cached per-tenant (limits rarely change; this is a FREE call but
 * still a network round-trip we don't want on every request).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrigifyClient } from "../../../adapters/signal/trigify-client";
import { InMemoryCacheAdapter } from "../../../lib/cache-adapter";
import {
  __resetPlanLimitsCacheForTests,
  clampToPlanLimit,
  resolvePlanLimits,
} from "../plan-limits";

const TENANT = "tenant-1";

function makeClient(getLimits: TrigifyClient["getLimits"]): TrigifyClient {
  return { getLimits } as unknown as TrigifyClient;
}

describe("resolvePlanLimits", () => {
  beforeEach(() => {
    __resetPlanLimitsCacheForTests();
  });

  it("reads GET /v1/social-signals/limits and returns the plan + max lookback", async () => {
    const getLimits = vi.fn().mockResolvedValue({
      plan: "growth",
      max_lookback_window_ms: 1_209_600_000, // 14 days
      max_subscriptions: 50,
    });
    const client = makeClient(getLimits);
    const cache = new InMemoryCacheAdapter();

    const limits = await resolvePlanLimits({ client, tenantId: TENANT, cache });
    expect(limits.plan).toBe("growth");
    expect(limits.maxLookbackWindowMs).toBe(1_209_600_000);
    expect(getLimits).toHaveBeenCalledTimes(1);
  });

  it("caches the result per tenant — a second call within TTL does not re-call the client", async () => {
    const getLimits = vi.fn().mockResolvedValue({
      plan: "starter",
      max_lookback_window_ms: 1_209_600_000,
    });
    const client = makeClient(getLimits);
    const cache = new InMemoryCacheAdapter();

    await resolvePlanLimits({ client, tenantId: TENANT, cache });
    await resolvePlanLimits({ client, tenantId: TENANT, cache });
    expect(getLimits).toHaveBeenCalledTimes(1);
  });

  it("falls back to a conservative default (30d) when the API omits max_lookback_window_ms", async () => {
    const client = makeClient(vi.fn().mockResolvedValue({ plan: "unknown" }));
    const cache = new InMemoryCacheAdapter();
    const limits = await resolvePlanLimits({ client, tenantId: TENANT, cache });
    expect(limits.maxLookbackWindowMs).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("never throws when the client call fails — falls back to the conservative default", async () => {
    const client = makeClient(vi.fn().mockRejectedValue(new Error("network down")));
    const cache = new InMemoryCacheAdapter();
    const limits = await resolvePlanLimits({ client, tenantId: TENANT, cache });
    expect(limits.maxLookbackWindowMs).toBe(30 * 24 * 60 * 60 * 1000);
    expect(limits.degraded).toBe(true);
  });
});

describe("clampToPlanLimit", () => {
  it("clamps a requested window down to the plan max", () => {
    expect(clampToPlanLimit(30 * 24 * 60 * 60 * 1000, 14 * 24 * 60 * 60 * 1000)).toBe(
      14 * 24 * 60 * 60 * 1000,
    );
  });

  it("leaves a window unchanged when it's already within the plan max", () => {
    expect(clampToPlanLimit(7 * 24 * 60 * 60 * 1000, 14 * 24 * 60 * 60 * 1000)).toBe(
      7 * 24 * 60 * 60 * 1000,
    );
  });

  it("never returns less than 1ms even for a degenerate plan max", () => {
    expect(clampToPlanLimit(1000, 0)).toBe(1);
  });
});
