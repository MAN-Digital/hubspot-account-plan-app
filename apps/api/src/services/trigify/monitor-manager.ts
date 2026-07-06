/**
 * Trigify monitor-management spend gate (Stage A Task 9).
 *
 * Ports the discipline of `trigify_monitors.py` (OrbStack VM,
 * `.../outreach-engine/trigify_monitors.py`), scoped to the ONE credit-spend
 * path this app has: creating a Social-Signals subscription
 * (`TrigifyClient.createSubscription`). There is no Listening-stream dual
 * path here — `TRIGIFY_MONITORING_TYPES` covers every creatable monitor
 * source and `trigifyMonitors` is a single ledger table for all of them.
 *
 * Non-negotiable invariants (mirrored from the source):
 *  - The default path is a DRY-RUN preview ({@link planSubscribe}). No
 *    network call, no DB write, zero spend.
 *  - {@link subscribe} spends credits ONLY when the caller passes
 *    `confirm: true` — no exceptions, no implicit confirmation.
 *  - FAIL-CLOSED credit budget (mirrors `trigify_monitors.budget_check`):
 *    when NEITHER `budget.daily` NOR `budget.monthly` is configured, spend is
 *    REFUSED. An unset budget must never mean unbounded spend.
 *  - Duplicate monitors (same tenant + monitorType + targetUrl) are refused
 *    before any client call. The DB also enforces this via the
 *    `trigify_monitors_tenant_type_target_unique` constraint (belt-and-braces
 *    against a preview/confirm race) — a resulting Postgres unique-violation
 *    is translated to {@link DuplicateMonitorError}, never surfaced as a raw
 *    driver error.
 *  - Every confirmed spend is audit-logged via a structured `console.info`
 *    line (`trigify_monitor.spend_confirmed`) — this codebase has no
 *    dedicated audit-log table yet, so structured logging is the existing
 *    convention (mirrors `snapshot_route_error`,
 *    `signal_adapter_construction_failed`, etc. elsewhere in this app).
 *  - `pauseMonitor` / `deleteMonitor` are LOCAL state-machine transitions
 *    only — `TrigifyClient` (Task 3) has no subscription pause/update/delete
 *    endpoint, so there is no remote call to make here. The poller (Task 6)
 *    is responsible for no longer polling a paused/deleted monitor's targets.
 */

import { TRIGIFY_MONITORING_TYPES, type TrigifyMonitoringType } from "@hap/config";
import type { NewTrigifyMonitor, TrigifyMonitor } from "@hap/db";
import type {
  TrigifyClient,
  TrigifyCreateSubscriptionPayload,
} from "../../adapters/signal/trigify-client.js";
import {
  clampToPlanLimit,
  DEFAULT_MAX_LOOKBACK_MS,
  type ResolvedPlanLimits,
} from "./plan-limits.js";

/** Monitor status values — app-owned state machine (not a DB CHECK constraint). */
export type TrigifyMonitorStatus = "pending" | "active" | "paused" | "deleted";

/** Thrown when a DB-level unique-constraint violation indicates a duplicate monitor. */
export class DuplicateMonitorError extends Error {
  constructor(monitorType: string, targetUrl: string) {
    super(`a monitor for ${monitorType} / ${targetUrl} already exists for this tenant`);
    this.name = "DuplicateMonitorError";
  }
}

/**
 * Storage seam — the caller wires this to real Drizzle queries against
 * `trigifyMonitors`. Kept as an injectable interface (mirrors
 * `ContactFetcher`/`CompanyPropertyFetcher` elsewhere) so this module's spend
 * logic is unit-testable without a live Postgres connection.
 */
export interface MonitorStore {
  findByTenantAndTarget(
    tenantId: string,
    monitorType: string,
    targetUrl: string,
  ): Promise<TrigifyMonitor | null>;
  insert(row: NewTrigifyMonitor): Promise<TrigifyMonitor>;
  /** Count CONFIRMED (spend-recorded) monitor creates for a tenant since `since`. */
  countConfirmedSince(tenantId: string, since: Date): Promise<number>;
  updateStatus(
    tenantId: string,
    monitorId: string,
    status: TrigifyMonitorStatus,
    at: Date,
  ): Promise<TrigifyMonitor>;
  listByTenant(tenantId: string): Promise<TrigifyMonitor[]>;
}

