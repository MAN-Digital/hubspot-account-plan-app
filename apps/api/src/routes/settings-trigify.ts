/**
 * `/api/settings/trigify` — Trigify monitor management + connection test
 * (Stage A Task 9).
 *
 * Route table:
 *   GET    /                       — connection test (FREE getUsage) + this
 *                                    tenant's monitor list. Never 500s on a
 *                                    missing/bad key — degrades to
 *                                    `connected: false`.
 *   POST   /monitors/plan          — dry-run preview. NEVER spends credits,
 *                                    NEVER calls createSubscription.
 *   POST   /monitors               — subscribe. Spends credits ONLY when the
 *                                    body sets `confirm: true` AND the
 *                                    tenant's budget/duplicate checks pass
 *                                    (see `services/trigify/monitor-manager.ts`).
 *   POST   /monitors/:id/pause     — local state transition to "paused".
 *   POST   /monitors/:id/delete    — local state transition to "deleted".
 *
 * All routes read `tenantId`/`db` from Hono context (set by the upstream
 * tenant middleware chain in `app.ts`) — never from the request body. Every
 * monitor lookup is tenant-scoped; a monitor id belonging to another tenant
 * behaves as "not found" (404), never a cross-tenant leak or a silent
 * cross-tenant mutation.
 */

import { TRIGIFY_MONITORING_TYPES } from "@hap/config";
import type { Database } from "@hap/db";
import {
  trigifyMonitorConfigSchema,
  trigifyMonitorPlanBodySchema,
  trigifyMonitorSubscribeBodySchema,
} from "@hap/validators";
import { Hono } from "hono";
import { TRIGIFY_PROVIDER_NAME } from "../adapters/signal/trigify.js";
import { TrigifyClient } from "../adapters/signal/trigify-client.js";
import { type CacheAdapter, InMemoryCacheAdapter } from "../lib/cache-adapter.js";
import { getProviderConfig } from "../lib/config-resolver.js";
import { createDrizzleMonitorStore } from "../services/trigify/drizzle-monitor-store.js";
import {
  type CreditBudget,
  DuplicateMonitorError,
  deleteMonitor as deleteMonitorAction,
  pauseMonitor as pauseMonitorAction,
  planSubscribe,
  subscribe,
} from "../services/trigify/monitor-manager.js";
import { resolvePlanLimits } from "../services/trigify/plan-limits.js";

type Vars = { tenantId?: string; db?: Database };

const subscribeBodySchema = trigifyMonitorSubscribeBodySchema;
const planBodySchema = trigifyMonitorPlanBodySchema;

/** Module-level plan-limits cache — shared across requests, like config-resolver's cache. */
let planLimitsCache: CacheAdapter = new InMemoryCacheAdapter();

/** Test-only hook to reset the shared plan-limits cache between test files. */
export function __resetSettingsTrigifyCacheForTests(): void {
  planLimitsCache = new InMemoryCacheAdapter();
}

export type SettingsTrigifyRouteDeps = {
  /** Override TrigifyClient construction (tests inject a fake client). */
  clientFactory?: (args: { apiKey: string }) => TrigifyClient;
};

function defaultClientFactory(args: { apiKey: string }): TrigifyClient {
  return new TrigifyClient({ apiKey: args.apiKey });
}

/**
 * Resolve the tenant's credit budget from the trigify provider row's
 * `settings` JSONB. `getProviderConfig` (config-resolver.ts, fixed in
 * Task 15) now selects and parses the `settings` column itself — no
 * separate DB read needed here.
 */
function resolveBudget(settings: Record<string, unknown> | undefined): CreditBudget {
  const parsed = trigifyMonitorConfigSchema.safeParse(settings ?? {});
  if (!parsed.success) return {};
  return parsed.data.creditBudget;
}

function isValidMonitorType(v: string): boolean {
  return (TRIGIFY_MONITORING_TYPES as readonly string[]).includes(v);
}

/**
 * Build the Hono sub-app for `/api/settings/trigify`. Callers mount it under
 * the parent settings app (or directly in `app.ts`) so it inherits the same
 * auth + tenant middleware chain as every other `/api/*` route.
 */
