/**
 * Real-database wiring for `pollAllTenants` (Stage A Task 16 — Bug 2 fix).
 *
 * This is what `app.ts` mounts `/admin/trigify-poll` against. Before this
 * module existed, `createTrigifyPollHandler` had no real `poll` function to
 * call in production — the route was never registered in `app.ts` at all,
 * so hitting it live 404'd regardless. `createDbPollAllTenantsDeps` assembles
 * every dependency `pollAllTenants`/`pollTenant` need from real building
 * blocks already owned by this module (`company-match.ts`,
 * `trigify-client.ts`, `config-resolver.ts`) — no new subsystem, just wiring.
 *
 * Tenant isolation: `listEnabledTenants` only returns tenants with an
 * enabled `provider_config` row for `providerName = "trigify"`; every
 * downstream query in `buildTenantDeps` is scoped to that one `tenantId`.
 * Combined with RLS on `signals` / `company_signal_map` (migration
 * `0011_trigify_signals.sql`), a cross-tenant read/write is impossible at
 * both the query and database layers.
 *
 * Credit-spend posture: `buildTenantDeps` constructs a `TrigifyClient` and
 * only ever calls `getSocialSignalsFeed` (via `pollTenant`'s
 * `TrigifyFeedClient` interface) — the confirm-gated `createSubscription`
 * is never reachable from this module.
 */

import { and, type Database, eq, providerConfig, signals } from "@hap/db";
import { TrigifyClient } from "../../adapters/signal/trigify-client.js";
import { type ConfigResolverDeps, getProviderConfig } from "../../lib/config-resolver.js";
import { matchCompany } from "./company-match.js";
import { createDbCompanyMatchDepsForTenant } from "./poll-company-match-deps.js";
import type { PollAllTenantsDeps, PollTenantDeps, SignalUpsertRow } from "./poller.js";

export interface CreateDbPollAllTenantsDepsOptions {
  /** Override global `fetch` (tests only). Propagated to TrigifyClient + HubSpotClient. */
  fetch?: typeof fetch;
}

/**
 * List every tenant with an ENABLED `provider_config` row for
 * `providerName = "trigify"`. Disabled rows and tenants with no trigify row
 * at all are excluded.
 */
async function listEnabledTrigifyTenants(db: Database): Promise<string[]> {
  const rows = await db
    .select({ tenantId: providerConfig.tenantId })
    .from(providerConfig)
    .where(and(eq(providerConfig.providerName, "trigify"), eq(providerConfig.enabled, true)));
  return rows.map((r) => r.tenantId);
}

/**
 * Upsert one signal row, idempotent on `(tenantId, dedupeKey)` — the unique
 * constraint `signals_tenant_dedupe_key_unique`
 * (`packages/db/src/schema/signals.ts`). Replaying the same feed item always
 * produces the same `dedupeKey`, so a re-poll collapses onto the existing
 * row rather than duplicating it.
 */
function createDbUpsertSignal(db: Database) {
  return async (tenantId: string, row: SignalUpsertRow): Promise<void> => {
    await db
      .insert(signals)
      .values({
        tenantId,
        dedupeKey: row.dedupeKey,
        source: row.source,
        stream: row.stream,
        signalType: row.signalType,
        signalClass: row.signalClass,
        tier: row.tier ?? "C",
        level: row.level,
        targetId: row.targetId,
        linkedinUrl: row.linkedinUrl,
        hsContactId: row.hsContactId,
        hsCompanyId: row.hsCompanyId,
        evidenceUrl: row.evidenceUrl,
        evidenceDate: row.evidenceDate ? new Date(row.evidenceDate) : null,
        observedAt: row.observedAt ? new Date(row.observedAt) : new Date(),
        allowedClaims: row.allowedClaims,
        copyAssertable: row.copyAssertable,
        headline: row.headline,
        detail: row.detail,
        confidence: row.confidence,
        raw: row.raw,
      })
      .onConflictDoUpdate({
        target: [signals.tenantId, signals.dedupeKey],
        set: {
          signalType: row.signalType,
          signalClass: row.signalClass,
          tier: row.tier ?? "C",
          level: row.level,
          targetId: row.targetId,
          linkedinUrl: row.linkedinUrl,
          hsContactId: row.hsContactId,
          hsCompanyId: row.hsCompanyId,
          evidenceUrl: row.evidenceUrl,
          evidenceDate: row.evidenceDate ? new Date(row.evidenceDate) : null,
          observedAt: row.observedAt ? new Date(row.observedAt) : new Date(),
          allowedClaims: row.allowedClaims,
          copyAssertable: row.copyAssertable,
          headline: row.headline,
          detail: row.detail,
          confidence: row.confidence,
          raw: row.raw,
        },
      });
  };
}

/**
 * Build the full `PollAllTenantsDeps` real-database wiring.
 */
export function createDbPollAllTenantsDeps(
  db: Database,
  options: CreateDbPollAllTenantsDepsOptions = {},
): PollAllTenantsDeps {
  const fetchImpl = options.fetch;
  const configDeps: ConfigResolverDeps = { db };
  const upsertSignal = createDbUpsertSignal(db);

  return {
    listEnabledTenants: () => listEnabledTrigifyTenants(db),
    buildTenantDeps: async (tenantId: string): Promise<PollTenantDeps> => {
      const cfg = await getProviderConfig(configDeps, { tenantId, providerName: "trigify" });
      if (!cfg?.enabled || !cfg.apiKeyRef) {
        throw new Error(
          `createDbPollAllTenantsDeps: tenant ${tenantId} has no enabled trigify provider_config row with a stored API key`,
        );
      }
      const client = new TrigifyClient({ apiKey: cfg.apiKeyRef, fetch: fetchImpl });
      const matchCompanyDeps = createDbCompanyMatchDepsForTenant(db, tenantId, {
        fetch: fetchImpl,
      });
      return {
        client,
        matchCompany: (tid, input) => matchCompany(matchCompanyDeps, tid, input),
        upsertSignal,
      };
    },
  };
}
