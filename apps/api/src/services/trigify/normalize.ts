/**
 * Trigify feed-item normalization (Stage A Task 5).
 *
 * TS port of `trigify_source.py`'s `_TYPE_MAP` / `classify_signal_type` /
 * `normalize_feed_item` (OrbStack VM,
 * `.../outreach-engine/trigify_source.py`), combined with
 * `signal_store.py`'s `normalize_target_id` / `ledger_key` /
 * `normalize_signal` canonicalization.
 *
 * This module owns the FULL enum-name -> trigger_code decision table (raw
 * Trigify feed items use varying spellings for the same signal — this is the
 * §e table, verbatim) plus the observable/derived claim construction and the
 * dedupe-key computation the poller (Task 6) relies on for idempotent
 * upserts.
 *
 * HONESTY RULE (mirrors the source): an unmappable/unknown raw signal type
 * returns `null` — the caller records an honest skip. We NEVER fabricate a
 * trigger code for a type we don't recognize.
 */

import { TRIGIFY_SIGNAL_TYPES, type TrigifyTriggerCode } from "@hap/config";

export type NormalizeLevel = "person" | "company";
export type NormalizeSignalClass = "observable" | "derived";

export interface SignalTypeClassification {
  triggerCode: TrigifyTriggerCode;
  level: NormalizeLevel;
  signalClass: NormalizeSignalClass;
}

/**
 * Trigify internal signal enum (decoded in the Task-1 spike) -> (trigger
 * code, level, class). Keys are normalized (lowercase, non-alnum -> "_") so
 * many surface spellings collapse to one entry. This IS the
 * `references/signal-types.md` table, verbatim — mirrors `_TYPE_MAP` in
 * `trigify_source.py`.
 */
