/**
 * Frontend wire types for the Trigify monitor-management settings surface
 * (Stage A Task 10), mirroring the `/api/settings/trigify` route contract in
 * `apps/api/src/routes/settings-trigify.ts` + the monitor-manager service.
 *
 * These are DECLARED here (not imported from `@hap/db`/`@hap/api`) because the
 * extension only depends on `@hap/config` + `@hap/validators` — it never pulls
 * in the server packages. Dates cross the wire as ISO strings (JSON has no Date
 * type), so `TrigifyMonitor` here uses `string` timestamps, unlike the DB row.
 *
 * The UI consumes these verbatim: it never invents monitor status, spend, or
 * budget semantics — every such value comes from the backend.
 */

/** A monitor row as serialized by the settings-trigify routes (dates as ISO strings). */
export type TrigifyMonitor = {
  id: string;
  tenantId: string;
  monitorType: string;
  targetUrl: string;
  status: "pending" | "active" | "paused" | "deleted";
  creditsSpent: number;
  config: Record<string, unknown> | null;
  subscribedAt?: string | null;
  pausedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
};

/** Free `getUsage()` response surfaced in the connection panel. */
export type TrigifyUsage = {
  credits_used?: number;
  credits_remaining?: number;
  monitor_count?: number;
};

/** `GET /api/settings/trigify` — connection + monitor list. Never 500s on a bad key. */
export type TrigifyConnectionResponse = {
  connected: boolean;
  usage: TrigifyUsage | null;
  monitors: TrigifyMonitor[];
};

/** Dry-run plan for a subscribe request (`POST .../monitors/plan`). Zero spend. */
export type SubscribePlan = {
  monitorType: string;
  targetUrl: string;
  validMonitorType: boolean;
  cadence: "daily" | "weekly";
  lookbackWindowMs: number;
  /** The tenant's live Trigify plan tier, when known (for displaying the active window). */
  activeLookbackPlan?: string;
  duplicate: { id: string; status: TrigifyMonitor["status"] } | null;
  payload: unknown;
  projectedSpend: 0 | 1;
  notes: string;
};

/** Budget-check detail returned by a fail-closed create refusal. */
export type BudgetCheckResult = {
  ok: boolean;
  reason: string;
  spentDaily: number;
  spentMonthly: number;
  dailyBudget?: number;
  monthlyBudget?: number;
};

/** `POST .../monitors` result (create). `created:false` when not confirmed or refused. */
export type SubscribeResult = {
  created: boolean;
  spend: 0 | 1;
  reason: string;
  monitor: TrigifyMonitor | null;
  plan: SubscribePlan;
  budget?: BudgetCheckResult;
};

/** Body for both the plan (dry-run) and subscribe (confirm) requests. */
export type SubscribeRequestBody = {
  monitorType: string;
  targetUrl: string;
  cadence?: "daily" | "weekly";
  lookbackWindowMs?: number;
  /** ONLY set true after an explicit user confirmation — this is the credit-spend gate. */
  confirm?: boolean;
};
