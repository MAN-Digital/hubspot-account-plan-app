/**
 * Tests for the Trigify signal-ranking port (Stage A Task 4).
 *
 * Source of truth: `signal_ranking.py` + `config/trigify_signal_ranking.yaml`
 * (OrbStack VM, `.../outreach-engine/`). This suite ports the Python
 * `score()` test surface plus the HARD RULE (codex F16): a derived signal
 * alone can never cross the send threshold — it only boosts strength when
 * >=1 in-window observable signal exists for the same target.
 */

import { describe, expect, it } from "vitest";
import {
  confidenceFromContribution,
  DEFAULT_TRIGIFY_RANKING_CONFIG,
  type RankableSignal,
  scoreSignals,
} from "../signal-ranking";

const NOW = new Date("2026-07-06T00:00:00.000Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86400 * 1000).toISOString();
}

function observable(overrides: Partial<RankableSignal> = {}): RankableSignal {
  return {
    targetId: "target-1",
    signalType: "T_Role_Change",
    signalClass: "observable",
    tier: "A",
    level: "person",
    observedAt: daysAgo(1),
    headline: "Jane Doe became VP of RevOps",
    ...overrides,
  };
}

function derived(overrides: Partial<RankableSignal> = {}): RankableSignal {
  return {
    targetId: "target-1",
    signalType: "T_Buying_Window",
    signalClass: "derived",
    tier: "A",
    level: "person",
    observedAt: daysAgo(1),
    headline: "Elevated buying-window signal",
    ...overrides,
  };
}

