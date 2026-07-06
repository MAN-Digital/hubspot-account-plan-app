/**
 * Trigify signal-ranking — config-driven, tiered strength + send/monitor
 * decision (Stage A Task 4).
 *
 * TS port of `signal_ranking.py` + defaults from
 * `config/trigify_signal_ranking.yaml` (OrbStack VM,
 * `.../outreach-engine/signal_ranking.py`). Trigify exposes signal types but
 * no score; this module turns a target's in-window signals into a single
 * composite `strength` and a `strong` / `monitor_only` decision, reading
 * every weight from config (no hardcoded weights).
 *
 * Scoring (all config-driven):
 *   per observable signal, in-window:
 *     contribution = tierWeight[tier] * levelMultiplier * recencyFactor * topicFactor
 *   strength = bestObservableContribution + volumeBonus (capped) + derivedBoost (capped)
 *   decision = "strong" iff strength >= threshold AND hasObservable
 *            = "monitor_only" otherwise
 *
 * HARD RULE (non-negotiable, mirrors codex F16 in the source): a DERIVED
 * signal alone can NEVER cross the send threshold. Derived signals
 * contribute nothing standalone and only add `derivedBoost` when an
 * in-window observable already exists — so a derived-only target scores 0
 * and stays monitor-only, enforced here regardless of config weights.
 *
 * Config placement: the ranking config is read from the trigify
 * `provider_config.settings` JSONB (validated by the Zod schema in
 * `@hap/validators`, see `packages/validators/src/trigify-ranking.ts`) —
 * NOT from `thresholds`, whose shape is locked to
 * `{freshnessMaxDays, minConfidence}`. `DEFAULT_TRIGIFY_RANKING_CONFIG`
 * mirrors the YAML defaults so the module is usable with zero tenant config.
 */

import type { SignalClass, SignalTier } from "@hap/config";

// -- config shape -------------------------------------------------------------

export type TrigifyRankingLevel = "person" | "company";

export interface TrigifyRankingConfig {
  rankingVersion: string;
  /** Strength at/above which a target auto-proposes (vs monitor-only). */
  sendThreshold: number;
  tierWeights: Record<SignalTier, number>;
  /** signal_type -> tier, mirroring `signal_tiers` in the YAML. */
  signalTiers: Record<string, SignalTier>;
  /** The derived / never-asserted / never-a-sole-trigger set. */
  derivedTypes: readonly string[];
  /** Topic-bearing signal types that get topic_factor applied. */
  topicSignalTypes: readonly string[];
  multipliers: Record<TrigifyRankingLevel, number>;
  recency: {
    halfLifeDays: number;
    windowDays: number;
    floor: number;
  };
  topicRelevance: {
    default: number;
    map: Record<string, number>;
  };
  volumeBonusPerExtra: number;
  volumeBonusCap: number;
  derivedBoost: number;
  derivedBoostCap: number;
}

/**
 * Defaults mirroring `config/trigify_signal_ranking.yaml` verbatim. A tenant
 * row overriding a subset of these keys should be shallow/deep-merged over
 * this object (see `services/trigify/normalize.ts` config resolution or the
 * Zod schema defaults in `@hap/validators`).
 */
export const DEFAULT_TRIGIFY_RANKING_CONFIG: TrigifyRankingConfig = {
  rankingVersion: "trigify-rank-v1",
  sendThreshold: 0.6,
  tierWeights: { A: 1.0, B: 0.65, C: 0.3 },
  signalTiers: {
    T_Role_Change: "A",
    T_Topic_Post: "A",
    T_Company_Initiative: "A",
    T_Buying_Window: "A",
    T_New_Role_Joined: "B",
    T_Hiring_Surge: "B",
    T_Comment_On_Tracked: "B",
    T_Company_Hiring: "B",
    T_Competitor_Engagement: "C",
    T_Topic_Engage: "C",
    T_Influence: "C",
    T_Expansion: "C",
    T_Company_Jobs_Up: "C",
  },
  derivedTypes: ["T_Buying_Window", "T_Influence", "T_Expansion", "T_Company_Jobs_Up"],
  topicSignalTypes: ["T_Topic_Post", "T_Topic_Engage", "T_Company_Initiative"],
  multipliers: { person: 1.0, company: 0.7 },
  recency: { halfLifeDays: 14, windowDays: 30, floor: 0.15 },
  topicRelevance: {
    default: 0.65,
    map: {
      revops: 1.0,
      "revenue operations": 1.0,
      hubspot: 1.0,
      cro: 0.95,
      "conversion rate optimization": 0.9,
      "conversion rate optimisation": 0.9,
      "operating model": 0.95,
      "revenue operations model": 0.95,
      "go-to-market": 0.85,
      gtm: 0.85,
      "marketing ops": 0.85,
      "marketing operations": 0.85,
      "sales ops": 0.85,
      "sales operations": 0.85,
      "revenue workflow": 0.9,
      crm: 0.8,
      pipeline: 0.75,
      forecasting: 0.75,
      attribution: 0.75,
      "lifecycle marketing": 0.7,
      "lead routing": 0.75,
    },
  },
  volumeBonusPerExtra: 0.05,
  volumeBonusCap: 0.2,
  derivedBoost: 0.15,
  derivedBoostCap: 0.25,
};

