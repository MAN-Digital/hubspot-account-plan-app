/**
 * Tests for TrigifyStoreAdapter (Stage A Task 7).
 *
 * Reads persisted `signals` rows for a company, runs the ranking service
 * (Task 4), and projects to `Evidence[]`: observable signals get a
 * strength-mapped confidence + evidenceUrl/evidenceDate populated; derived
 * signals get `copyAssertable: false` + a fixed low confidence so they can
 * never win the dominant-signal contest (belt-and-braces with the
 * `extractDominantSignal` guard in reason-generator.ts) but can still
 * inform ranking/trust.
 */

import { describe, expect, it, vi } from "vitest";
import type { PersistedSignalRow } from "../trigify";
import { TRIGIFY_PROVIDER_NAME, TrigifyStoreAdapter } from "../trigify";

const TENANT_ID = "tenant-1";
const COMPANY_ID = "co-99";

function signalRow(overrides: Partial<PersistedSignalRow> = {}): PersistedSignalRow {
  return {
    id: "sig-db-1",
    dedupeKey: "ext:sig_1",
    signalType: "T_Role_Change",
    signalClass: "observable",
    tier: "A",
    level: "person",
    targetId: "linkedin.com/in/jane-doe",
    linkedinUrl: "https://www.linkedin.com/in/jane-doe/",
    hsContactId: null,
    hsCompanyId: COMPANY_ID,
    evidenceUrl: "https://www.linkedin.com/posts/jane-doe_promo-1",
    evidenceDate: "2026-07-01",
    observedAt: "2026-07-01T09:00:00.000Z",
    allowedClaims: [],
    copyAssertable: true,
    headline: "Jane Doe became VP of RevOps",
    detail: "Promoted from Director",
    confidence: 0.85,
    raw: {},
    ...overrides,
  };
}

function makeAdapter(rows: PersistedSignalRow[]) {
  const fetchSignalsForCompany = vi.fn(async () => rows);
  const adapter = new TrigifyStoreAdapter({ fetchSignalsForCompany });
  return { adapter, fetchSignalsForCompany };
}

describe("TrigifyStoreAdapter", () => {
  it("exposes the stable provider identifier", () => {
    const { adapter } = makeAdapter([]);
    expect(adapter.name).toBe(TRIGIFY_PROVIDER_NAME);
    expect(TRIGIFY_PROVIDER_NAME).toBe("trigify");
  });

  it("returns [] when there are no persisted signals for the company", async () => {
    const { adapter } = makeAdapter([]);
    const evidence = await adapter.fetchSignals(TENANT_ID, {
      companyId: COMPANY_ID,
    });
    expect(evidence).toEqual([]);
  });

  it("projects an observable signal to Evidence with evidenceUrl/evidenceDate + strength-mapped confidence", async () => {
    const { adapter } = makeAdapter([signalRow()]);
    const evidence = await adapter.fetchSignals(TENANT_ID, {
      companyId: COMPANY_ID,
    });
    expect(evidence).toHaveLength(1);
    const e = evidence[0];
    expect(e?.tenantId).toBe(TENANT_ID);
    expect(e?.source).toBe("trigify");
    expect(e?.signalType).toBe("T_Role_Change");
    expect(e?.signalClass).toBe("observable");
    expect(e?.tier).toBe("A");
    expect(e?.copyAssertable).toBe(true);
    expect(e?.evidenceUrl).toBe("https://www.linkedin.com/posts/jane-doe_promo-1");
    expect(e?.evidenceDate).toBeInstanceOf(Date);
    expect(e?.confidence).toBeGreaterThan(0);
    expect(e?.confidence).toBeLessThanOrEqual(1);
    expect(e?.isRestricted).toBe(false);
  });

  it("projects a derived signal with copyAssertable=false and a low fixed confidence", async () => {
    const { adapter } = makeAdapter([
      signalRow({
        id: "sig-derived",
        dedupeKey: "ext:sig_derived",
        signalType: "T_Buying_Window",
        signalClass: "derived",
        tier: "A",
        copyAssertable: false,
        evidenceUrl: null,
        evidenceDate: null,
        headline: "Elevated buying-window signal",
        confidence: 0.5,
      }),
    ]);
    const evidence = await adapter.fetchSignals(TENANT_ID, {
      companyId: COMPANY_ID,
    });
    expect(evidence).toHaveLength(1);
    const e = evidence[0];
    expect(e?.signalClass).toBe("derived");
    expect(e?.copyAssertable).toBe(false);
    expect(e?.evidenceUrl).toBeUndefined();
    // Derived confidence must stay low enough that it can never win the
    // dominant-signal contest against a real observable, even before the
    // copyAssertable guard kicks in (belt-and-braces).
    expect(e?.confidence).toBeLessThan(0.5);
  });

  it("stamps every returned Evidence with the caller-supplied tenantId (no cross-tenant leakage)", async () => {
    const { adapter } = makeAdapter([signalRow()]);
    const a = await adapter.fetchSignals("tenant-A", { companyId: COMPANY_ID });
    const b = await adapter.fetchSignals("tenant-B", { companyId: COMPANY_ID });
    for (const ev of a) expect(ev.tenantId).toBe("tenant-A");
    for (const ev of b) expect(ev.tenantId).toBe("tenant-B");
  });

  it("populates hsContactId on Evidence when the signal record carries one", async () => {
    const { adapter } = makeAdapter([signalRow({ hsContactId: "hs-42" })]);
    const evidence = await adapter.fetchSignals(TENANT_ID, {
      companyId: COMPANY_ID,
    });
    expect((evidence[0] as unknown as { hsContactId?: string }).hsContactId).toBe("hs-42");
  });

  it("queries the store scoped to the requested company only", async () => {
    const { adapter, fetchSignalsForCompany } = makeAdapter([signalRow()]);
    await adapter.fetchSignals(TENANT_ID, { companyId: COMPANY_ID });
    expect(fetchSignalsForCompany).toHaveBeenCalledWith(TENANT_ID, COMPANY_ID);
  });

  it("does not throw on a store read failure; propagates so the assembler marks degraded", async () => {
    const fetchSignalsForCompany = vi.fn(async () => {
      throw new Error("db unreachable");
    });
    const adapter = new TrigifyStoreAdapter({ fetchSignalsForCompany });
    await expect(adapter.fetchSignals(TENANT_ID, { companyId: COMPANY_ID })).rejects.toThrow(
      "db unreachable",
    );
  });

  it("ranks multiple signals for the same target and still emits Evidence for each row", async () => {
    const rows = [
      signalRow({
        id: "s1",
        dedupeKey: "ext:s1",
        signalType: "T_Role_Change",
        tier: "A",
      }),
      signalRow({
        id: "s2",
        dedupeKey: "ext:s2",
        signalType: "T_Buying_Window",
        signalClass: "derived",
        tier: "A",
        copyAssertable: false,
        evidenceUrl: null,
        evidenceDate: null,
      }),
    ];
    const { adapter } = makeAdapter(rows);
    const evidence = await adapter.fetchSignals(TENANT_ID, {
      companyId: COMPANY_ID,
    });
    expect(evidence).toHaveLength(2);
    const observable = evidence.find((e) => e.signalClass === "observable");
    const derived = evidence.find((e) => e.signalClass === "derived");
    expect(observable).toBeDefined();
    expect(derived).toBeDefined();
    // The observable's confidence should reflect the boosted ranking strength
    // (an in-window derived signal is present), while staying <= 1.
    expect(observable?.confidence).toBeGreaterThan(0);
    expect(observable?.confidence).toBeLessThanOrEqual(1);
  });
});
