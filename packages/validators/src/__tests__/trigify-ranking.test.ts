/**
 * Tests for the Trigify ranking-config Zod schema (Stage A Task 4).
 *
 * This schema validates the trigify `provider_config.settings` JSONB — NOT
 * the `thresholds` column, whose shape is locked to
 * `{freshnessMaxDays, minConfidence}` by `isValidThresholds` in
 * `apps/api/src/routes/snapshot.ts`. See
 * `.claude/tasks/trigify-signals-into-account-planning.md` "Config
 * placement" note.
 */

import { describe, expect, it } from "vitest";
import { trigifyRankingConfigDefaults, trigifyRankingConfigSchema } from "../trigify-ranking";

describe("trigifyRankingConfigSchema", () => {
  it("accepts an empty object and applies documented defaults", () => {
    const result = trigifyRankingConfigSchema.safeParse({});
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sendThreshold).toBe(0.6);
      expect(result.data.tierWeights).toEqual({ A: 1.0, B: 0.65, C: 0.3 });
      expect(result.data.multipliers).toEqual({ person: 1.0, company: 0.7 });
      expect(result.data.derivedBoostCap).toBe(0.25);
    }
  });

  it("accepts a partial override and merges with defaults", () => {
    const result = trigifyRankingConfigSchema.safeParse({
      sendThreshold: 0.75,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.sendThreshold).toBe(0.75);
      // Untouched fields keep their defaults.
      expect(result.data.tierWeights.A).toBe(1.0);
    }
  });

  it("rejects a sendThreshold outside 0..1", () => {
    expect(trigifyRankingConfigSchema.safeParse({ sendThreshold: 1.5 }).success).toBe(false);
    expect(trigifyRankingConfigSchema.safeParse({ sendThreshold: -0.1 }).success).toBe(false);
  });

  it("rejects negative tier weights", () => {
    expect(
      trigifyRankingConfigSchema.safeParse({
        tierWeights: { A: -1, B: 0.65, C: 0.3 },
      }).success,
    ).toBe(false);
  });

  it("rejects an unknown top-level key (strict)", () => {
    expect(trigifyRankingConfigSchema.safeParse({ notAField: true }).success).toBe(false);
  });

  it("rejects a recency config with a non-positive half-life", () => {
    expect(
      trigifyRankingConfigSchema.safeParse({
        recency: { halfLifeDays: 0, windowDays: 30, floor: 0.15 },
      }).success,
    ).toBe(false);
  });

  it("exposes the defaults object matching the YAML port", () => {
    expect(trigifyRankingConfigDefaults.rankingVersion).toBe("trigify-rank-v1");
    expect(trigifyRankingConfigDefaults.derivedTypes).toEqual([
      "T_Buying_Window",
      "T_Influence",
      "T_Expansion",
      "T_Company_Jobs_Up",
    ]);
  });

  it("round-trips a fully custom config", () => {
    const custom = {
      rankingVersion: "custom-v2",
      sendThreshold: 0.7,
      tierWeights: { A: 1.0, B: 0.5, C: 0.2 },
      signalTiers: { T_Role_Change: "A" as const },
      derivedTypes: ["T_Buying_Window"],
      topicSignalTypes: ["T_Topic_Post"],
      multipliers: { person: 1.0, company: 0.5 },
      recency: { halfLifeDays: 7, windowDays: 14, floor: 0.1 },
      topicRelevance: { default: 0.5, map: { revops: 1.0 } },
      volumeBonusPerExtra: 0.1,
      volumeBonusCap: 0.3,
      derivedBoost: 0.2,
      derivedBoostCap: 0.3,
    };
    const result = trigifyRankingConfigSchema.safeParse(custom);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual(custom);
    }
  });
});
