import { describe, expect, it } from "vitest";
import {
  DERIVED_SIGNAL_TRIGGER_CODES,
  isDerivedTriggerCode,
  TRIGIFY_SIGNAL_TYPES,
  type TrigifySignalLevel,
  type TrigifySignalTier,
  type TrigifyTriggerCode,
} from "../trigify-signal-types.js";

/**
 * Stage A Task 2 — verifies the ported Trigify signal taxonomy constant
 * against the canonical source table:
 * .../runtime-workspace/live/skills/trigify/references/signal-types.md
 *
 * The hard invariant under test: every DERIVED trigger code is
 * non-copy-assertable and is present in DERIVED_SIGNAL_TRIGGER_CODES —
 * this is the taxonomy-level half of the "derived signals never asserted"
 * fidelity requirement (the other half is enforced at the
 * extractDominantSignal guard, Task 7).
 */

describe("TRIGIFY_SIGNAL_TYPES taxonomy", () => {
  it("defines exactly the 16 canonical signal rows keyed by trigger_code", () => {
    const expectedTriggerCodes: TrigifyTriggerCode[] = [
      "T_Role_Change",
      "T_New_Role_Joined",
      "T_Hiring_Surge",
      "T_Topic_Post",
      "T_Comment_On_Tracked",
      "T_Competitor_Engagement",
      "T_Topic_Engage",
      "T_Company_Hiring",
      "T_Company_Jobs_Up",
      "T_Company_Initiative",
      "T_Buying_Window",
      "T_Influence",
      "T_Expansion",
    ];

    for (const code of expectedTriggerCodes) {
      expect(TRIGIFY_SIGNAL_TYPES[code], `expected taxonomy entry for ${code}`).toBeDefined();
    }
  });

  it("classifies T_Role_Change as observable, person-level, tier A", () => {
    const entry = TRIGIFY_SIGNAL_TYPES.T_Role_Change;
    expect(entry.signalClass).toBe("observable");
    expect(entry.level).toBe<TrigifySignalLevel>("person");
    expect(entry.tier).toBe<TrigifySignalTier>("A");
    expect(entry.copyAssertable).toBe(true);
  });

  it("classifies T_Topic_Post as observable, person-level, tier A", () => {
    const entry = TRIGIFY_SIGNAL_TYPES.T_Topic_Post;
    expect(entry.signalClass).toBe("observable");
    expect(entry.level).toBe("person");
    expect(entry.tier).toBe("A");
    expect(entry.copyAssertable).toBe(true);
  });

  it("classifies T_Competitor_Engagement and T_Topic_Engage as weak observable tier C", () => {
    expect(TRIGIFY_SIGNAL_TYPES.T_Competitor_Engagement.signalClass).toBe("observable");
    expect(TRIGIFY_SIGNAL_TYPES.T_Competitor_Engagement.tier).toBe("C");
    expect(TRIGIFY_SIGNAL_TYPES.T_Topic_Engage.signalClass).toBe("observable");
    expect(TRIGIFY_SIGNAL_TYPES.T_Topic_Engage.tier).toBe("C");
  });

  it("classifies T_Company_Hiring and T_Company_Initiative as company-level observable", () => {
    expect(TRIGIFY_SIGNAL_TYPES.T_Company_Hiring.level).toBe("company");
    expect(TRIGIFY_SIGNAL_TYPES.T_Company_Hiring.signalClass).toBe("observable");
    expect(TRIGIFY_SIGNAL_TYPES.T_Company_Hiring.tier).toBe("B");

    expect(TRIGIFY_SIGNAL_TYPES.T_Company_Initiative.level).toBe("company");
    expect(TRIGIFY_SIGNAL_TYPES.T_Company_Initiative.signalClass).toBe("observable");
    expect(TRIGIFY_SIGNAL_TYPES.T_Company_Initiative.tier).toBe("A");
  });

  it("classifies T_Buying_Window, T_Influence, T_Expansion as derived and NEVER copy-assertable", () => {
    for (const code of ["T_Buying_Window", "T_Influence", "T_Expansion"] as const) {
      const entry = TRIGIFY_SIGNAL_TYPES[code];
      expect(entry.signalClass, `${code} should be derived`).toBe("derived");
      expect(entry.copyAssertable, `${code} should never be copy-assertable`).toBe(false);
    }
  });

  it("classifies T_Company_Jobs_Up as a derived-metric row, non-copy-assertable, tier C, boost-only", () => {
    const entry = TRIGIFY_SIGNAL_TYPES.T_Company_Jobs_Up;
    expect(entry.level).toBe("company");
    expect(entry.signalClass).toBe("derived");
    expect(entry.tier).toBe("C");
    expect(entry.copyAssertable).toBe(false);
  });

  it("every taxonomy entry has a non-empty description", () => {
    for (const [code, entry] of Object.entries(TRIGIFY_SIGNAL_TYPES)) {
      expect(entry.description, `${code} description`).toBeTruthy();
    }
  });
});

describe("DERIVED_SIGNAL_TRIGGER_CODES", () => {
  it("contains exactly the four derived/non-assertable trigger codes", () => {
    expect([...DERIVED_SIGNAL_TRIGGER_CODES].sort()).toEqual(
      ["T_Buying_Window", "T_Company_Jobs_Up", "T_Expansion", "T_Influence"].sort(),
    );
  });

  it("agrees with each entry's copyAssertable flag in TRIGIFY_SIGNAL_TYPES", () => {
    for (const [code, entry] of Object.entries(TRIGIFY_SIGNAL_TYPES)) {
      const isInDerivedSet = (DERIVED_SIGNAL_TRIGGER_CODES as readonly string[]).includes(code);
      expect(isInDerivedSet, `${code} derived-set membership vs copyAssertable`).toBe(
        !entry.copyAssertable,
      );
    }
  });
});

describe("isDerivedTriggerCode", () => {
  it("returns true for all four derived codes", () => {
    expect(isDerivedTriggerCode("T_Buying_Window")).toBe(true);
    expect(isDerivedTriggerCode("T_Influence")).toBe(true);
    expect(isDerivedTriggerCode("T_Expansion")).toBe(true);
    expect(isDerivedTriggerCode("T_Company_Jobs_Up")).toBe(true);
  });

  it("returns false for observable codes", () => {
    expect(isDerivedTriggerCode("T_Role_Change")).toBe(false);
    expect(isDerivedTriggerCode("T_Topic_Post")).toBe(false);
    expect(isDerivedTriggerCode("T_Company_Hiring")).toBe(false);
  });
});
