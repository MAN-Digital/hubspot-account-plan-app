/**
 * Zod schema for the Trigify signal-ranking config (Stage A Task 4).
 *
 * This validates the trigify `provider_config.settings` JSONB — NOT the
 * `thresholds` column. `ThresholdConfig` is locked to
 * `{freshnessMaxDays, minConfidence}` (`packages/config/src/domain-types.ts`)
 * and `isValidThresholds` in `apps/api/src/routes/snapshot.ts` enforces that
 * shape; the ranking config (tier weights, send_threshold, reasoning
 * weights, topic map, derived set) lives in `settings` instead.
 *
 * Defaults mirror `config/trigify_signal_ranking.yaml` and
 * `apps/api/src/services/trigify/signal-ranking.ts`'s
 * `DEFAULT_TRIGIFY_RANKING_CONFIG` verbatim — the two must be kept in sync
 * (this schema owns validation + defaulting of tenant-supplied overrides;
 * the ranking service owns the scoring math and its own copy of the same
 * defaults for zero-config use).
 */

import { z } from "zod";

const signalTierSchema = z.enum(["A", "B", "C"]);

const tierWeightsSchema = z
  .object({
    A: z.number().min(0),
    B: z.number().min(0),
    C: z.number().min(0),
  })
  .strict();

const multipliersSchema = z
  .object({
    person: z.number().min(0),
    company: z.number().min(0),
  })
  .strict();

const recencySchema = z
  .object({
    halfLifeDays: z.number().positive(),
    windowDays: z.number().positive(),
    floor: z.number().min(0).max(1),
  })
  .strict();

const topicRelevanceSchema = z
  .object({
    default: z.number().min(0).max(1),
    map: z.record(z.string(), z.number().min(0).max(1)),
  })
  .strict();

/**
 * Full ranking config shape. All fields optional at the top level (Zod
 * defaults fill gaps) so a tenant can override just `sendThreshold`, for
 * example, without repeating the whole tier map.
 */
export const trigifyRankingConfigSchema = z
  .object({
    rankingVersion: z.string().min(1).default("trigify-rank-v1"),
    sendThreshold: z.number().min(0).max(1).default(0.6),
    tierWeights: tierWeightsSchema.default({ A: 1.0, B: 0.65, C: 0.3 }),
    signalTiers: z.record(z.string(), signalTierSchema).default({
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
    }),
    derivedTypes: z
      .array(z.string())
      .default(["T_Buying_Window", "T_Influence", "T_Expansion", "T_Company_Jobs_Up"]),
    topicSignalTypes: z
      .array(z.string())
      .default(["T_Topic_Post", "T_Topic_Engage", "T_Company_Initiative"]),
    multipliers: multipliersSchema.default({ person: 1.0, company: 0.7 }),
    recency: recencySchema.default({
      halfLifeDays: 14,
      windowDays: 30,
      floor: 0.15,
    }),
    topicRelevance: topicRelevanceSchema.default({
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
    }),
    volumeBonusPerExtra: z.number().min(0).default(0.05),
    volumeBonusCap: z.number().min(0).default(0.2),
    derivedBoost: z.number().min(0).default(0.15),
    derivedBoostCap: z.number().min(0).default(0.25),
  })
  .strict();

export type TrigifyRankingConfigInput = z.input<typeof trigifyRankingConfigSchema>;
export type TrigifyRankingConfigParsed = z.output<typeof trigifyRankingConfigSchema>;

/** The fully-defaulted config, for callers that just want the zero-config shape. */
export const trigifyRankingConfigDefaults: TrigifyRankingConfigParsed =
  trigifyRankingConfigSchema.parse({});
