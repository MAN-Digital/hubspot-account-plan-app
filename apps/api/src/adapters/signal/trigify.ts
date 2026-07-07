/**
 * TrigifyStoreAdapter (Stage A Task 7).
 *
 * `ProviderAdapter` implementation that reads PERSISTED `signals` rows (the
 * poller, Task 6, is what writes them) for a company, runs the ranking
 * service (Task 4) grouped per target, and projects the result into
 * `Evidence[]` for the existing snapshot-assembler pipeline.
 *
 * This is the structural fix for the pull-model mismatch documented in the
 * plan: Trigify is feed/subscription-based, not a synchronous per-company
 * API — so unlike `ExaAdapter` (which calls out to Exa live on every
 * `fetchSignals`), this adapter never makes a network call. It only reads
 * the tenant's already-ingested signal store.
 *
 * Confidence mapping (the fidelity-critical part):
 *  - OBSERVABLE signals: confidence = `confidenceFromContribution(strength)`
 *    from the ranking result for that signal's target group, so a fresh
 *    tier-A signal naturally outranks Exa's flat 0.7 default in the
 *    dominant-signal contest.
 *  - DERIVED signals: `copyAssertable: false` + a FIXED LOW confidence
 *    ({@link DERIVED_EVIDENCE_CONFIDENCE}) regardless of the ranking
 *    contribution. This is belt-and-braces with the `extractDominantSignal`
 *    guard in `reason-generator.ts` (Task 7's assembler-level fix) — even if
 *    that guard were ever removed or bypassed, a derived signal's confidence
 *    alone could never win the dominance contest against a real observable.
 *    `evidenceUrl`/`evidenceDate` are never populated for derived rows
 *    (mirrors the normalize-layer invariant that a derived signal carries no
 *    evidence_url).
 */

import { createEvidence, type Evidence } from "@hap/config";
import { and, type Database, eq, signals } from "@hap/db";
import { trigifyRankingConfigSchema } from "@hap/validators";
import {
  confidenceFromContribution,
  DEFAULT_TRIGIFY_RANKING_CONFIG,
  type RankableSignal,
  scoreSignals,
  type TrigifyRankingConfig,
} from "../../services/trigify/signal-ranking.js";
import type { ProviderAdapter, ProviderCompanyContext } from "../provider-adapter.js";

/** Stable provider identifier — used by the factory and `provider_config.provider_name`. */
export const TRIGIFY_PROVIDER_NAME = "trigify" as const;

/**
 * Fixed confidence assigned to every derived signal's projected Evidence.
 * Deliberately well below any realistic observable contribution (tier-C
 * observable at max recency is ~0.30) so a derived signal cannot win the
 * dominant-signal contest purely on confidence — the `copyAssertable`
 * guard is the primary enforcement, this is the belt to that brace.
 */
export const DERIVED_EVIDENCE_CONFIDENCE = 0.2;

/**
 * Shape of a persisted `signals` row this adapter consumes, mapped to
 * camelCase domain fields. Mirrors `packages/db/src/schema/signals.ts`
 * (the DB row itself uses snake_case columns; the store-read function this
 * adapter is given is responsible for that mapping, matching the pattern of
 * every other DB-backed dependency in this codebase — e.g.
 * `config-resolver.ts`).
 */
export interface PersistedSignalRow {
  id: string;
  dedupeKey: string;
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
  detail: string | null;
  confidence: number;
  raw: Record<string, unknown>;
}

export interface TrigifyStoreAdapterOptions {
  /** Read all persisted signals for a tenant + HubSpot company id. */
  fetchSignalsForCompany: (tenantId: string, hsCompanyId: string) => Promise<PersistedSignalRow[]>;
  /** Ranking config override. Defaults to the YAML-mirrored defaults. */
  rankingConfig?: TrigifyRankingConfig;
  /** Clock override for ranking's recency math (tests only). */
  now?: () => Date;
}

