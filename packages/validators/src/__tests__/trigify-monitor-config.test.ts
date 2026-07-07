/**
 * Tests for the Trigify monitor-management config Zod schema (Stage A Task 9).
 *
 * This schema validates the SAME trigify `provider_config.settings` JSONB
 * that `trigifyRankingConfigSchema` (Task 4) also reads from — but this
 * schema owns only the monitor-management sub-keys (credit budget ceiling,
 * default cadence, plan-aware lookback override). It uses `.passthrough()`
 * (not `.strict()`) so it tolerates sibling keys owned by the ranking schema
 * living in the same settings object, and vice versa. Neither schema merges
 * into the other; each parses the same raw object independently.
 */

import { describe, expect, it } from "vitest";
import {
  trigifyMonitorConfigDefaults,
  trigifyMonitorConfigSchema,
} from "../trigify-monitor-config";

describe("trigifyMonitorConfigSchema", () => {
  it("accepts an empty object and applies documented defaults", () => {
    const result = trigifyMonitorConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.creditBudget).toEqual({});
      expect(result.data.defaultCadence).toBe("daily");
    }
  });

  it("accepts a partial creditBudget override", () => {
    const result = trigifyMonitorConfigSchema.safeParse({
      creditBudget: { daily: 10, monthly: 200 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.creditBudget).toEqual({ daily: 10, monthly: 200 });
    }
  });

  it("rejects a negative budget value", () => {
    expect(trigifyMonitorConfigSchema.safeParse({ creditBudget: { daily: -1 } }).success).toBe(
      false,
    );
  });

  it("rejects an invalid cadence", () => {
    expect(trigifyMonitorConfigSchema.safeParse({ defaultCadence: "hourly" }).success).toBe(false);
  });

  it("tolerates unrelated sibling keys from the ranking schema (passthrough, not strict)", () => {
    // Simulates the SAME settings blob also carrying ranking-schema keys —
    // this schema must not reject the object just because it has extra keys
    // it doesn't recognize.
    const result = trigifyMonitorConfigSchema.safeParse({
      defaultCadence: "weekly",
      sendThreshold: 0.6,
      tierWeights: { A: 1, B: 0.65, C: 0.3 },
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.defaultCadence).toBe("weekly");
    }
  });

  it("trigifyMonitorConfigDefaults is the fully-defaulted zero-config shape", () => {
    expect(trigifyMonitorConfigDefaults.defaultCadence).toBe("daily");
    expect(trigifyMonitorConfigDefaults.creditBudget).toEqual({});
  });
});
