/**
 * Trigify signal taxonomy — the 16-signal → `trigger_code` map.
 *
 * Ported verbatim from the canonical OpenClaw source table:
 * `.../runtime-workspace/live/skills/trigify/references/signal-types.md`
 * (Task-1 contract spike; Trigify help articles; `@trigify/cli` enum names).
 *
 * HARD CLASSIFICATION RULE (non-negotiable — see plan
 * `.claude/tasks/trigify-signals-into-account-planning.md` fidelity
 * requirements):
 * - OBSERVABLE = a real event with an evidence URL (post, job ad, role
 *   change, comment). May be asserted in copy, always with its evidence
 *   record (url + date).
 * - DERIVED = a Trigify inference with no single citable event
 *   (buying-window, influence, expansion, jobs-count-up).
 *   Prioritization-only, NEVER asserted in copy, and a derived signal ALONE
 *   can never cross the send threshold — it only boosts strength when >= 1
 *   in-window observable signal exists for the same target.
 *
 * This module is the taxonomy-level source of truth consumed by:
 * - `services/trigify/normalize.ts` (Task 5): raw feed item enum name →
 *   `TrigifyTriggerCode`.
 * - `services/trigify/signal-ranking.ts` (Task 4): tier weights + the
 *   derived-alone-never-crosses-threshold rule.
 * - `adapters/signal/trigify.ts` (Task 7): sets `Evidence.copyAssertable`
 *   from `TRIGIFY_SIGNAL_TYPES[code].copyAssertable`.
 */

import type { SignalClass, SignalTier } from "./domain-types.js";

/** Level at which a Trigify signal fires. */
export type TrigifySignalLevel = "person" | "company";

/** Re-exported for ergonomic imports alongside the taxonomy constant. */
export type TrigifySignalTier = SignalTier;

/**
 * The 16 canonical Trigify `trigger_code` values.
 *
 * Note: signals #7, #8, #9 in the source table (liked tracked company
 * content / liked tracked person content / engaged with tracked topic) all
 * share the `T_Topic_Engage` trigger code — the source table documents them
 * as three distinct Trigify-observed events that normalize to one code, so
 * this union has 13 distinct string values covering all 16 rows.
 */
export type TrigifyTriggerCode =
  | "T_Role_Change"
  | "T_New_Role_Joined"
  | "T_Hiring_Surge"
  | "T_Topic_Post"
  | "T_Comment_On_Tracked"
  | "T_Competitor_Engagement"
  | "T_Topic_Engage"
  | "T_Company_Hiring"
  | "T_Company_Jobs_Up"
  | "T_Company_Initiative"
  | "T_Buying_Window"
  | "T_Influence"
  | "T_Expansion";

/** One taxonomy row: classification metadata for a single trigger code. */
export type TrigifySignalTypeEntry = {
  /** Human-readable Trigify signal name, as documented. */
  description: string;
  /** Level at which the signal fires. */
  level: TrigifySignalLevel;
  /** observable = may be asserted in copy; derived = prioritization-only. */
  signalClass: SignalClass;
  /** Strength tier. Derived/boost-only rows still carry a tier for weighting. */
  tier: TrigifySignalTier;
  /**
   * Whether this signal may ever be asserted as a fact in generated copy.
   * `false` for every row in the derived set (see
   * {@link DERIVED_SIGNAL_TRIGGER_CODES}), `true` for every observable row —
   * including the "weak observable" engagement rows (#6-10), which are
   * still real citable events, just weaker ones (tier C).
   */
  copyAssertable: boolean;
};

/**
 * The full 16-signal taxonomy, keyed by `trigger_code`.
 *
 * Source table row numbers are noted in comments for traceability back to
 * `references/signal-types.md`.
 */
