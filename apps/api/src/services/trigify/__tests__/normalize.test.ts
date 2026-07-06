/**
 * Tests for Trigify feed-item normalization (Stage A Task 5).
 *
 * Source of truth: `trigify_source.py` (OrbStack VM,
 * `.../outreach-engine/trigify_source.py`) — the enum-name -> trigger_code
 * decision table (`_TYPE_MAP` / `classify_signal_type`) and
 * `normalize_feed_item`. Ports the observable/derived claim construction and
 * the honest-skip-on-unknown-type behavior (never fabricate a trigger code).
 */

import { describe, expect, it } from "vitest";
import { classifySignalType, normalizeFeedItem } from "../normalize";

describe("classifySignalType", () => {
  it("maps every documented Trigify enum spelling to its trigger code", () => {
    expect(classifySignalType("changed_role")).toEqual({
      triggerCode: "T_Role_Change",
      level: "person",
      signalClass: "observable",
    });
    expect(classifySignalType("role_change")).toEqual({
      triggerCode: "T_Role_Change",
      level: "person",
      signalClass: "observable",
    });
    expect(classifySignalType("changed_company")).toEqual({
      triggerCode: "T_New_Role_Joined",
      level: "person",
      signalClass: "observable",
    });
    expect(classifySignalType("started_hiring")).toEqual({
      triggerCode: "T_Hiring_Surge",
      level: "person",
      signalClass: "observable",
    });
    expect(classifySignalType("posted_about_tracked_topic")).toEqual({
      triggerCode: "T_Topic_Post",
      level: "person",
      signalClass: "observable",
    });
    expect(classifySignalType("commented_on_tracked")).toEqual({
      triggerCode: "T_Comment_On_Tracked",
      level: "person",
      signalClass: "observable",
    });
    expect(classifySignalType("liked_competitor_content")).toEqual({
      triggerCode: "T_Competitor_Engagement",
      level: "person",
      signalClass: "observable",
    });
    expect(classifySignalType("engaged_with_tracked_topic")).toEqual({
      triggerCode: "T_Topic_Engage",
      level: "person",
      signalClass: "observable",
    });
    expect(classifySignalType("buying_window")).toEqual({
      triggerCode: "T_Buying_Window",
      level: "person",
      signalClass: "derived",
    });
    expect(classifySignalType("influence")).toEqual({
      triggerCode: "T_Influence",
      level: "person",
      signalClass: "derived",
    });
    expect(classifySignalType("company_started_hiring")).toEqual({
      triggerCode: "T_Company_Hiring",
      level: "company",
      signalClass: "observable",
    });
    expect(classifySignalType("company_jobs_count_increased")).toEqual({
      triggerCode: "T_Company_Jobs_Up",
      level: "company",
      signalClass: "derived",
    });
    expect(classifySignalType("company_started_posting")).toEqual({
      triggerCode: "T_Company_Initiative",
      level: "company",
      signalClass: "observable",
    });
    expect(classifySignalType("expansion")).toEqual({
      triggerCode: "T_Expansion",
      level: "company",
      signalClass: "derived",
    });
  });

  it("normalizes surface spelling variance (case, punctuation, spaces) to one entry", () => {
    expect(classifySignalType("Changed Role")).toEqual(classifySignalType("changed_role"));
    expect(classifySignalType("CHANGED-ROLE")).toEqual(classifySignalType("changed_role"));
  });

  it("returns null for an unknown/unmappable type (never fabricate a trigger code)", () => {
    expect(classifySignalType("something_totally_unknown")).toBeNull();
    expect(classifySignalType("")).toBeNull();
  });
});