export type CreditBudget = {
  /** Max confirmed spends per UTC day. Omitted = no daily cap. */
  daily?: number;
  /** Max confirmed spends per calendar month. Omitted = no monthly cap. */
  monthly?: number;
};

export type MonitorManagerDeps = {
  client: TrigifyClient;
  store: MonitorStore;
  tenantId: string;
  /** Clock override for deterministic tests. */
  now?: () => Date;
  /** Per-tenant credit budget (resolved from `provider_config.settings` by the caller). */
  budget?: CreditBudget;
  /**
   * Pre-resolved plan limits (see `plan-limits.ts`'s `resolvePlanLimits`).
   * When provided, every lookback window is clamped to
   * `planLimits.maxLookbackWindowMs` instead of the hardcoded 30-day
   * default — config-driven from the tenant's live Trigify plan, never
   * hardcoded. Callers resolve this once per request/settings-render and
   * pass it in; this module does not fetch it itself so unit tests never
   * need a `TrigifyClient.getLimits` stub unless they're testing clamping.
   */
  planLimits?: ResolvedPlanLimits;
};

export type SubscribeArgs = {
  monitorType: string;
  targetUrl: string;
  cadence?: "daily" | "weekly";
  lookbackWindowMs?: number;
  confirm?: boolean;
};

export type MonitorSummary = { id: string; status: TrigifyMonitorStatus };

export type SubscribePlan = {
  monitorType: string;
  targetUrl: string;
  validMonitorType: boolean;
  cadence: "daily" | "weekly";
  lookbackWindowMs: number;
  /** The tenant's Trigify plan tier, when known — so the UI can display the active window. */
  activeLookbackPlan?: string;
  duplicate: MonitorSummary | null;
  payload: TrigifyCreateSubscriptionPayload;
  projectedSpend: 0 | 1;
  notes: string;
};

export type BudgetCheckResult = {
  ok: boolean;
  reason: string;
  spentDaily: number;
  spentMonthly: number;
  dailyBudget?: number;
  monthlyBudget?: number;
};

export type SubscribeResult = {
  created: boolean;
  spend: 0 | 1;
  reason: string;
  monitor: TrigifyMonitor | null;
  plan: SubscribePlan;
  budget?: BudgetCheckResult;
};

function isValidMonitorType(v: string): v is TrigifyMonitoringType {
  return (TRIGIFY_MONITORING_TYPES as readonly string[]).includes(v);
}

/**
 * Clamp a requested lookback window to the tenant's plan limit. When
 * `planLimits` is not provided (caller didn't resolve it, or resolution
 * failed upstream), falls back to {@link DEFAULT_MAX_LOOKBACK_MS} — the same
 * conservative ceiling `plan-limits.ts` uses on a degraded fetch, so
 * behavior is consistent whether the caller passes a degraded result or
 * omits `planLimits` entirely.
 */
function clampLookback(ms: number | undefined, planLimits: ResolvedPlanLimits | undefined): number {
  const requested = ms ?? DEFAULT_MAX_LOOKBACK_MS;
  const maxMs = planLimits?.maxLookbackWindowMs ?? DEFAULT_MAX_LOOKBACK_MS;
  return clampToPlanLimit(requested, maxMs);
}

function buildPayload(args: {
  targetUrl: string;
  cadence: "daily" | "weekly";
  lookbackWindowMs: number;
}): TrigifyCreateSubscriptionPayload {
  return {
    subscriptions: [
      {
        linkedin_url: args.targetUrl,
        config: {
          version: 1,
          cadence: args.cadence,
          lookbackWindowMs: args.lookbackWindowMs,
        },
      },
    ],
  };
}

/**
 * DRY-RUN preview of a subscribe request: what would be created, its
 * projected spend, and whether it's a duplicate — with ZERO network calls
 * and ZERO DB writes. This is the default/safe entry point; UI "preview"
 * actions should call this, never {@link subscribe} without an explicit
 * user confirmation step in between.
 */
