/**
 * Request body schemas for the Trigify monitor-management routes
 * (`POST /api/settings/trigify/monitors` and `.../monitors/plan`,
 * Stage A Task 9). Kept in `@hap/validators` (not `apps/api`) because
 * `apps/api` does not depend on `zod` directly — every route validates
 * request bodies via schemas exported from here, matching the existing
 * `settings.ts` / `snapshot.ts` convention in this package.
 */

import { z } from "zod";

export const trigifyMonitorSubscribeBodySchema = z.object({
  monitorType: z.string().min(1),
  targetUrl: z.string().url(),
  cadence: z.enum(["daily", "weekly"]).optional(),
  lookbackWindowMs: z.number().positive().optional(),
  confirm: z.boolean().optional(),
});

export const trigifyMonitorPlanBodySchema = trigifyMonitorSubscribeBodySchema.omit({
  confirm: true,
});

export type TrigifyMonitorSubscribeBody = z.infer<typeof trigifyMonitorSubscribeBodySchema>;
export type TrigifyMonitorPlanBody = z.infer<typeof trigifyMonitorPlanBodySchema>;
