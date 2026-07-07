/**
 * Zod schema for the Trigify monitor-management config (Stage A Task 9).
 *
 * Validates the SAME trigify `provider_config.settings` JSONB that
 * `trigifyRankingConfigSchema` (Task 4, `./trigify-ranking.ts`) also reads
 * from. This schema owns only the monitor-management sub-keys:
 *   - `creditBudget`: per-tenant spend ceiling for `monitor-manager.ts`'s
 *     dry-run/confirm gate (mirrors OpenClaw `TRIGIFY_CREDIT_BUDGET_DAILY`/
 *     `_MONTHLY` env vars, made per-tenant + config-driven instead of a
 *     process-wide env var).
 *   - `defaultCadence`: the subscription cadence used when a subscribe
 *     request omits one. `hourly` is intentionally NOT offered — it is a
 *     premium Trigify tier feature and unavailable on the plans this app
 *     targets (mirrors OpenClaw's `_VALID_CADENCES = {"daily", "weekly"}`).
 *
 * Deliberately `.passthrough()`, NOT `.strict()`, at every object level: the
 * ranking schema's keys (`sendThreshold`, `tierWeights`, ...) live in the
 * SAME settings object. Each schema parses the same raw object independently
 * and only cares about its own keys — neither merges into the other, and
 * neither should reject the object just because the sibling's keys are
 * present.
 */

import { z } from "zod";

const CADENCES = ["daily", "weekly"] as const;
export type TrigifyMonitorCadence = (typeof CADENCES)[number];

const creditBudgetSchema = z
  .object({
    /** Max confirmed-spend monitor creates per UTC day. Omitted = no daily cap. */
    daily: z.number().min(0).optional(),
    /** Max confirmed-spend monitor creates per calendar month. Omitted = no monthly cap. */
    monthly: z.number().min(0).optional(),
  })
  .passthrough();

/**
 * Full monitor-management config shape. All fields optional at the top level
 * (Zod defaults fill gaps) so a tenant can override just `defaultCadence`
 * without specifying a budget, for example.
 */
export const trigifyMonitorConfigSchema = z
  .object({
    creditBudget: creditBudgetSchema.default({}),
    defaultCadence: z.enum(CADENCES).default("daily"),
  })
  .passthrough();

export type TrigifyMonitorConfigInput = z.input<typeof trigifyMonitorConfigSchema>;
export type TrigifyMonitorConfigParsed = z.output<typeof trigifyMonitorConfigSchema>;

/** The fully-defaulted config, for callers that just want the zero-config shape. */
export const trigifyMonitorConfigDefaults: TrigifyMonitorConfigParsed =
  trigifyMonitorConfigSchema.parse({});