export function createSettingsTrigifyRoute(
  deps: SettingsTrigifyRouteDeps = {},
): Hono<{ Variables: Vars }> {
  const router = new Hono<{ Variables: Vars }>();
  const clientFactory = deps.clientFactory ?? defaultClientFactory;

  async function resolveTrigifyContext(c: {
    get: (key: "tenantId" | "db") => string | Database | undefined;
  }) {
    const tenantId = c.get("tenantId") as string | undefined;
    const db = c.get("db") as Database | undefined;
    if (!tenantId || !db) return { error: "tenant_context_missing" as const };

    const providerRow = await getProviderConfig(
      { db },
      { tenantId, providerName: TRIGIFY_PROVIDER_NAME },
    );
    if (!providerRow?.apiKeyRef) {
      return { error: "trigify_not_configured" as const };
    }

    const client = clientFactory({ apiKey: providerRow.apiKeyRef });
    const store = createDrizzleMonitorStore(db);
    const budget = resolveBudget(providerRow.settings);
    const planLimits = await resolvePlanLimits({
      client,
      tenantId,
      cache: planLimitsCache,
    });
    return { tenantId, client, store, budget, planLimits };
  }

  router.get("/", async (c) => {
    const tenantId = c.get("tenantId");
    const db = c.get("db");
    if (!tenantId || !db) {
      return c.json({ error: "tenant_context_missing" }, 500);
    }

    const providerRow = await getProviderConfig(
      { db },
      { tenantId, providerName: TRIGIFY_PROVIDER_NAME },
    );
    if (!providerRow?.apiKeyRef) {
      return c.json({ connected: false, usage: null, monitors: [] }, 200);
    }

    const client = clientFactory({ apiKey: providerRow.apiKeyRef });
    const store = createDrizzleMonitorStore(db);
    const monitors = await store.listByTenant(tenantId);

    try {
      const usage = await client.getUsage();
      return c.json({ connected: true, usage, monitors }, 200);
    } catch (err) {
      console.warn("settings_trigify.connection_test_failed", {
        tenantId,
        errorClass: err instanceof Error ? err.constructor.name : typeof err,
      });
      return c.json({ connected: false, usage: null, monitors }, 200);
    }
  });

  router.post("/monitors/plan", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = planBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }

    const ctx = await resolveTrigifyContext(c);
    if ("error" in ctx) {
      return c.json({ error: ctx.error }, 400);
    }

    const plan = await planSubscribe(
      {
        client: ctx.client,
        store: ctx.store,
        tenantId: ctx.tenantId,
        planLimits: ctx.planLimits,
      },
      parsed.data,
    );
    return c.json(plan, 200);
  });

  router.post("/monitors", async (c) => {
    let raw: unknown;
    try {
      raw = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = subscribeBodySchema.safeParse(raw);
    if (!parsed.success) {
      return c.json({ error: "invalid_body", issues: parsed.error.issues }, 400);
    }
    if (!isValidMonitorType(parsed.data.monitorType)) {
      return c.json({ error: "invalid_monitor_type" }, 400);
    }

    const ctx = await resolveTrigifyContext(c);
    if ("error" in ctx) {
      return c.json({ error: ctx.error }, 400);
    }

    try {
      const result = await subscribe(
        {
          client: ctx.client,
          store: ctx.store,
          tenantId: ctx.tenantId,
          budget: ctx.budget,
          planLimits: ctx.planLimits,
        },
        parsed.data,
      );
      return c.json(result, 200);
    } catch (err) {
      if (err instanceof DuplicateMonitorError) {
        return c.json({ created: false, spend: 0, reason: err.message, monitor: null }, 200);
      }
      throw err;
    }
  });

  router.post("/monitors/:id/pause", async (c) => {
    const tenantId = c.get("tenantId");
    const db = c.get("db");
    if (!tenantId || !db) {
      return c.json({ error: "tenant_context_missing" }, 500);
    }
    const monitorId = c.req.param("id");
    const store = createDrizzleMonitorStore(db);
    try {
      const monitor = await pauseMonitorAction({ store, tenantId }, { monitorId });
      return c.json(monitor, 200);
    } catch {
      // updateStatus throws when no row matches (wrong id OR wrong tenant) —
      // both cases behave as "not found", never a cross-tenant leak/mutation.
      return c.json({ error: "not_found" }, 404);
    }
  });

  router.post("/monitors/:id/delete", async (c) => {
    const tenantId = c.get("tenantId");
    const db = c.get("db");
    if (!tenantId || !db) {
      return c.json({ error: "tenant_context_missing" }, 500);
    }
    const monitorId = c.req.param("id");
    const store = createDrizzleMonitorStore(db);
    try {
      const monitor = await deleteMonitorAction({ store, tenantId }, { monitorId });
      return c.json(monitor, 200);
    } catch {
      return c.json({ error: "not_found" }, 404);
    }
  });

  return router;
}