describe("normalizeFeedItem", () => {
  it("normalizes a person-level observable role-change item", () => {
    const item = {
      id: "sig_1",
      type: "changed_role",
      profile_url: "https://www.linkedin.com/in/jane-doe/",
      headline: "Jane Doe became VP of RevOps at Acme Corp",
      url: "https://www.linkedin.com/posts/jane-doe_promotion-activity-1",
      posted_at: "2026-07-01T09:00:00.000Z",
    };
    const sig = normalizeFeedItem(item);
    expect(sig).not.toBeNull();
    expect(sig?.signalType).toBe("T_Role_Change");
    expect(sig?.signalClass).toBe("observable");
    expect(sig?.level).toBe("person");
    expect(sig?.copyAssertable).toBe(true);
    expect(sig?.evidenceUrl).toBe("https://www.linkedin.com/posts/jane-doe_promotion-activity-1");
    expect(sig?.evidenceDate).toBe("2026-07-01");
    expect(sig?.linkedinUrl).toBe("https://www.linkedin.com/in/jane-doe/");
    expect(sig?.targetId).toBe("linkedin.com/in/jane-doe");
    expect(sig?.allowedClaims).not.toBeNull();
    expect(sig?.allowedClaims?.length).toBe(1);
  });

  it("normalizes a derived buying-window item with NO evidence_url and copyAssertable=false", () => {
    const item = {
      id: "sig_2",
      type: "buying_window",
      profile_url: "https://www.linkedin.com/in/jane-doe/",
      headline: "Jane Doe shows elevated buying-window signals",
      url: "https://www.linkedin.com/posts/jane-doe_should-be-dropped",
      posted_at: "2026-07-02T09:00:00.000Z",
    };
    const sig = normalizeFeedItem(item);
    expect(sig).not.toBeNull();
    expect(sig?.signalType).toBe("T_Buying_Window");
    expect(sig?.signalClass).toBe("derived");
    expect(sig?.copyAssertable).toBe(false);
    // Derived signals must never carry an evidence_url, even if the raw item had one.
    expect(sig?.evidenceUrl).toBeNull();
    expect(sig?.allowedClaims).toBeNull();
  });

  it("returns null for an unmappable signal type (honest skip, never fabricate)", () => {
    const item = { id: "sig_3", type: "some_unknown_thing", url: "https://x" };
    expect(normalizeFeedItem(item)).toBeNull();
  });

  it("resolves a company-level signal target from the company URL", () => {
    const item = {
      id: "sig_4",
      type: "company_started_posting",
      company_url: "https://www.linkedin.com/company/acme-corp/",
      headline: "Acme Corp started posting an initiative",
      url: "https://www.linkedin.com/posts/acme-corp_initiative-1",
      posted_at: "2026-07-03T09:00:00.000Z",
    };
    const sig = normalizeFeedItem(item);
    expect(sig?.level).toBe("company");
    expect(sig?.targetId).toBe("linkedin.com/company/acme-corp");
  });

  it("computes a stable dedupe key from source/target/type/url/date", () => {
    const item = {
      id: "sig_5",
      type: "changed_role",
      profile_url: "https://www.linkedin.com/in/jane-doe/",
      url: "https://www.linkedin.com/posts/jane-doe_promo",
      posted_at: "2026-07-01T09:00:00.000Z",
    };
    const first = normalizeFeedItem(item);
    const second = normalizeFeedItem({ ...item });
    expect(first?.dedupeKey).toBe(second?.dedupeKey);
    expect(first?.dedupeKey.length).toBeGreaterThan(0);
  });

  it("prefers the external id for the dedupe key when present", () => {
    const item = {
      id: "sig_stable_ext_id",
      type: "changed_role",
      profile_url: "https://www.linkedin.com/in/jane-doe/",
      url: "https://www.linkedin.com/posts/jane-doe_promo",
      posted_at: "2026-07-01T09:00:00.000Z",
    };
    const sig = normalizeFeedItem(item);
    expect(sig?.dedupeKey).toBe("ext:sig_stable_ext_id");
  });

  it("attempts contact resolution via an injected contacts index; leaves null when absent", () => {
    const item = {
      id: "sig_6",
      type: "changed_role",
      profile_url: "https://www.linkedin.com/in/jane-doe/",
      url: "https://www.linkedin.com/posts/jane-doe_promo",
      posted_at: "2026-07-01T09:00:00.000Z",
    };
    const withoutIndex = normalizeFeedItem(item);
    expect(withoutIndex?.hsContactId).toBeNull();

    const withIndex = normalizeFeedItem(item, {
      contactsIndex: { "linkedin.com/in/jane-doe": ["hs-42"] },
    });
    expect(withIndex?.hsContactId).toBe("hs-42");
  });

  it("never fabricates a contact match when the target is ambiguous (>1 candidate)", () => {
    const item = {
      id: "sig_7",
      type: "changed_role",
      profile_url: "https://www.linkedin.com/in/jane-doe/",
      url: "https://www.linkedin.com/posts/jane-doe_promo",
      posted_at: "2026-07-01T09:00:00.000Z",
    };
    const sig = normalizeFeedItem(item, {
      contactsIndex: { "linkedin.com/in/jane-doe": ["hs-42", "hs-99"] },
    });
    expect(sig?.hsContactId).toBeNull();
    expect(sig?.ambiguousContact).toBe(true);
  });
});
