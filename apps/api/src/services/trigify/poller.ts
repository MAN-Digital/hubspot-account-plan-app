/**
 * Trigify poller — per-tenant feed pull -> normalize -> match -> upsert
 * (Stage A Task 6).
 *
 * TS port of `trigify_poller.py`'s `poll()` (OrbStack VM,
 * `.../outreach-engine/trigify_poller.py`), narrowed to this app's scope:
 * the ranking/decision-emission and suppression machinery stay in Stage B
 * territory (outreach engine); this poller's job ends at a persisted,
 * normalized `signals` row per feed item.
 *
 * HARD SCOPE (mirrors codex R2/R3 in the source): this poller performs
 * READS ONLY. `PollTenantDeps.client` exposes exactly one method
 * (`getSocialSignalsFeed`) — no write-capable Trigify method is reachable
 * from this module, so a credit spend from the poll path is structurally
 * impossible, not just policy. The confirm-gated `createSubscription` lives
 * entirely in `TrigifyClient` (Task 3) and `monitor-manager.ts` (Task 9),
 * never here.
 *
 * Idempotency: `upsertSignal` MUST be backed by an `INSERT ... ON CONFLICT
 * (tenant_id, dedupe_key) DO UPDATE/NOTHING` against the `signals` table
 * (unique constraint `signals_tenant_dedupe_key_unique`,
 * `packages/db/src/schema/signals.ts`). `normalizeFeedItem`'s dedupe key is
 * a pure function of the feed item's fields, so re-polling the same feed
 * page always produces the SAME key for the SAME item — replays collapse.
 *
 * Company matching failures (`matchCompany` returns `null`) are honest:
 * `hsCompanyId` stays `null` on the upserted row rather than a fabricated
 * guess. The `TrigifyStoreAdapter` (Task 7) only surfaces signals with a
 * resolved `hsCompanyId` for a given company snapshot.
 */

import type { CompanyMatchResult } from "./company-match.js";
import { normalizeFeedItem, type RawFeedItem } from "./normalize.js";

/**
 * The ONLY Trigify client surface the poller is given. Deliberately
 * omits every write/guarded method — see file header "HARD SCOPE".
 */
export interface TrigifyFeedClient {
  getSocialSignalsFeed(params?: {
    page?: number;
    pageSize?: number;
  }): Promise<{ data: RawFeedItem[] }>;
}

/** The row shape `upsertSignal` persists — mirrors `packages/db/src/schema/signals.ts`. */
export interface SignalUpsertRow {
  dedupeKey: string;
  source: string;
  stream: string;
  signalType: string;
  signalClass: "observable" | "derived";
  tier: "A" | "B" | "C" | null;
  level: "person" | "company";
  targetId: string;
  linkedinUrl: string | null;
  hsContactId: string | null;
  hsCompanyId: string | null;
  evidenceUrl: string | null;
  evidenceDate: string | null;
  observedAt: string | null;
  allowedClaims: Array<Record<string, unknown>>;
  copyAssertable: boolean;
  headline: string;
  detail: string;
  confidence: number;
  raw: Record<string, unknown>;
}

export interface PollTenantDeps {
  client: TrigifyFeedClient;
  /** Resolve a normalized signal's LinkedIn URL/domain -> hs_company_id. */
  matchCompany: (
    tenantId: string,
    input: { linkedinUrl?: string | null; domain?: string | null },
  ) => Promise<CompanyMatchResult | null>;
  /** Persist one signal row, idempotent on (tenantId, dedupeKey). */
  upsertSignal: (tenantId: string, row: SignalUpsertRow) => Promise<void>;
  /** Feed pagination knobs. Defaults: page 1, pageSize 50. */
  page?: number;
  pageSize?: number;
  /** Optional contacts index for entity-resolution-lite (Task 5 normalize). */
  contactsIndex?: Record<string, string[]>;
}

export interface PollTenantResult {
  signalsRecorded: number;
  skipped: number;
  errors: string[];
}

/**
 * Poll ONE tenant's Trigify feed: pull (free) -> normalize -> match company
 * -> upsert. Never throws on a feed read failure — the error is recorded so
 * the cron endpoint can report a partial-failure summary without one
 * tenant's outage blocking every other tenant's poll.
 */
