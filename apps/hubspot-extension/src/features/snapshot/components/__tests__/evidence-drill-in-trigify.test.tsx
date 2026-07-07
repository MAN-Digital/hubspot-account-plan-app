import { Link, Modal } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it } from "vitest";
import { EvidenceDrillIn } from "../evidence-drill-in";
import { collectAllText } from "./test-utils";
import { trigifyObservableStrong } from "./trigify-fixtures";

/**
 * Reason-card evidence verification (Stage A Task 10): when the dominant
 * signal is an OBSERVABLE Trigify signal, the drill-in must surface a
 * clickable evidence URL (a `Link` whose href is the `evidenceUrl`) and the
 * evidence date, alongside the Trigify signal type. Legacy Exa/News evidence
 * (which carries none of these fields) must keep rendering unchanged.
 */
describe("EvidenceDrillIn — Trigify observable signal", () => {
  function observableEvidence() {
    const snap = trigifyObservableStrong("t1");
    const ev = snap.evidence.find((e) => e.signalClass === "observable");
    if (!ev) throw new Error("fixture must carry an observable evidence row");
    return ev;
  }

  it("renders a clickable Link whose href is the evidenceUrl", () => {
    const ev = observableEvidence();
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);

    const links = renderer.findAll(Link);
    const evidenceLink = links.find((l) => {
      const href = l.props.href as unknown;
      if (typeof href === "string") return href === ev.evidenceUrl;
      if (href && typeof href === "object" && "url" in href) {
        return (href as { url?: string }).url === ev.evidenceUrl;
      }
      return false;
    });
    expect(evidenceLink).toBeDefined();
  });

  it("renders the evidence date (event date, distinct from ingestion timestamp)", () => {
    const ev = observableEvidence();
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
    const body = collectAllText(renderer.find(Modal));
    if (!ev.evidenceDate) throw new Error("fixture must carry an evidenceDate");
    const isoDate = ev.evidenceDate.toISOString().slice(0, 10);
    expect(body).toContain(isoDate);
  });

  it("renders the Trigify signal type (trigger code) so the reason is attributable", () => {
    const ev = observableEvidence();
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EvidenceDrillIn evidence={ev} isRestricted={false} onClose={() => {}} />);
    const body = collectAllText(renderer.find(Modal));
    expect(body).toContain("T_Role_Change");
  });

  it("does NOT render an evidence Link for legacy evidence without an evidenceUrl", () => {
    // A plain Exa-shaped row: no evidenceUrl/date/signalType.
    const legacy = {
      id: "exa:https://techcrunch.com/x",
      tenantId: "t1",
      source: "techcrunch.com",
      timestamp: new Date(),
      confidence: 0.7,
      content: "Funding round announced.",
      isRestricted: false,
    };
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<EvidenceDrillIn evidence={legacy} isRestricted={false} onClose={() => {}} />);
    // No Link should be present (the parsed http URL still renders as Text, not a Link,
    // for legacy rows — only evidenceUrl is promoted to a clickable Link).
    expect(renderer.findAll(Link).length).toBe(0);
  });
});