const TYPE_MAP: Record<string, SignalTypeClassification> = {
  // 1 — changed role (new job title)
  changed_role: {
    triggerCode: "T_Role_Change",
    level: "person",
    signalClass: "observable",
  },
  role_change: {
    triggerCode: "T_Role_Change",
    level: "person",
    signalClass: "observable",
  },
  new_job_title: {
    triggerCode: "T_Role_Change",
    level: "person",
    signalClass: "observable",
  },
  changed_job_title: {
    triggerCode: "T_Role_Change",
    level: "person",
    signalClass: "observable",
  },
  // 2 — changed company / newly joined
  changed_company: {
    triggerCode: "T_New_Role_Joined",
    level: "person",
    signalClass: "observable",
  },
  newly_joined: {
    triggerCode: "T_New_Role_Joined",
    level: "person",
    signalClass: "observable",
  },
  new_role_joined: {
    triggerCode: "T_New_Role_Joined",
    level: "person",
    signalClass: "observable",
  },
  joined_company: {
    triggerCode: "T_New_Role_Joined",
    level: "person",
    signalClass: "observable",
  },
  // 3 — became hiring / posted a job ad (person)
  became_hiring: {
    triggerCode: "T_Hiring_Surge",
    level: "person",
    signalClass: "observable",
  },
  started_hiring: {
    triggerCode: "T_Hiring_Surge",
    level: "person",
    signalClass: "observable",
  },
  posted_job_ad: {
    triggerCode: "T_Hiring_Surge",
    level: "person",
    signalClass: "observable",
  },
  posted_a_job_ad: {
    triggerCode: "T_Hiring_Surge",
    level: "person",
    signalClass: "observable",
  },
  hiring_surge: {
    triggerCode: "T_Hiring_Surge",
    level: "person",
    signalClass: "observable",
  },
  // 4 — posted about tracked topic
  posted_about_tracked_topic: {
    triggerCode: "T_Topic_Post",
    level: "person",
    signalClass: "observable",
  },
  posted_about_topic: {
    triggerCode: "T_Topic_Post",
    level: "person",
    signalClass: "observable",
  },
  topic_post: {
    triggerCode: "T_Topic_Post",
    level: "person",
    signalClass: "observable",
  },
  // 5 — commented on tracked content
  commented_on_tracked_content: {
    triggerCode: "T_Comment_On_Tracked",
    level: "person",
    signalClass: "observable",
  },
  commented_on_tracked: {
    triggerCode: "T_Comment_On_Tracked",
    level: "person",
    signalClass: "observable",
  },
  comment_on_tracked: {
    triggerCode: "T_Comment_On_Tracked",
    level: "person",
    signalClass: "observable",
  },
  // 6 + 10 — competitor engagement / liked competitor content
  liked_competitor_content: {
    triggerCode: "T_Competitor_Engagement",
    level: "person",
    signalClass: "observable",
  },
  competitor_engagement: {
    triggerCode: "T_Competitor_Engagement",
    level: "person",
    signalClass: "observable",
  },
  // 7/8/9 — liked/engaged tracked company/person/topic
  liked_tracked_company_content: {
    triggerCode: "T_Topic_Engage",
    level: "person",
    signalClass: "observable",
  },
  liked_tracked_person_content: {
    triggerCode: "T_Topic_Engage",
    level: "person",
    signalClass: "observable",
  },
  engaged_with_tracked_topic: {
    triggerCode: "T_Topic_Engage",
    level: "person",
    signalClass: "observable",
  },
  topic_engage: {
    triggerCode: "T_Topic_Engage",
    level: "person",
    signalClass: "observable",
  },
  // 11 — buying-window (DERIVED)
  buying_window: {
    triggerCode: "T_Buying_Window",
    level: "person",
    signalClass: "derived",
  },
  // 12 — influence (DERIVED)
  influence: {
    triggerCode: "T_Influence",
    level: "person",
    signalClass: "derived",
  },
  influence_surge: {
    triggerCode: "T_Influence",
    level: "person",
    signalClass: "derived",
  },
  // 13 — company started hiring (relevant roles)
  company_started_hiring: {
    triggerCode: "T_Company_Hiring",
    level: "company",
    signalClass: "observable",
  },
  hiring_company: {
    triggerCode: "T_Company_Hiring",
    level: "company",
    signalClass: "observable",
  },
  company_hiring: {
    triggerCode: "T_Company_Hiring",
    level: "company",
    signalClass: "observable",
  },
  // 14 — company jobs-count increased (derived-metric, not assertable)
  company_jobs_count_increased: {
    triggerCode: "T_Company_Jobs_Up",
    level: "company",
    signalClass: "derived",
  },
  jobs_count_increased: {
    triggerCode: "T_Company_Jobs_Up",
    level: "company",
    signalClass: "derived",
  },
  company_jobs_up: {
    triggerCode: "T_Company_Jobs_Up",
    level: "company",
    signalClass: "derived",
  },
  // 15 — company started posting (initiative)
  company_started_posting: {
    triggerCode: "T_Company_Initiative",
    level: "company",
    signalClass: "observable",
  },
  company_initiative: {
    triggerCode: "T_Company_Initiative",
    level: "company",
    signalClass: "observable",
  },
  // 16 — expansion (DERIVED)
  expansion: {
    triggerCode: "T_Expansion",
    level: "company",
    signalClass: "derived",
  },
};

// Candidate keys (Trigify field spellings vary; probe several).
const URL_KEYS = [
  "post_url",
  "postUrl",
  "job_url",
  "jobUrl",
  "ad_url",
  "comment_url",
  "commentUrl",
  "like_url",
  "engagement_url",
  "target_url",
  "content_url",
  "url",
];
const DATE_KEYS = [
  "posted_date",
  "postedDate",
  "posted_at",
  "postedAt",
  "date",
  "created_at",
  "createdAt",
  "observed_at",
  "observedAt",
  "detected_at",
  "detectedAt",
  "signal_date",
];
const AUTHOR_KEYS = [
  "actor_profile_url",
  "actorProfileUrl",
  "author_profile_url",
  "authorProfileUrl",
  "profile_url",
  "profileUrl",
  "linkedin_url",
  "linkedinUrl",
  "actor_url",
  "member_url",
  "author_url",
];
const COMPANY_URL_KEYS = [
  "company_url",
  "companyUrl",
  "company_profile_url",
  "company_linkedin_url",
  "organization_url",
  "org_url",
  "company_page",
];
const TITLE_KEYS = ["job_title", "jobTitle", "title", "ad_title", "role", "position"];
const FROM_TITLE_KEYS = ["from_title", "previous_title", "old_title", "former_title"];
const TO_TITLE_KEYS = ["to_title", "new_title", "current_title", "title"];
const COMPANY_NAME_KEYS = [
  "company",
  "company_name",
  "companyName",
  "organization",
  "organization_name",
  "org_name",
];
const TOPIC_KEYS = [
  "topic",
  "tracked_topic",
  "trackedTopic",
  "matched_topic",
  "keyword",
  "matched_keyword",
  "tracked_keyword",
  "subject",
];
const TEXT_KEYS = ["text", "content", "comment_text", "body", "excerpt", "summary", "snippet"];
const ID_KEYS = ["id", "signal_id", "signalId", "event_id", "eventId", "result_id", "uuid", "_id"];
const TYPE_KEYS = [
  "signal_type",
  "type",
  "signal",
  "event_type",
  "eventType",
  "kind",
  "category",
  "name",
  "signal_name",
];
const ACTOR_NAME_KEYS = ["actor_name", "author_name", "author", "name", "full_name", "member_name"];

