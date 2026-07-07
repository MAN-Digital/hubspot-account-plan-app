import {
  fixtureDegraded,
  fixtureEligibleStrong,
  fixtureEmpty,
  fixtureFewerContacts,
  fixtureIneligible,
  fixtureLowConfidence,
  fixtureRestricted,
  fixtureStale,
  type Snapshot,
} from "@hap/config";
import { Alert, Button, Heading, Link, Modal } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it } from "vitest";
import SnapshotStateRenderer from "../snapshot-state-renderer";
import { collectAllText } from "./test-utils";
import { trigifyDerivedOnly, trigifyObservableStrong } from "./trigify-fixtures";

/**
 * Stage A Task 10 verification: all 8 QA states render correctly through the
 * top-level `SnapshotStateRenderer`, driven by snapshot payloads shaped like
 * real ranking outcomes. The Trigify-specific cases assert the two invariants
 * that matter for the observable-vs-derived contract:
 *
 *   1. An OBSERVABLE Trigify signal surfaces as the reason-to-contact with a
 *      clickable evidence URL + date (via the person → evidence drill-in).
 *   2. A DERIVED-ONLY company renders the EMPTY state — never a derived reason.
 */

function render(snapshot: Snapshot) {
  const renderer = createRenderer("crm.record.tab");
  renderer.render(<SnapshotStateRenderer snapshot={snapshot} />);
  return renderer;
}

describe("SnapshotStateRenderer — all 8 QA states", () => {
  it("eligible-strong: renders the reason heading and 3 people", () => {
    const renderer = render(fixtureEligibleStrong("t1"));
    const text = collectAllText(renderer.getRootNode());
    expect(text).toContain("Fresh funding + active email engagement from champion.");
    expect(renderer.findAll(Button).length).toBe(3);
  });

  it("eligible-fewer-contacts: renders 1-2 people with degraded + low-confidence banners", () => {
    const renderer = render(fixtureFewerContacts("t1"));
    expect(renderer.findAll(Button).length).toBe(2);
    // fewer-contacts is modeled as degraded + lowConfidence — both banners show.
    expect(renderer.findAll(Alert).length).toBeGreaterThanOrEqual(2);
  });

  it("empty: renders the explicit no-credible-reason message and no people", () => {
    const renderer = render(fixtureEmpty("t1"));
    const text = collectAllText(renderer.getRootNode());
    expect(text).toContain("No credible reason to contact at this time.");
    expect(renderer.findAll(Button).length).toBe(0);
  });

  it("stale: renders a warning Alert above the reason", () => {
    const renderer = render(fixtureStale("t1"));
    const alerts = renderer.findAll(Alert);
    expect(alerts.some((a) => a.props.variant === "warning")).toBe(true);
    const text = collectAllText(renderer.getRootNode());
    expect(text).toContain("Historical partnership — may no longer be current.");
  });

  it("degraded: renders a danger Alert", () => {
    const renderer = render(fixtureDegraded("t1"));
    const alerts = renderer.findAll(Alert);
    expect(alerts.some((a) => a.props.variant === "danger")).toBe(true);
  });

  it("low-confidence: renders a caution/warning Alert with the trust score", () => {
    const renderer = render(fixtureLowConfidence("t1"));
    const alerts = renderer.findAll(Alert);
    expect(alerts.length).toBeGreaterThanOrEqual(1);
    const text = collectAllText(renderer.getRootNode());
    expect(text).toContain("30%");
  });

  it("ineligible: renders the not-eligible message and no reason", () => {
    const renderer = render(fixtureIneligible("t1"));
    const text = collectAllText(renderer.getRootNode());
    expect(text).toContain("This account is not eligible for outreach.");
    expect(renderer.findAll(Button).length).toBe(0);
  });

  it("restricted: renders the generic placeholder and leaks nothing", () => {
    const renderer = render(fixtureRestricted("t1"));
    const text = collectAllText(renderer.getRootNode());
    expect(text).toContain("No data available for this account.");
    expect(renderer.maybeFind(Modal)).toBeNull();
  });
});

describe("SnapshotStateRenderer — Trigify observable vs derived", () => {
  it("observable-strong: surfaces the observable Trigify signal as the reason", () => {
    const snap = trigifyObservableStrong("t1");
    const renderer = render(snap);
    const text = collectAllText(renderer.getRootNode());
    expect(text).toContain("Jordan Decider changed role to VP Revenue Operations.");
    // Reason heading is present.
    expect(renderer.findAll(Heading).length).toBeGreaterThanOrEqual(1);
    // The person who fired the signal is clickable.
    expect(renderer.findAll(Button).length).toBe(1);
  });

  it("observable-strong: the person drill-in exposes a clickable evidence URL + date", () => {
    const snap = trigifyObservableStrong("t1");
    const observable = snap.evidence.find((e) => e.signalClass === "observable");
    if (!observable?.evidenceUrl || !observable.evidenceDate) {
      throw new Error("fixture must carry evidenceUrl + evidenceDate");
    }
    const renderer = render(snap);

    // Open the drill-in by clicking the person.
    const personButton = renderer.findAll(Button)[0];
    if (!personButton) throw new Error("expected a person button");
    personButton.trigger("onClick");

    // A Modal opens with a clickable evidence Link and the event date.
    expect(renderer.find(Modal)).toBeTruthy();
    const links = renderer.findAll(Link);
    const evidenceLink = links.find((l) => {
      const href = l.props.href as unknown;
      return typeof href === "string"
        ? href === observable.evidenceUrl
        : Boolean(href) &&
            typeof href === "object" &&
            (href as { url?: string }).url === observable.evidenceUrl;
    });
    expect(evidenceLink).toBeDefined();

    const body = collectAllText(renderer.find(Modal));
    expect(body).toContain(observable.evidenceDate.toISOString().slice(0, 10));
    expect(body).toContain("T_Role_Change");
  });

  it("derived-only: renders the EMPTY state — never a derived reason", () => {
    const snap = trigifyDerivedOnly("t1");
    const renderer = render(snap);
    const text = collectAllText(renderer.getRootNode());
    expect(text).toContain("No credible reason to contact at this time.");
    // The derived signal's content must never surface as a reason.
    expect(text).not.toContain("Derived buying-window inference");
    expect(text).not.toContain("T_Buying_Window");
    // No people, no reason heading, no drill-in.
    expect(renderer.findAll(Button).length).toBe(0);
    expect(renderer.maybeFind(Modal)).toBeNull();
  });
});