describe("signal-ranking", () => {
  describe("HARD RULE: derived-alone never crosses threshold", () => {
    it("scores 0 and stays monitor_only for a derived-only target", () => {
      const result = scoreSignals([derived()]);
      expect(result.strength).toBe(0);
      expect(result.hasObservable).toBe(false);
      expect(result.decision).toBe("monitor_only");
      expect(result.crossesThreshold).toBe(false);
    });

    it("scores 0 for multiple derived-only signals", () => {
      const result = scoreSignals([
        derived({ signalType: "T_Buying_Window" }),
        derived({ signalType: "T_Influence", tier: "C" }),
        derived({ signalType: "T_Expansion", tier: "C" }),
      ]);
      expect(result.strength).toBe(0);
      expect(result.decision).toBe("monitor_only");
    });

    it("scores 0 for no signals at all", () => {
      const result = scoreSignals([]);
      expect(result.strength).toBe(0);
      expect(result.decision).toBe("monitor_only");
      expect(result.hasObservable).toBe(false);
    });

    it("an out-of-window observable does not count as in-window", () => {
      // 40 days old > 30-day window default.
      const result = scoreSignals([observable({ observedAt: daysAgo(40) })]);
      expect(result.hasObservable).toBe(false);
      expect(result.strength).toBe(0);
      expect(result.decision).toBe("monitor_only");
    });
  });

  describe("observable scoring", () => {
    it("a fresh tier-A person-level observable crosses the default threshold", () => {
      const result = scoreSignals([observable()]);
      expect(result.hasObservable).toBe(true);
      expect(result.strength).toBeGreaterThan(0);
      // tier A (1.00) * person (1.00) * recency(~1 day, near 1.0) * topic(1.0, non-topic type)
      expect(result.strength).toBeGreaterThan(0.9);
      expect(result.crossesThreshold).toBe(true);
    });

    it("a tier-C weak observable does not cross the threshold alone", () => {
      const result = scoreSignals([
        observable({ signalType: "T_Competitor_Engagement", tier: "C" }),
      ]);
      // tier C weight 0.30 * person 1.00 * near-1.0 recency ~= 0.30, well under 0.60
      expect(result.strength).toBeLessThan(0.6);
      expect(result.crossesThreshold).toBe(false);
      expect(result.decision).toBe("monitor_only");
    });

    it("company-level signals score lower than person-level via the multiplier", () => {
      const personResult = scoreSignals([observable({ level: "person" })]);
      const companyResult = scoreSignals([observable({ level: "company" })]);
      expect(companyResult.strength).toBeLessThan(personResult.strength);
    });

    it("recency decays contribution for older in-window signals", () => {
      const fresh = scoreSignals([observable({ observedAt: daysAgo(1) })]);
      const older = scoreSignals([observable({ observedAt: daysAgo(20) })]);
      expect(older.strength).toBeLessThan(fresh.strength);
    });

    it("adds a volume bonus for extra in-window observable signals, capped", () => {
      const single = scoreSignals([observable()]);
      const multi = scoreSignals([
        observable({ signalType: "T_Role_Change" }),
        observable({ signalType: "T_Topic_Post" }),
        observable({ signalType: "T_Company_Initiative" }),
      ]);
      expect(multi.strength).toBeGreaterThan(single.strength);
    });
  });

  describe("derived boost (gated on >=1 in-window observable)", () => {
    it("adds a derived boost only when an in-window observable exists", () => {
      const withoutDerived = scoreSignals([observable()]);
      const withDerived = scoreSignals([observable(), derived()]);
      expect(withDerived.strength).toBeGreaterThan(withoutDerived.strength);
      // Boost is capped at derived_boost_cap (0.25 default).
      expect(withDerived.strength - withoutDerived.strength).toBeLessThanOrEqual(0.26);
    });

    it("caps the derived boost even with many derived signals", () => {
      const withOneDerived = scoreSignals([
        observable(),
        derived({ signalType: "T_Buying_Window" }),
      ]);
      const withManyDerived = scoreSignals([
        observable(),
        derived({ signalType: "T_Buying_Window" }),
        derived({ signalType: "T_Influence" }),
        derived({ signalType: "T_Expansion" }),
        derived({ signalType: "T_Company_Jobs_Up" }),
      ]);
      // Both should be capped at the same derived_boost_cap ceiling above the base.
      expect(withManyDerived.strength).toBeLessThanOrEqual(withOneDerived.strength + 0.26);
    });

    it("never lets a derived signal become the best_signal", () => {
      const result = scoreSignals([observable({ tier: "C" }), derived({ tier: "A" })]);
      expect(result.bestSignal?.signalClass).toBe("observable");
    });
  });

  describe("topic relevance", () => {
    it("boosts topic-bearing signals matching the positioning map", () => {
      const matched = scoreSignals([
        observable({
          signalType: "T_Topic_Post",
          headline: "Posted about RevOps transformation",
          detail: "Discussing HubSpot and revenue operations strategy",
        }),
      ]);
      const unmatched = scoreSignals([
        observable({
          signalType: "T_Topic_Post",
          headline: "Posted about weekend hiking",
          detail: "Nothing related to our positioning",
        }),
      ]);
      expect(matched.strength).toBeGreaterThan(unmatched.strength);
    });

    it("leaves non-topic signal types unaffected by topic content", () => {
      const a = scoreSignals([observable({ signalType: "T_Role_Change", headline: "revops" })]);
      const b = scoreSignals([observable({ signalType: "T_Role_Change", headline: "unrelated" })]);
      expect(a.strength).toBe(b.strength);
    });
  });

  describe("config overrides", () => {
    it("honors a custom send_threshold from config", () => {
      const weak = observable({
        signalType: "T_Competitor_Engagement",
        tier: "C",
      });
      const lenient = scoreSignals([weak], {
        config: { ...DEFAULT_TRIGIFY_RANKING_CONFIG, sendThreshold: 0.1 },
      });
      expect(lenient.crossesThreshold).toBe(true);
      expect(lenient.decision).toBe("strong");
    });
  });

  describe("confidenceFromContribution mapping", () => {
    it("maps a 0..~1.x strength to a 0..1 confidence for Evidence", () => {
      expect(confidenceFromContribution(0)).toBe(0);
      expect(confidenceFromContribution(1)).toBe(1);
      expect(confidenceFromContribution(1.2)).toBeLessThanOrEqual(1);
      expect(confidenceFromContribution(0.5)).toBeCloseTo(0.5, 5);
    });
  });

  describe("reasons", () => {
    it("includes a human-readable reason for a derived-only target", () => {
      const result = scoreSignals([derived()]);
      expect(result.reasons.some((r) => /derived/i.test(r))).toBe(true);
    });

    it("includes a human-readable reason when strength crosses the threshold", () => {
      const result = scoreSignals([observable()]);
      expect(result.reasons.some((r) => /STRONG/.test(r))).toBe(true);
    });
  });
});