/** Map a persisted signal row to the ranking service's input shape. */
function toRankableSignal(row: PersistedSignalRow): RankableSignal {
  return {
    targetId: row.targetId,
    signalType: row.signalType,
    signalClass: row.signalClass,
    tier: row.tier ?? "C",
    level: row.level,
    observedAt: row.observedAt ?? row.evidenceDate ?? new Date(0).toISOString(),
    headline: row.headline,
    detail: row.detail ?? undefined,
    allowedClaims: row.allowedClaims,
  };
}

/**
 * Reads persisted Trigify signals for a company and projects them into
 * `Evidence[]` via the ranking service. Never calls the network — the
 * poller (Task 6) is the only Trigify network caller in this app.
 */
export class TrigifyStoreAdapter implements ProviderAdapter {
  readonly name = TRIGIFY_PROVIDER_NAME;
  private readonly fetchSignalsForCompany: TrigifyStoreAdapterOptions["fetchSignalsForCompany"];
  private readonly rankingConfig: TrigifyRankingConfig;
  private readonly now: () => Date;

  constructor(options: TrigifyStoreAdapterOptions) {
    this.fetchSignalsForCompany = options.fetchSignalsForCompany;
    this.rankingConfig = options.rankingConfig ?? DEFAULT_TRIGIFY_RANKING_CONFIG;
    this.now = options.now ?? (() => new Date());
  }

  async fetchSignals(tenantId: string, company: ProviderCompanyContext): Promise<Evidence[]> {
    const rows = await this.fetchSignalsForCompany(tenantId, company.companyId);
    if (rows.length === 0) return [];

    // Group rows by targetId so ranking's derived-boost-only-when-observable
    // rule sees the correct in-window signal set per target (person or
    // company entity the signals fired on).
    const byTarget = new Map<string, PersistedSignalRow[]>();
    for (const row of rows) {
      const bucket = byTarget.get(row.targetId) ?? [];
      bucket.push(row);
      byTarget.set(row.targetId, bucket);
    }

    const now = this.now();
    const out: Evidence[] = [];

    for (const targetRows of byTarget.values()) {
      const rankable = targetRows.map(toRankableSignal);
      const ranked = scoreSignals(rankable, {
        config: this.rankingConfig,
        now,
      });

      for (const row of targetRows) {
        const isDerived = row.signalClass === "derived";
        const confidence = isDerived
          ? DERIVED_EVIDENCE_CONFIDENCE
          : confidenceFromContribution(ranked.strength);

        out.push(
          createEvidence(tenantId, {
            id: row.id,
            source: TRIGIFY_PROVIDER_NAME,
            confidence,
            content: row.headline,
            timestamp: row.observedAt ? new Date(row.observedAt) : now,
            isRestricted: false,
            signalType: row.signalType,
            signalClass: row.signalClass,
            tier: row.tier ?? undefined,
            copyAssertable: row.copyAssertable,
            // Derived signals never carry evidence — mirrors the
            // normalize-layer invariant (Task 5).
            evidenceUrl: isDerived ? undefined : (row.evidenceUrl ?? undefined),
            evidenceDate: !isDerived && row.evidenceDate ? new Date(row.evidenceDate) : undefined,
            ...(row.hsContactId ? { hsContactId: row.hsContactId } : {}),
          }),
        );
      }
    }

    return out;
  }
}

/** Map a `signals` DB row (snake_case columns, camelCase Drizzle field names) to {@link PersistedSignalRow}. */
function mapSignalRow(row: {
  id: string;
  dedupeKey: string;
  signalType: string;
  signalClass: string;
  tier: string;
  level: string;
  targetId: string;
  linkedinUrl: string | null;
  hsContactId: string | null;
  hsCompanyId: string | null;
  evidenceUrl: string | null;
  evidenceDate: Date | null;
  observedAt: Date;
  allowedClaims: unknown;
  copyAssertable: boolean;
  headline: string;
  detail: string | null;
  confidence: number;
  raw: unknown;
}): PersistedSignalRow {
  return {
    id: row.id,
    dedupeKey: row.dedupeKey,
    signalType: row.signalType,
    signalClass: row.signalClass === "derived" ? "derived" : "observable",
    tier: row.tier === "A" || row.tier === "B" || row.tier === "C" ? row.tier : null,
    level: row.level === "company" ? "company" : "person",
    targetId: row.targetId,
    linkedinUrl: row.linkedinUrl,
    hsContactId: row.hsContactId,
    hsCompanyId: row.hsCompanyId,
    evidenceUrl: row.evidenceUrl,
    evidenceDate: row.evidenceDate ? row.evidenceDate.toISOString() : null,
    observedAt: row.observedAt.toISOString(),
    allowedClaims: Array.isArray(row.allowedClaims)
      ? (row.allowedClaims as Array<Record<string, unknown>>)
      : [],
    copyAssertable: row.copyAssertable,
    headline: row.headline,
    detail: row.detail,
    confidence: row.confidence,
    raw: row.raw && typeof row.raw === "object" ? (row.raw as Record<string, unknown>) : {},
  };
}