export async function planSubscribe(
  deps: Pick<MonitorManagerDeps, "client" | "store" | "tenantId" | "now" | "planLimits">,
  args: Omit<SubscribeArgs, "confirm">,
): Promise<SubscribePlan> {
  const cadence = args.cadence ?? "daily";
  const lookbackWindowMs = clampLookback(args.lookbackWindowMs, deps.planLimits);
  const validMonitorType = isValidMonitorType(args.monitorType);

  const existing = validMonitorType
    ? await deps.store.findByTenantAndTarget(deps.tenantId, args.monitorType, args.targetUrl)
    : null;
  const duplicate: MonitorSummary | null =
    existing && existing.status !== "deleted"
      ? { id: existing.id, status: existing.status as TrigifyMonitorStatus }
      : null;

  const payload = buildPayload({
    targetUrl: args.targetUrl,
    cadence,
    lookbackWindowMs,
  });

  const notes: string[] = [];
  if (!validMonitorType) {
    notes.push(`unknown monitorType ${JSON.stringify(args.monitorType)}`);
  }
  if (duplicate) {
    notes.push(`duplicate of monitor ${duplicate.id} (status=${duplicate.status})`);
  }

  const projectedSpend: 0 | 1 = validMonitorType && !duplicate ? 1 : 0;

  return {
    monitorType: args.monitorType,
    targetUrl: args.targetUrl,
    validMonitorType,
    cadence,
    lookbackWindowMs,
    ...(deps.planLimits?.plan ? { activeLookbackPlan: deps.planLimits.plan } : {}),
    duplicate,
    payload,
    projectedSpend,
    notes: notes.length > 0 ? notes.join("; ") : "ready to create",
  };
}

/**
 * Detect a Postgres unique-constraint violation on
 * `trigify_monitors_tenant_type_target_unique` (a race between a preview and
 * a confirm, or two concurrent confirms). Node-postgres / postgres.js surface
 * this as an error with `code === "23505"`.
 */
/**
 * Read the `{code, constraint_name}` pair off a possible Postgres driver
 * error, checking BOTH the error itself and `error.cause` — Drizzle
 * (postgres-js driver) wraps the raw `PostgresError` in a
 * `DrizzleQueryError`, and the driver's `code`/`constraint_name` fields live
 * on `.cause`, not on the thrown error directly (verified against the real
 * driver in `drizzle-monitor-store.test.ts`). Checking the top-level error
 * too keeps this resilient to a future Drizzle version that stops wrapping,
 * or a caller that passes the raw driver error directly (e.g. a differently
 * wired `MonitorStore`).
 */
function isDuplicateConstraintViolation(err: unknown): boolean {
  const matches = (candidate: unknown): boolean => {
    if (!candidate || typeof candidate !== "object") return false;
    const e = candidate as {
      code?: unknown;
      constraint_name?: unknown;
      constraint?: unknown;
    };
    const constraintName = e.constraint_name ?? e.constraint;
    return e.code === "23505" && constraintName === "trigify_monitors_tenant_type_target_unique";
  };
  if (matches(err)) return true;
  if (err && typeof err === "object" && "cause" in err) {
    return matches((err as { cause?: unknown }).cause);
  }
  return false;
}

/**
 * FAIL-CLOSED budget check (mirrors `trigify_monitors.budget_check`). When
 * neither `daily` nor `monthly` is configured, spend is refused — an unset
 * budget never authorizes spend.
 */
async function checkBudget(
  store: MonitorStore,
  tenantId: string,
  budget: CreditBudget | undefined,
  now: Date,
): Promise<BudgetCheckResult> {
  const dayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));

  const spentDaily = await store.countConfirmedSince(tenantId, dayStart);
  const spentMonthly = await store.countConfirmedSince(tenantId, monthStart);

  const daily = budget?.daily;
  const monthly = budget?.monthly;

  if (daily === undefined && monthly === undefined) {
    return {
      ok: false,
      reason:
        "no credit budget configured for this tenant — an unset budget never authorizes spend; configure a daily or monthly credit budget first",
      spentDaily,
      spentMonthly,
    };
  }
  if (daily !== undefined && spentDaily + 1 > daily) {
    return {
      ok: false,
      reason: `daily credit budget exceeded: ${spentDaily}+1 > ${daily}`,
      spentDaily,
      spentMonthly,
      dailyBudget: daily,
      monthlyBudget: monthly,
    };
  }
  if (monthly !== undefined && spentMonthly + 1 > monthly) {
    return {
      ok: false,
      reason: `monthly credit budget exceeded: ${spentMonthly}+1 > ${monthly}`,
      spentDaily,
      spentMonthly,
      dailyBudget: daily,
      monthlyBudget: monthly,
    };
  }
  return {
    ok: true,
    reason: "",
    spentDaily,
    spentMonthly,
    dailyBudget: daily,
    monthlyBudget: monthly,
  };
}

