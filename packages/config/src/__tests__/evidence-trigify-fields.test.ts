import { describe, expect, it } from "vitest";
import type { Evidence } from "../domain-types.js";
import { createEvidence } from "../factories.js";

/**
 * Stage A Task 2 — verifies the Evidence domain type gained OPTIONAL
 * Trigify signal-metadata fields without breaking any existing
 * (Exa/News-shaped) Evidence value.
 *
 * Additive-only: `signalType`, `signalClass`, `tier`, `copyAssertable`,
 * `evidenceUrl`, `evidenceDate` are all optional so every pre-existing
 * caller that constructs an Evidence literal with only the original 6
 * fields keeps compiling and behaving identically.
 */

describe("Evidence: Trigify optional fields (additive)", () => {
  it("compiles and round-trips a legacy Exa-shaped Evidence with no new fields", () => {
    const evidence: Evidence = {
      id: "ev-1",
      tenantId: "tenant-1",
      source: "exa",
      timestamp: new Date("2026-01-01T00:00:00Z"),
      confidence: 0.7,
      content: "Acme Corp raised a Series B",
      isRestricted: false,
    };

    expect(evidence.signalType).toBeUndefined();
    expect(evidence.signalClass).toBeUndefined();
    expect(evidence.tier).toBeUndefined();
    expect(evidence.copyAssertable).toBeUndefined();
    expect(evidence.evidenceUrl).toBeUndefined();
    expect(evidence.evidenceDate).toBeUndefined();
  });

  it("accepts a fully-populated observable Trigify Evidence value", () => {
    const evidence: Evidence = {
      id: "ev-2",
      tenantId: "tenant-1",
      source: "trigify",
      timestamp: new Date("2026-02-01T00:00:00Z"),
      confidence: 0.9,
      content: "Jane Doe changed role to VP Sales",
      isRestricted: false,
      signalType: "T_Role_Change",
      signalClass: "observable",
      tier: "A",
      copyAssertable: true,
      evidenceUrl: "https://www.linkedin.com/in/janedoe",
      evidenceDate: new Date("2026-01-30T00:00:00Z"),
    };

    expect(evidence.signalClass).toBe("observable");
    expect(evidence.tier).toBe("A");
    expect(evidence.copyAssertable).toBe(true);
    expect(evidence.evidenceUrl).toBe("https://www.linkedin.com/in/janedoe");
    expect(evidence.evidenceDate).toEqual(new Date("2026-01-30T00:00:00Z"));
  });

  it("accepts a derived Trigify Evidence value with copyAssertable=false and no evidenceUrl", () => {
    const evidence: Evidence = {
      id: "ev-3",
      tenantId: "tenant-1",
      source: "trigify",
      timestamp: new Date("2026-02-01T00:00:00Z"),
      confidence: 0.2,
      content: "Buying window inferred",
      isRestricted: false,
      signalType: "T_Buying_Window",
      signalClass: "derived",
      tier: "A",
      copyAssertable: false,
    };

    expect(evidence.signalClass).toBe("derived");
    expect(evidence.copyAssertable).toBe(false);
    expect(evidence.evidenceUrl).toBeUndefined();
  });

  it("createEvidence factory still produces valid Evidence with no Trigify fields by default", () => {
    const evidence = createEvidence("tenant-1", { confidence: 0.8 });

    expect(evidence.signalType).toBeUndefined();
    expect(evidence.signalClass).toBeUndefined();
    expect(evidence.copyAssertable).toBeUndefined();
  });

  it("createEvidence factory accepts Trigify field overrides via Partial<Evidence>", () => {
    const evidence = createEvidence("tenant-1", {
      source: "trigify",
      signalType: "T_Topic_Post",
      signalClass: "observable",
      tier: "A",
      copyAssertable: true,
      evidenceUrl: "https://www.linkedin.com/posts/example",
      evidenceDate: new Date("2026-03-01T00:00:00Z"),
    });

    expect(evidence.source).toBe("trigify");
    expect(evidence.signalType).toBe("T_Topic_Post");
    expect(evidence.signalClass).toBe("observable");
    expect(evidence.copyAssertable).toBe(true);
  });

  it("accepts an optional hsContactId for person-level signals (undefined by default)", () => {
    const legacy: Evidence = {
      id: "ev-4",
      tenantId: "tenant-1",
      source: "exa",
      timestamp: new Date("2026-01-01T00:00:00Z"),
      confidence: 0.7,
      content: "Acme Corp raised a Series B",
      isRestricted: false,
    };
    expect(legacy.hsContactId).toBeUndefined();

    const personLevel: Evidence = {
      ...legacy,
      id: "ev-5",
      source: "trigify",
      signalType: "T_Role_Change",
      signalClass: "observable",
      copyAssertable: true,
      hsContactId: "contact-42",
    };
    expect(personLevel.hsContactId).toBe("contact-42");
  });

  it("createEvidence factory accepts an hsContactId override", () => {
    const evidence = createEvidence("tenant-1", {
      source: "trigify",
      hsContactId: "contact-99",
    });
    expect(evidence.hsContactId).toBe("contact-99");
  });
});
