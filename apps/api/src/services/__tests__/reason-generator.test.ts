import { createEvidence, type Evidence, type ThresholdConfig } from "@hap/config";
import { describe, expect, it } from "vitest";
import { createMockLlmAdapter } from "../../adapters/mock-llm-adapter";
import { extractDominantSignal, generateReasonText } from "../reason-generator";

const TENANT = "t-reason-1";
const DAY_MS = 24 * 60 * 60 * 1000;

function ev(overrides: Partial<Evidence>): Evidence {
  return createEvidence(TENANT, overrides);
}

const THRESHOLDS: ThresholdConfig = {
  freshnessMaxDays: 30,
  minConfidence: 0.5,
};

describe("extractDominantSignal", () => {
  it("returns null for empty input", () => {
    expect(extractDominantSignal([], THRESHOLDS)).toBeNull();
  });

  it("returns null when all signals fail freshness", () => {
    const old = new Date(Date.now() - 90 * DAY_MS);
    const signals = [ev({ id: "a", confidence: 0.9, timestamp: old })];
    expect(extractDominantSignal(signals, THRESHOLDS)).toBeNull();
  });

  it("returns null when all signals fail confidence", () => {
    const signals = [ev({ id: "a", confidence: 0.2 })];
    expect(extractDominantSignal(signals, THRESHOLDS)).toBeNull();
  });

  it("picks highest confidence when dates equal", () => {
    const t = new Date();
    const signals = [
      ev({ id: "low", confidence: 0.6, timestamp: t }),
      ev({ id: "high", confidence: 0.95, timestamp: t }),
    ];
    expect(extractDominantSignal(signals, THRESHOLDS)?.id).toBe("high");
  });

  it("breaks confidence ties by recency (newer wins)", () => {
    const newer = new Date();
    const older = new Date(Date.now() - 5 * DAY_MS);
    const signals = [
      ev({ id: "older", confidence: 0.8, timestamp: older }),
      ev({ id: "newer", confidence: 0.8, timestamp: newer }),
    ];
    expect(extractDominantSignal(signals, THRESHOLDS)?.id).toBe("newer");
  });

  it("ignores signals below confidence floor while picking qualifying ones", () => {
    const signals = [ev({ id: "weak", confidence: 0.1 }), ev({ id: "strong", confidence: 0.8 })];
    expect(extractDominantSignal(signals, THRESHOLDS)?.id).toBe("strong");
  });

  it("respects custom now() for freshness window", () => {
    const fakeNow = new Date("2026-01-01T00:00:00Z");
    const fresh = new Date("2025-12-15T00:00:00Z"); // 17 days before fakeNow
    const stale = new Date("2025-10-01T00:00:00Z"); // >90 days before fakeNow
    const signals = [
      ev({ id: "fresh", confidence: 0.7, timestamp: fresh }),
      ev({ id: "stale", confidence: 0.95, timestamp: stale }),
    ];
    expect(extractDominantSignal(signals, THRESHOLDS, fakeNow)?.id).toBe("fresh");
  });

  describe("copyAssertable guard (Stage A Task 7 — derived-never-asserted invariant)", () => {
    it("never selects evidence with copyAssertable === false, even at higher confidence", () => {
      const signals = [
        ev({
          id: "derived-high-conf",
          confidence: 0.99,
          copyAssertable: false,
        }),
        ev({
          id: "observable-lower-conf",
          confidence: 0.6,
          copyAssertable: true,
        }),
      ];
      expect(extractDominantSignal(signals, THRESHOLDS)?.id).toBe("observable-lower-conf");
    });

    it("returns null when every qualifying signal is copyAssertable === false", () => {
      const signals = [
        ev({ id: "derived-1", confidence: 0.95, copyAssertable: false }),
        ev({ id: "derived-2", confidence: 0.9, copyAssertable: false }),
      ];
      expect(extractDominantSignal(signals, THRESHOLDS)).toBeNull();
    });

    it("treats legacy evidence with copyAssertable left unset (undefined) as assertable", () => {
      // Existing Exa/News evidence never sets copyAssertable — the guard must
      // only exclude an EXPLICIT false, not "unset", so legacy adapters keep
      // working unmodified.
      const signals = [ev({ id: "legacy", confidence: 0.8, copyAssertable: undefined })];
      expect(extractDominantSignal(signals, THRESHOLDS)?.id).toBe("legacy");
    });

    it("still applies freshness/confidence thresholds alongside the copyAssertable guard", () => {
      const old = new Date(Date.now() - 90 * DAY_MS);
      const signals = [
        ev({
          id: "assertable-but-stale",
          confidence: 0.9,
          copyAssertable: true,
          timestamp: old,
        }),
        ev({ id: "derived-fresh", confidence: 0.9, copyAssertable: false }),
      ];
      // Both are disqualified — one by staleness, one by copyAssertable — so
      // the result must be null, never a fallback to the derived signal.
      expect(extractDominantSignal(signals, THRESHOLDS)).toBeNull();
    });

    it("picks the best remaining observable when a derived signal is present among several observables", () => {
      const signals = [
        ev({ id: "weak-observable", confidence: 0.55, copyAssertable: true }),
        ev({
          id: "derived-boost-only",
          confidence: 0.97,
          copyAssertable: false,
        }),
        ev({ id: "strong-observable", confidence: 0.85, copyAssertable: true }),
      ];
      expect(extractDominantSignal(signals, THRESHOLDS)?.id).toBe("strong-observable");
    });
  });
});

describe("generateReasonText", () => {
  it("returns template-based text referencing source and content without LLM", async () => {
    const signal = ev({
      id: "x",
      source: "news",
      content: "Funding round announced this week.",
    });
    const text = await generateReasonText(signal);
    expect(text).toContain("news");
    expect(text).toContain("Funding round announced this week.");
  });

  it("uses llmAdapter output when provided (NOT the template format)", async () => {
    const signal = ev({
      id: "x",
      source: "hubspot",
      content: "Email engagement.",
    });
    const llm = createMockLlmAdapter({ style: "short" });
    const text = await generateReasonText(signal, llm);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    // Proves the LLM path was taken, not just the fallback template:
    // template format is "<source> reported: <content>".
    expect(text).not.toContain("hubspot reported:");
  });

  it("falls back to template if llmAdapter throws", async () => {
    const signal = ev({
      id: "x",
      source: "hubspot",
      content: "Email engagement.",
    });
    const llm = createMockLlmAdapter({ style: "error" });
    const text = await generateReasonText(signal, llm);
    expect(text).toContain("Email engagement.");
  });
});