export const TRIGIFY_SIGNAL_TYPES: Record<TrigifyTriggerCode, TrigifySignalTypeEntry> = {
  // #1 Changed role (new job title) — person, observable, tier A.
  T_Role_Change: {
    description: "Changed role (new job title)",
    level: "person",
    signalClass: "observable",
    tier: "A",
    copyAssertable: true,
  },
  // #2 Changed company / newly joined — person, observable, tier B.
  T_New_Role_Joined: {
    description: "Changed company / newly joined",
    level: "person",
    signalClass: "observable",
    tier: "B",
    copyAssertable: true,
  },
  // #3 Became hiring / posted a job ad — person, observable, tier B.
  T_Hiring_Surge: {
    description: "Became hiring / posted a job ad",
    level: "person",
    signalClass: "observable",
    tier: "B",
    copyAssertable: true,
  },
  // #4 Posted about tracked topic — person, observable, tier A.
  T_Topic_Post: {
    description: "Posted about tracked topic",
    level: "person",
    signalClass: "observable",
    tier: "A",
    copyAssertable: true,
  },
  // #5 Commented on tracked content — person, observable, tier B.
  T_Comment_On_Tracked: {
    description: "Commented on tracked content",
    level: "person",
    signalClass: "observable",
    tier: "B",
    copyAssertable: true,
  },
  // #6, #10 Liked/engaged with competitor content — person, weak observable, tier C.
  T_Competitor_Engagement: {
    description: "Liked or engaged with competitor content",
    level: "person",
    signalClass: "observable",
    tier: "C",
    copyAssertable: true,
  },
  // #7, #8, #9 Liked/engaged with tracked company/person/topic content —
  // person, weak observable, tier C. Three source rows share this code.
  T_Topic_Engage: {
    description: "Liked or engaged with tracked topic/company/person content",
    level: "person",
    signalClass: "observable",
    tier: "C",
    copyAssertable: true,
  },
  // #11 Buying-window signal — person, DERIVED, boost-only (tier A weight,
  // never a sole trigger, never asserted).
  T_Buying_Window: {
    description: "Buying-window signal (inferred)",
    level: "person",
    signalClass: "derived",
    tier: "A",
    copyAssertable: false,
  },
  // #12 Influence signal — person, DERIVED, boost-only (tier C weight).
  T_Influence: {
    description: "Influence signal (inferred)",
    level: "person",
    signalClass: "derived",
    tier: "C",
    copyAssertable: false,
  },
  // #13 Company started hiring (relevant roles) — company, observable, tier B.
  T_Company_Hiring: {
    description: "Company started hiring (relevant roles)",
    level: "company",
    signalClass: "observable",
    tier: "B",
    copyAssertable: true,
  },
  // #14 Company jobs-count increased — company, derived-metric (aggregate
  // count, no single citable url), non-assertable, boost-only, tier C.
  T_Company_Jobs_Up: {
    description: "Company jobs-count increased",
    level: "company",
    signalClass: "derived",
    tier: "C",
    copyAssertable: false,
  },
  // #15 Company started posting (initiative) — company, observable, tier A.
  T_Company_Initiative: {
    description: "Company started posting (initiative)",
    level: "company",
    signalClass: "observable",
    tier: "A",
    copyAssertable: true,
  },
  // #16 Expansion signal — company, DERIVED, boost-only (tier C weight).
  T_Expansion: {
    description: "Expansion signal (inferred)",
    level: "company",
    signalClass: "derived",
    tier: "C",
    copyAssertable: false,
  },
};

/**
 * The derived / never-asserted / never-a-sole-trigger set.
 *
 * Includes `T_Company_Jobs_Up` even though the source table calls it
 * "derived-metric" rather than strictly "DERIVED" — it gets identical
 * handling (non-copy-assertable, boost-only) per the source table's own
 * footnote 2.
 */
export const DERIVED_SIGNAL_TRIGGER_CODES = [
  "T_Buying_Window",
  "T_Influence",
  "T_Expansion",
  "T_Company_Jobs_Up",
] as const satisfies readonly TrigifyTriggerCode[];

/** Type guard: is this trigger code in the derived/non-assertable set? */
export function isDerivedTriggerCode(code: string): boolean {
  return (DERIVED_SIGNAL_TRIGGER_CODES as readonly string[]).includes(code);
}

/**
 * Internal Trigify signal enum names, for normalization (raw feed item →
 * `TrigifyTriggerCode`). Verbatim from `references/signal-types.md`
 * "Internal Trigify signal enum names" section — the exact mapping logic
 * (including disambiguation between overlapping enum names like `hiring`
 * meaning either a person or company signal) lives in
 * `services/trigify/normalize.ts` (Task 5), which owns the full enum ->
 * trigger_code decision table, not this constant.
 */
export const TRIGIFY_INTERNAL_ENUM_NAMES = [
  "changed_role",
  "changed_company",
  "started_hiring",
  "hiring",
  "hiring_company",
  "hiring_job",
  "posted_about_tracked_topic",
  "tracked_topic",
  "liked_competitor_content",
  "competitor_engagement",
  "buying_window",
  "influence",
  "influence_surge",
  "expansion",
] as const;

/**
 * Full `MonitoringType` enum (creatable monitor sources), from the
 * `@trigify/cli` embedded Prisma schema / `trigify_client.MONITORING_TYPES`.
 * Consumed by `monitor-manager.ts` (Task 9) to validate a subscribe request's
 * `monitorType` before spending credits.
 */
export const TRIGIFY_MONITORING_TYPES = [
  // V1 (documented)
  "linkedin-posts",
  "linkedin-profile",
  "reddit-posts",
  "subreddit-posts",
  "youtube-videos",
  "youtube-channel",
  "podcast-episodes",
  "podcast-keywords",
  "podcast-posts",
  "twitter-posts",
  "twitter-profile",
  // V1.5 (advertised, all confirmed creatable)
  "substack-posts",
  "substack-profile",
  "substack-notes",
  "hackernews-stories",
  "dailydev-posts",
  "github-issues",
  "github-discussions",
  "bluesky-posts",
  "bluesky-profile",
  // Bonus (present in enum)
  "instagram-hashtag",
  "instagram-profile",
  "threads-posts",
  "threads-profile",
  "threads-mentions",
  "tiktok-videos",
  "tiktok-profile",
  "news-posts",
  "newsapi-ai-posts",
] as const;

export type TrigifyMonitoringType = (typeof TRIGIFY_MONITORING_TYPES)[number];