// -- input/output shapes -------------------------------------------------------

/**
 * One signal to be scored. Mirrors the fields `signal_ranking.py` reads off
 * the normalized signal dict (`signal_store.normalize_signal` shape) —
 * consumers pass exactly the fields available on a persisted `signals` row
 * (see `packages/db/src/schema/signals.ts`), mapped to camelCase.
 */
export interface RankableSignal {
  targetId: string;
  signalType: string;
  signalClass: SignalClass;
  tier: SignalTier;
  level: TrigifyRankingLevel;
  /** ISO 8601 timestamp of when the underlying event occurred/was observed. */
  observedAt: string;
  headline?: string;
  detail?: string;
  /** Structured claims this signal carries; used only for topic matching. */
  allowedClaims?: Array<{ topic?: string; [key: string]: unknown }>;
}

/** Per-signal breakdown, kept for audit + best-signal selection. */
export interface SignalContribution {
  signalType: string;
  signalClass: SignalClass;
  tier: SignalTier | null;
  level: TrigifyRankingLevel;
  ageDays: number | null;
  inWindow: boolean;
  tierWeight: number;
  levelFactor: number;
  recencyFactor: number;
  topicFactor: number;
  contribution: number;
}

export type TrigifyRankingDecision = "strong" | "monitor_only";

export interface TrigifyRankingResult {
  targetId: string;
  strength: number;
  threshold: number;
  crossesThreshold: boolean;
  hasObservable: boolean;
  decision: TrigifyRankingDecision;
  bestSignal: SignalContribution | null;
  components: SignalContribution[];
  rankingVersion: string;
  reasons: string[];
}

// -- helpers --------------------------------------------------------------------

function ageDaysOf(signal: RankableSignal, now: Date): number | null {
  const dt = new Date(signal.observedAt);
  if (Number.isNaN(dt.getTime())) return null;
  return Math.max(0, (now.getTime() - dt.getTime()) / 86_400_000);
}

function tierOf(signalType: string, config: TrigifyRankingConfig): SignalTier | null {
  return config.signalTiers[signalType] ?? null;
}

/**
 * A signal is derived if its class says so OR its type is in the config's
 * derivedTypes (belt-and-braces: a mis-flagged producer can't sneak a
 * derived type past the never-sole rule).
 */
function isDerived(signal: RankableSignal, config: TrigifyRankingConfig): boolean {
  if (signal.signalClass === "derived") return true;
  return (config.derivedTypes as readonly string[]).includes(signal.signalType);
}

function recencyFactor(ageDays: number | null, config: TrigifyRankingConfig): number {
  const { halfLifeDays, floor } = config.recency;
  if (ageDays === null) return floor;
  if (halfLifeDays <= 0) return 1;
  const factor = 0.5 ** (ageDays / halfLifeDays);
  return Math.max(floor, Math.min(1, factor));
}

function withinWindow(ageDays: number | null, config: TrigifyRankingConfig): boolean {
  if (ageDays === null) return false;
  return ageDays >= 0 && ageDays <= config.recency.windowDays;
}

function topicFactor(signal: RankableSignal, config: TrigifyRankingConfig): number {
  if (!(config.topicSignalTypes as readonly string[]).includes(signal.signalType)) {
    // non-topic signals (role change, hiring) are unaffected
    return 1;
  }
  const { map, default: defaultWeight } = config.topicRelevance;
  const hayParts: string[] = [];
  for (const claim of signal.allowedClaims ?? []) {
    if (claim && typeof claim.topic === "string") hayParts.push(claim.topic);
  }
  hayParts.push(signal.headline ?? "");
  hayParts.push(signal.detail ?? "");
  const hay = hayParts.join(" ").toLowerCase();

  let best = 0;
  for (const [keyword, weight] of Object.entries(map)) {
    if (keyword && hay.includes(keyword.toLowerCase())) {
      best = Math.max(best, weight);
    }
  }
  return best > 0 ? best : defaultWeight;
}

function levelMultiplier(signal: RankableSignal, config: TrigifyRankingConfig): number {
  return config.multipliers[signal.level] ?? config.multipliers.person;
}