export type RawFeedItem = Record<string, unknown>;

function first(item: RawFeedItem, keys: readonly string[]): string {
  for (const k of keys) {
    const v = item[k];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

function normType(raw: string): string {
  return (raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

/**
 * Map a Trigify signal-type string -> classification, per the taxonomy.
 * Unknown -> null (the caller drops it honestly; never fabricate a trigger).
 */
export function classifySignalType(rawType: string): SignalTypeClassification | null {
  return TYPE_MAP[normType(rawType)] ?? null;
}

/** Normalize a date/ts string to YYYY-MM-DD; null if unusable. */
function parseDateOnly(raw: string): string | null {
  if (!raw) return null;
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(raw.trim());
  if (m) return m[1] ?? null;
  const txt = raw.trim();
  if (/^\d+$/.test(txt)) {
    const val = Number(txt);
    const secs = val > 1e12 ? val / 1000 : val;
    const d = new Date(secs * 1000);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString().slice(0, 10);
    }
  }
  return null;
}

function observedIso(item: RawFeedItem): string | null {
  const raw = first(item, DATE_KEYS);
  if (!raw) return null;
  const day = parseDateOnly(raw);
  return day ? `${day}T00:00:00.000Z` : null;
}

/**
 * Normalize a target id (LinkedIn URL preferred) for stable joins/dedupe.
 * Lowercases + strips scheme/`www.`/trailing-slash/query/fragment for a URL;
 * else returns the first non-empty candidate trimmed. Mirrors
 * `signal_store.normalize_target_id`.
 */
export function normalizeTargetId(...candidates: Array<string | null | undefined>): string {
  for (const cand of candidates) {
    const val = (cand ?? "").trim();
    if (!val) continue;
    const low = val.toLowerCase();
    if (low.includes("linkedin.com") || low.startsWith("http://") || low.startsWith("https://")) {
      let s = low.split("#")[0]?.split("?")[0] ?? low;
      s = s.replace("https://", "").replace("http://", "");
      if (s.startsWith("www.")) s = s.slice(4);
      return s.replace(/\/+$/, "");
    }
    return val;
  }
  return "";
}

export interface NormalizedSignal {
  source: string;
  stream: string;
  signalType: TrigifyTriggerCode;
  signalClass: NormalizeSignalClass;
  level: NormalizeLevel;
  targetId: string;
  linkedinUrl: string | null;
  hsContactId: string | null;
  hsCompanyId: string | null;
  externalId: string | null;
  urn: string | null;
  evidenceUrl: string | null;
  evidenceDate: string | null;
  observedAt: string | null;
  allowedClaims: Array<Record<string, unknown>> | null;
  copyAssertable: boolean;
  headline: string;
  detail: string;
  confidence: number;
  monitorId: string | null;
  raw: Record<string, unknown> | null;
  dedupeKey: string;
  /** Non-persisted hint: >1 candidate contact matched this target's LinkedIn URL. */
  ambiguousContact: boolean;
}

/** Stable idempotency key: `ext:<external_id>` when present, else a composite. */
export function ledgerKey(fields: {
  externalId?: string | null;
  targetId?: string | null;
  linkedinUrl?: string | null;
  signalType?: string | null;
  evidenceUrl?: string | null;
  observedAt?: string | null;
  evidenceDate?: string | null;
}): string {
  const ext = (fields.externalId ?? "").trim();
  if (ext) return `ext:${ext}`;
  const tid = normalizeTargetId(fields.targetId, fields.linkedinUrl);
  const parts = [
    tid,
    fields.signalType ?? "",
    fields.evidenceUrl ?? "",
    fields.observedAt ?? fields.evidenceDate ?? "",
  ];
  return `cmp:${parts.join("|")}`;
}

/** One typed `allowedClaims` fact for an observable signal. */
function buildClaim(
  triggerCode: TrigifyTriggerCode,
  item: RawFeedItem,
  evidenceUrl: string,
  evidenceDate: string | null,
  externalId: string,
): Record<string, unknown> {
  const cid = `${triggerCode}:${externalId || evidenceUrl}`;
  switch (triggerCode) {
    case "T_Role_Change":
      return {
        claimId: cid,
        type: "role_change",
        person: first(item, ACTOR_NAME_KEYS) || null,
        fromTitle: first(item, FROM_TITLE_KEYS) || null,
        toTitle: first(item, TO_TITLE_KEYS) || null,
        date: evidenceDate,
        url: evidenceUrl || null,
      };
    case "T_New_Role_Joined":
      return {
        claimId: cid,
        type: "role_change",
        person: first(item, ACTOR_NAME_KEYS) || null,
        company: first(item, COMPANY_NAME_KEYS) || null,
        toTitle: first(item, TO_TITLE_KEYS) || null,
        date: evidenceDate,
        url: evidenceUrl || null,
      };
    case "T_Hiring_Surge":
    case "T_Company_Hiring":
      return {
        claimId: cid,
        type: "job_ad",
        title: first(item, TITLE_KEYS) || null,
        company: first(item, COMPANY_NAME_KEYS) || null,
        url: evidenceUrl || null,
        posted: evidenceDate,
      };
    case "T_Topic_Post":
      return {
        claimId: cid,
        type: "topic_post",
        topic: first(item, TOPIC_KEYS) || null,
        url: evidenceUrl || null,
        date: evidenceDate,
      };
    case "T_Company_Initiative":
      return {
        claimId: cid,
        type: "company_initiative",
        initiative: first(item, TOPIC_KEYS) || first(item, TEXT_KEYS) || null,
        company: first(item, COMPANY_NAME_KEYS) || null,
        url: evidenceUrl || null,
        date: evidenceDate,
      };
    case "T_Comment_On_Tracked":
      return {
        claimId: cid,
        type: "comment",
        quote: first(item, TEXT_KEYS) || null,
        url: evidenceUrl || null,
        date: evidenceDate,
      };
    case "T_Competitor_Engagement":
    case "T_Topic_Engage":
      return {
        claimId: cid,
        type: "engagement",
        target: triggerCode === "T_Competitor_Engagement" ? "competitor" : "tracked",
        url: evidenceUrl || null,
        date: evidenceDate,
      };
    default:
      return {
        claimId: cid,
        type: "observation",
        url: evidenceUrl || null,
        date: evidenceDate,
      };
  }
}

/**
 * Resolve a normalized target id -> (hsContactId, ambiguous). Exactly one
 * match -> that id. Zero -> (null, false) (unknown, not ambiguous). More
 * than one -> (null, true) — surfaced, never guessed. Mirrors
 * `trigify_source.map_author_to_contact`.
 */
function mapAuthorToContact(
  targetId: string,
  index: Record<string, string[]> | undefined,
): { hsContactId: string | null; ambiguous: boolean } {
  if (!index) return { hsContactId: null, ambiguous: false };
  const ids = index[targetId] ?? [];
  if (ids.length === 1) return { hsContactId: ids[0] ?? null, ambiguous: false };
  if (ids.length > 1) return { hsContactId: null, ambiguous: true };
  return { hsContactId: null, ambiguous: false };
}

export interface NormalizeFeedItemOptions {
  stream?: string;
  /** Normalized-target-id -> HubSpot contact id[] index (entity-resolution-lite). */
  contactsIndex?: Record<string, string[]>;
  monitorId?: string | null;
}

/**
 * One Social-Signals feed item -> canonical signal record, or `null` when
 * the signal type is unknown/unmappable (caller records the skip honestly).
 *
 * Sets `source="trigify"`, the taxonomy trigger_code + observable/derived
 * class, evidence url+date, structured `allowedClaims` (observable only —
 * derived signals get `null`, never an evidence url, per the fidelity
 * invariant), and — via the contacts index — the resolved HubSpot contact
 * id (ambiguous -> left unset + flagged).
 */
export function normalizeFeedItem(
  item: RawFeedItem,
  options: NormalizeFeedItemOptions = {},
): NormalizedSignal | null {
  const rawType = first(item, TYPE_KEYS);
  const mapped = classifySignalType(rawType);
  if (mapped === null) return null;
  const { triggerCode, level, signalClass } = mapped;
  const isObservable = signalClass === "observable";

  const externalId = first(item, ID_KEYS);
  const urn = first(item, ["urn", "activity_urn", "entity_urn", "post_urn", "postUrn"]);
  const evidenceUrl = isObservable ? first(item, URL_KEYS) : "";
  const evidenceDate = parseDateOnly(first(item, DATE_KEYS));
  const observedAt = observedIso(item);

  const liUrl =
    level === "company"
      ? first(item, COMPANY_URL_KEYS) || first(item, AUTHOR_KEYS)
      : first(item, AUTHOR_KEYS);
  const targetId = normalizeTargetId(liUrl);

  let hsContactId: string | null = null;
  let ambiguous = false;
  if (level === "person") {
    const resolved = mapAuthorToContact(targetId, options.contactsIndex);
    hsContactId = resolved.hsContactId;
    ambiguous = resolved.ambiguous;
  }

  const allowedClaims = isObservable
    ? [buildClaim(triggerCode, item, evidenceUrl, evidenceDate, externalId)]
    : null;

  const actor = first(item, ACTOR_NAME_KEYS);
  const topic = first(item, TOPIC_KEYS);
  const headline = `${triggerCode}${actor ? `: ${actor}` : ""}`;
  const detail = first(item, TEXT_KEYS) || topic || "";

  const confRaw = item.confidence;
  const confidence =
    typeof confRaw === "number" && Number.isFinite(confRaw) ? confRaw : isObservable ? 0.85 : 0.5;

  // Belt-and-braces: TRIGIFY_SIGNAL_TYPES is the single source of truth for
  // copyAssertable — never re-derive it from signalClass alone.
  const copyAssertable = TRIGIFY_SIGNAL_TYPES[triggerCode].copyAssertable;

  const dedupeKey = ledgerKey({
    externalId,
    targetId,
    linkedinUrl: liUrl,
    signalType: triggerCode,
    evidenceUrl,
    observedAt,
    evidenceDate,
  });

  return {
    source: "trigify",
    stream: options.stream ?? "trigify",
    signalType: triggerCode,
    signalClass,
    level,
    targetId,
    linkedinUrl: liUrl || null,
    hsContactId,
    hsCompanyId: first(item, ["hs_company_id", "company_id"]) || null,
    externalId: externalId || null,
    urn: urn || null,
    evidenceUrl: evidenceUrl || null,
    evidenceDate,
    observedAt,
    allowedClaims,
    copyAssertable,
    headline,
    detail,
    confidence,
    monitorId: options.monitorId ?? null,
    raw: slimRaw(item),
    dedupeKey,
    ambiguousContact: ambiguous,
  };
}

/**
 * Data minimisation: store ONLY the evidence fields consumed downstream
 * (id/urn/post_url/posted_date/type + a short text snippet) — never the
 * full attacker-controlled payload, to cap the PII we retain. Mirrors
 * `trigify_source._slim_raw`.
 */
function slimRaw(item: RawFeedItem): Record<string, unknown> | null {
  return {
    id: first(item, ID_KEYS) || null,
    urn: first(item, ["urn", "activity_urn", "entity_urn", "post_urn", "postUrn"]) || null,
    postUrl: first(item, URL_KEYS) || null,
    postedDate: first(item, DATE_KEYS) || null,
    type: first(item, TYPE_KEYS) || null,
    text: first(item, TEXT_KEYS).slice(0, 280) || null,
  };
}