/**
 * Build a {@link TrigifyStoreAdapterOptions.fetchSignalsForCompany} backed by
 * the real `signals` table, scoped to `(tenantId, hsCompanyId)`. Tenant
 * isolation: the query always filters on `tenantId` — combined with RLS on
 * the `signals` table (migration `0011_trigify_signals.sql`), a cross-tenant
 * read is impossible at both the query and database layers.
 */
export function createDbFetchSignalsForCompany(
  db: Database,
): TrigifyStoreAdapterOptions["fetchSignalsForCompany"] {
  return async (tenantId, hsCompanyId) => {
    const rows = await db
      .select()
      .from(signals)
      .where(and(eq(signals.tenantId, tenantId), eq(signals.hsCompanyId, hsCompanyId)));
    return rows.map(mapSignalRow);
  };
}

/**
 * Parse a tenant's raw `provider_config.settings` jsonb (as returned by
 * `config-resolver.getProviderConfig`'s `ProviderConfig.settings`) into a
 * fully-defaulted {@link TrigifyRankingConfig} via the Zod schema in
 * `@hap/validators`. An empty/absent settings object (`{}` or `undefined`)
 * yields the schema's defaults — which mirror
 * `DEFAULT_TRIGIFY_RANKING_CONFIG` — so a tenant who never touches the
 * ranking config still gets sane zero-config behavior.
 *
 * A malformed settings object (fails Zod validation — e.g. a tenant-set
 * `sendThreshold` outside 0..1) falls back to the defaults rather than
 * throwing: a bad settings row must never break signal ranking for the
 * whole tenant.
 */
export function parseTrigifyRankingConfig(rawSettings: unknown): TrigifyRankingConfig {
  const candidate =
    rawSettings && typeof rawSettings === "object" && !Array.isArray(rawSettings)
      ? (rawSettings as Record<string, unknown>)
      : {};
  const result = trigifyRankingConfigSchema.safeParse(candidate);
  return result.success ? result.data : DEFAULT_TRIGIFY_RANKING_CONFIG;
}

/**
 * Build a {@link TrigifyStoreAdapter} wired to the real database, with its
 * ranking config resolved from the tenant's `provider_config.settings`
 * jsonb. This is the constructor `createSignalAdapter` (Task 7 factory
 * registration) uses for the `"trigify"` case, mirroring how
 * `hubspot-enrichment` builds its `HubSpotClient` from `{ db, tenantId }`
 * deps.
 *
 * `rawSettings` is the tenant's trigify `provider_config.settings` value —
 * pass `config.settings` from the resolved `ProviderConfig` (now populated;
 * see `config-resolver.ts`'s settings-column fix). `overrides` lets tests
 * inject a stub `fetchSignalsForCompany` without a live database.
 */
export function createTrigifyStoreAdapter(
  db: Database,
  rawSettings?: unknown,
  overrides?: Partial<TrigifyStoreAdapterOptions>,
): TrigifyStoreAdapter {
  return new TrigifyStoreAdapter({
    fetchSignalsForCompany: createDbFetchSignalsForCompany(db),
    rankingConfig: parseTrigifyRankingConfig(rawSettings),
    ...overrides,
  });
}
