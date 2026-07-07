import {
  createEvidence,
  createPerson,
  createSnapshot,
  createStateFlags,
  type Snapshot,
} from "@hap/config";

/**
 * Trigify-signal-shaped snapshot fixtures for the extension's reason-card and
 * state-renderer verification tests (Stage A Task 10).
 *
 * These live in the extension test tree (not `@hap/config`) because they are
 * test doubles for THIS package's UI. They mirror the Snapshot shape the
 * Trigify store-adapter + ranking pipeline (Stage A tasks 4/7) produce, so the
 * card can be verified against real-shaped ranking outcomes:
 *
 *  - `trigifyObservableStrong`: an OBSERVABLE tier-A signal with a clickable
 *    `evidenceUrl` + `evidenceDate`, `copyAssertable === true`. This is the
 *    reason-to-contact the tab must surface with a clickable evidence link.
 *  - `trigifyDerivedOnly`: a company whose ONLY Trigify signal is DERIVED
 *    (`copyAssertable === false`). Per the observable-vs-derived contract, a
 *    derived-only company can never assert a reason — the ranking outcome is
 *    the EMPTY state (monitor-only), never a derived reason.
 *
 * Both are additive over the existing 8-state fixtures in `@hap/config`; they
 * do NOT replace them.
 */

const DAY_MS = 24 * 60 * 60 * 1000;

/** Observable tier-A Trigify signal → eligible-strong, with evidence URL + date. */
export function trigifyObservableStrong(tenantId: string): Snapshot {
  const evidenceDate = new Date(Date.now() - 2 * DAY_MS);
  const observable = createEvidence(tenantId, {
    id: "trigify:https://www.linkedin.com/posts/jordan-decider-role-change",
    source: "linkedin.com",
    confidence: 0.94,
    content: "Jordan Decider changed role to VP Revenue Operations.",
    isRestricted: false,
    signalType: "T_Role_Change",
    signalClass: "observable",
    tier: "A",
    copyAssertable: true,
    evidenceUrl: "https://www.linkedin.com/posts/jordan-decider-role-change",
    evidenceDate,
    hsContactId: "contact-jordan",
  });
  const person = createPerson({
    id: "p-trigify-1",
    name: "Jordan Decider",
    title: "VP Revenue Operations",
    reasonToTalk: "Just stepped into a RevOps leadership role — timing is ideal.",
    evidenceRefs: [observable.id],
  });
  return createSnapshot(tenantId, {
    companyId: "co-trigify-observable",
    eligibilityState: "eligible",
    reasonToContact: "Jordan Decider changed role to VP Revenue Operations.",
    people: [person],
    evidence: [observable],
    trustScore: 0.94,
    stateFlags: createStateFlags(),
  });
}

/**
 * Derived-only company → EMPTY. The derived signal is carried in `evidence`
 * (so a defensive UI could theoretically see it) but is `copyAssertable:false`,
 * the snapshot has no reason and no people, and `stateFlags.empty` is set —
 * exactly what the ranking service emits when the only in-window signal is
 * derived.
 */
export function trigifyDerivedOnly(tenantId: string): Snapshot {
  const derived = createEvidence(tenantId, {
    id: "trigify:derived:T_Buying_Window",
    source: "trigify",
    confidence: 0.15,
    content: "Derived buying-window inference — prioritization only.",
    isRestricted: false,
    signalType: "T_Buying_Window",
    signalClass: "derived",
    tier: "B",
    copyAssertable: false,
  });
  return createSnapshot(tenantId, {
    companyId: "co-trigify-derived",
    eligibilityState: "eligible",
    reasonToContact: undefined,
    people: [],
    evidence: [derived],
    trustScore: undefined,
    stateFlags: createStateFlags({ empty: true }),
  });
}