/**
 * Subscribe to a monitor. **CREDIT SPEND** — happens ONLY when ALL of the
 * following hold:
 *   1. `args.confirm === true` (explicit, never implied)
 *   2. `args.monitorType` is a valid {@link TrigifyMonitoringType}
 *   3. no existing non-deleted monitor for this tenant+type+targetUrl
 *   4. the per-tenant credit budget check passes (fail-closed if unconfigured)
 *
 * Otherwise returns `{ created: false, spend: 0, reason }` — a preview-style
 * result, ZERO spend, ZERO network call, ZERO DB write. NEVER a silent spend.
 */
export async function subscribe(
  deps: MonitorManagerDeps,
  args: SubscribeArgs,
): Promise<SubscribeResult> {
  const now = (deps.now ?? (() => new Date()))();
  const plan = await planSubscribe(deps, args);

  const base = {
    plan,
    reason: "",
    created: false as const,
    spend: 0 as const,
    monitor: null,
  };

  if (!plan.validMonitorType) {
    return {
      ...base,
      reason: `unknown monitorType ${JSON.stringify(args.monitorType)}`,
    };
  }
  if (plan.duplicate) {
    return {
      ...base,
      reason: `duplicate of an existing monitor (id=${plan.duplicate.id}, status=${plan.duplicate.status})`,
    };
  }
  if (args.confirm !== true) {
    return {
      ...base,
      reason: "dry-run: pass confirm=true to spend credits and create the monitor",
    };
  }

  const budget = await checkBudget(deps.store, deps.tenantId, deps.budget, now);
  if (!budget.ok) {
    return { ...base, reason: budget.reason, budget };
  }

  // Credit spend — the only network call in this module.
  await deps.client.createSubscription(plan.payload, { confirm: true });

  let monitor: TrigifyMonitor;
  try {
    monitor = await deps.store.insert({
      tenantId: deps.tenantId,
      monitorType: args.monitorType,
      targetUrl: args.targetUrl,
      status: "active",
      creditsSpent: 1,
      config: {
        cadence: plan.cadence,
        lookbackWindowMs: plan.lookbackWindowMs,
      },
      subscribedAt: now,
    });
  } catch (err) {
    if (isDuplicateConstraintViolation(err)) {
      throw new DuplicateMonitorError(args.monitorType, args.targetUrl);
    }
    throw err;
  }

  // Audit log: every confirmed spend, always. Never the API key — this
  // module never has it in scope (TrigifyClient holds it privately).
  console.info("trigify_monitor.spend_confirmed", {
    tenantId: deps.tenantId,
    monitorId: monitor.id,
    monitorType: args.monitorType,
    creditsSpent: 1,
  });

  return {
    created: true,
    spend: 1,
    reason: `created ${args.monitorType} monitor over ${args.targetUrl}`,
    monitor,
    plan,
    budget,
  };
}

export type MonitorLifecycleArgs = { monitorId: string };

/** Pause a monitor — local state transition only (no remote Trigify call available). */
export async function pauseMonitor(
  deps: Pick<MonitorManagerDeps, "store" | "tenantId" | "now">,
  args: MonitorLifecycleArgs,
): Promise<TrigifyMonitor> {
  const now = (deps.now ?? (() => new Date()))();
  return deps.store.updateStatus(deps.tenantId, args.monitorId, "paused", now);
}

/** Delete (soft-delete) a monitor — local state transition only. */
export async function deleteMonitor(
  deps: Pick<MonitorManagerDeps, "store" | "tenantId" | "now">,
  args: MonitorLifecycleArgs,
): Promise<TrigifyMonitor> {
  const now = (deps.now ?? (() => new Date()))();
  return deps.store.updateStatus(deps.tenantId, args.monitorId, "deleted", now);
}

/** List all monitors for a tenant (settings UI list view). */
export async function listMonitors(
  deps: Pick<MonitorManagerDeps, "store" | "tenantId">,
): Promise<TrigifyMonitor[]> {
  return deps.store.listByTenant(deps.tenantId);
}