function contributionOf(
  signal: RankableSignal,
  config: TrigifyRankingConfig,
  now: Date,
): SignalContribution {
  const tier = tierOf(signal.signalType, config);
  const tierWeight = tier ? (config.tierWeights[tier] ?? 0) : 0;
  const levelFactor = levelMultiplier(signal, config);
  const age = ageDaysOf(signal, now);
  const recency = recencyFactor(age, config);
  const topic = topicFactor(signal, config);
  const inWindow = withinWindow(age, config);
  const derived = isDerived(signal, config);
  const contribution = round4(tierWeight * levelFactor * recency * topic);

  return {
    signalType: signal.signalType,
    signalClass: derived ? "derived" : "observable",
    tier,
    level: signal.level,
    ageDays: age === null ? null : round2(age),
    inWindow,
    tierWeight: round4(tierWeight),
    levelFactor: round4(levelFactor),
    recencyFactor: round4(recency),
    topicFactor: round4(topic),
    contribution,
  };
}

function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function round3(n: number): number {
  return Math.round(n * 1000) / 1000;
}

// -- public API -----------------------------------------------------------------

export interface ScoreSignalsOptions {
  config?: TrigifyRankingConfig;
  now?: Date;
}

/**
 * Score ONE target's signals into a composite strength + send/monitor
 * decision. `signals` must all belong to the same target — callers group by
 * `targetId` before calling this (mirrors `signal_ranking.score()`).
 *
 * HARD RULE: a derived-only target (no in-window observable) scores 0.0 and
 * is `monitor_only` — derived signals can never cross the threshold alone.
 */
export function scoreSignals(
  signals: RankableSignal[],
  options: ScoreSignalsOptions = {},
): TrigifyRankingResult {
  const config = options.config ?? DEFAULT_TRIGIFY_RANKING_CONFIG;
  const now = options.now ?? new Date();
  const threshold = config.sendThreshold;

  const targetId = signals.find((s) => s.targetId)?.targetId ?? "";
  const components = signals.map((s) => contributionOf(s, config, now));

  const obsInWindow = components.filter((c) => c.signalClass === "observable" && c.inWindow);
  const derivedInWindow = components.filter((c) => c.signalClass === "derived" && c.inWindow);

  const hasObservable = obsInWindow.length > 0;
  const reasons: string[] = [];

  let strength = 0;
  let best: SignalContribution | null = null;

  if (!hasObservable) {
    // Derived-only (or fully out-of-window): cannot cross — monitor-only.
    if (derivedInWindow.length > 0) {
      const types = [...new Set(derivedInWindow.map((c) => c.signalType))].sort();
      reasons.push(
        `derived-only in-window signals (${types.join(", ")}) — derived can never cross the threshold alone; monitor-only until an observable arrives`,
      );
    } else if (components.length > 0) {
      reasons.push("no in-window observable signal — monitor-only");
    } else {
      reasons.push("no signals — monitor-only");
    }
  } else {
    const obsSorted = [...obsInWindow].sort((a, b) => b.contribution - a.contribution);
    const base = obsSorted[0]?.contribution ?? 0;
    best = obsSorted[0] ?? null;

    const volumeBonus = Math.min(
      config.volumeBonusCap,
      config.volumeBonusPerExtra * Math.max(0, obsSorted.length - 1),
    );

    const derivedBonus =
      derivedInWindow.length > 0
        ? Math.min(config.derivedBoostCap, config.derivedBoost * derivedInWindow.length)
        : 0;

    strength = round3(base + volumeBonus + derivedBonus);

    reasons.push(
      `best observable ${best?.signalType} (tier ${best?.tier}, contribution ${base.toFixed(3)})`,
    );
    if (volumeBonus > 0) {
      reasons.push(
        `+${volumeBonus.toFixed(3)} activity-volume bonus (${obsSorted.length - 1} extra observable)`,
      );
    }
    if (derivedBonus > 0) {
      const types = [...new Set(derivedInWindow.map((c) => c.signalType))].sort();
      reasons.push(
        `+${derivedBonus.toFixed(3)} derived boost (${types.join(", ")}) — boost-only, gated on an observable`,
      );
    }
  }

  const crosses = strength >= threshold;
  const decision: TrigifyRankingDecision = crosses && hasObservable ? "strong" : "monitor_only";

  if (decision === "strong") {
    reasons.push(`strength ${strength.toFixed(3)} >= threshold ${threshold.toFixed(3)} -> STRONG`);
  } else if (hasObservable && !crosses) {
    reasons.push(
      `strength ${strength.toFixed(3)} < threshold ${threshold.toFixed(3)} -> monitor-only`,
    );
  }

  return {
    targetId,
    strength,
    threshold,
    crossesThreshold: crosses,
    hasObservable,
    decision,
    bestSignal: best,
    components,
    rankingVersion: config.rankingVersion,
    reasons,
  };
}

/**
 * Map a signal-ranking contribution/strength (typically 0..~1.2 after
 * bonuses) into a 0..1 `Evidence.confidence` value the assembler's
 * dominant-signal pick and trust gates can consume directly.
 *
 * Values above 1 are clamped to 1 (a signal at or above the strongest
 * possible unboosted contribution is treated as maximally confident); values
 * at or below 0 clamp to 0.
 */
export function confidenceFromContribution(strength: number): number {
  if (!Number.isFinite(strength)) return 0;
  return Math.max(0, Math.min(1, strength));
}