export async function pollTenant(
  deps: PollTenantDeps,
  tenantId: string,
): Promise<PollTenantResult> {
  const result: PollTenantResult = {
    signalsRecorded: 0,
    skipped: 0,
    errors: [],
  };

  let items: RawFeedItem[];
  try {
    const envelope = await deps.client.getSocialSignalsFeed({
      page: deps.page ?? 1,
      pageSize: deps.pageSize ?? 50,
    });
    items = envelope.data ?? [];
  } catch (err) {
    result.errors.push(err instanceof Error ? err.message : String(err));
    return result;
  }

  for (const item of items) {
    let normalized: ReturnType<typeof normalizeFeedItem>;
    try {
      normalized = normalizeFeedItem(item, {
        contactsIndex: deps.contactsIndex,
      });
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
      continue;
    }

    if (normalized === null) {
      result.skipped += 1;
      continue;
    }

    const companyDomain = extractDomain(item);
    let match: CompanyMatchResult | null = null;
    try {
      match = await deps.matchCompany(tenantId, {
        linkedinUrl:
          normalized.level === "company" ? normalized.linkedinUrl : companyLinkedinUrl(item),
        domain: companyDomain,
      });
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }

    const row: SignalUpsertRow = {
      dedupeKey: normalized.dedupeKey,
      source: normalized.source,
      stream: normalized.stream,
      signalType: normalized.signalType,
      signalClass: normalized.signalClass,
      tier: null,
      level: normalized.level,
      targetId: normalized.targetId,
      linkedinUrl: normalized.linkedinUrl,
      hsContactId: normalized.hsContactId,
      hsCompanyId: match?.hsCompanyId ?? normalized.hsCompanyId,
      evidenceUrl: normalized.evidenceUrl,
      evidenceDate: normalized.evidenceDate,
      observedAt: normalized.observedAt,
      allowedClaims: normalized.allowedClaims ?? [],
      copyAssertable: normalized.copyAssertable,
      headline: normalized.headline,
      detail: normalized.detail,
      confidence: normalized.confidence,
      raw: normalized.raw ?? {},
    };

    try {
      await deps.upsertSignal(tenantId, row);
      result.signalsRecorded += 1;
    } catch (err) {
      result.errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return result;
}

/** Best-effort company domain extraction from a raw feed item. */
function extractDomain(item: RawFeedItem): string | null {
  const candidates = ["company_domain", "companyDomain", "domain"];
  for (const key of candidates) {
    const v = item[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim().toLowerCase();
  }
  return null;
}

/** Best-effort company LinkedIn URL extraction (for a person-level signal's employer). */
function companyLinkedinUrl(item: RawFeedItem): string | null {
  const candidates = ["company_url", "companyUrl", "company_profile_url", "company_linkedin_url"];
  for (const key of candidates) {
    const v = item[key];
    if (typeof v === "string" && v.trim().length > 0) return v.trim();
  }
  return null;
}

export interface PollAllTenantsDeps {
  /** Tenants with an enabled trigify provider_config row. */
  listEnabledTenants: () => Promise<string[]>;
  /** Build the per-tenant poll dependencies (client is tenant-scoped by its decrypted key). */
  buildTenantDeps: (tenantId: string) => Promise<PollTenantDeps>;
}

export interface PollAllTenantsResult {
  tenantsPolled: number;
  signalsRecorded: number;
  skipped: number;
  errors: Array<{ tenantId: string; error: string }>;
}

/**
 * Poll every tenant with an enabled Trigify provider row. One tenant's
 * failure never blocks another tenant's poll — errors are aggregated per
 * tenant into the summary.
 */
export async function pollAllTenants(deps: PollAllTenantsDeps): Promise<PollAllTenantsResult> {
  const summary: PollAllTenantsResult = {
    tenantsPolled: 0,
    signalsRecorded: 0,
    skipped: 0,
    errors: [],
  };

  const tenantIds = await deps.listEnabledTenants();
  for (const tenantId of tenantIds) {
    try {
      const tenantDeps = await deps.buildTenantDeps(tenantId);
      const result = await pollTenant(tenantDeps, tenantId);
      summary.tenantsPolled += 1;
      summary.signalsRecorded += result.signalsRecorded;
      summary.skipped += result.skipped;
      for (const error of result.errors) {
        summary.errors.push({ tenantId, error });
      }
    } catch (err) {
      summary.errors.push({
        tenantId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return summary;
}
