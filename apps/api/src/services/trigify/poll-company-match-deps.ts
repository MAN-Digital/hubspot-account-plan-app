/**
 * Real-database `CompanyMatchDeps` (Stage A Task 16 — Bug 2 fix wiring).
 *
 * Backs `company-match.ts`'s `matchCompany()` with the real
 * `company_signal_map` alias table (lookup + write-back) and a real
 * per-tenant `HubSpotClient` domain search fallback. Split out of
 * `poll-deps.ts` so the DB/HubSpot wiring for company matching is
 * independently readable/testable from the tenant-listing + client wiring.
 */

import { and, companySignalMap, type Database, eq } from "@hap/db";
import { HubSpotClient } from "../../lib/hubspot-client.js";
import type {
  CompanyAliasLookupKey,
  CompanyAliasRow,
  CompanyAliasWrite,
  CompanyMatchDeps,
} from "./company-match.js";

export interface CreateDbCompanyMatchDepsOptions {
  /** Override global `fetch` (tests only). Propagated to HubSpotClient. */
  fetch?: typeof fetch;
}

/**
 * Look up an existing `company_signal_map` alias row by LinkedIn URL, else
 * by domain. Returns `null` when neither matches — `matchCompany` then
 * falls back to a HubSpot domain search rather than fabricating a match.
 */
function createLookupAlias(db: Database) {
  return async (tenantId: string, key: CompanyAliasLookupKey): Promise<CompanyAliasRow | null> => {
    if (key.linkedinUrl) {
      const rows = await db
        .select({
          hsCompanyId: companySignalMap.hsCompanyId,
          confidence: companySignalMap.confidence,
        })
        .from(companySignalMap)
        .where(
          and(
            eq(companySignalMap.tenantId, tenantId),
            eq(companySignalMap.linkedinUrl, key.linkedinUrl),
          ),
        )
        .limit(1);
      if (rows[0]) return rows[0];
    }
    if (key.domain) {
      const rows = await db
        .select({
          hsCompanyId: companySignalMap.hsCompanyId,
          confidence: companySignalMap.confidence,
        })
        .from(companySignalMap)
        .where(
          and(eq(companySignalMap.tenantId, tenantId), eq(companySignalMap.domain, key.domain)),
        )
        .limit(1);
      if (rows[0]) return rows[0];
    }
    return null;
  };
}

/** Persist a freshly-resolved alias so future polls skip the HubSpot search. */
function createWriteAlias(db: Database) {
  return async (tenantId: string, alias: CompanyAliasWrite): Promise<void> => {
    await db.insert(companySignalMap).values({
      tenantId,
      linkedinUrl: alias.linkedinUrl,
      domain: alias.domain,
      hsCompanyId: alias.hsCompanyId,
      confidence: alias.confidence,
    });
  };
}

/**
 * HubSpot company search fallback by exact domain match, scoped to one
 * tenant's OAuth-backed `HubSpotClient`.
 */
function createSearchCompanyByDomain(client: HubSpotClient) {
  return async (domain: string): Promise<{ hsCompanyId: string } | null> => {
    const results = await client.searchCompaniesByMarker("domain", domain, "EQ");
    const first = results[0];
    return first ? { hsCompanyId: first.id } : null;
  };
}

/**
 * Build a real-database `CompanyMatchDeps` scoped to ONE tenant's
 * `HubSpotClient` (constructed from `{ tenantId, db }` — the same pattern
 * `createSignalAdapter`'s `hubspot-enrichment` case uses).
 */
export function createDbCompanyMatchDepsForTenant(
  db: Database,
  tenantId: string,
  options: CreateDbCompanyMatchDepsOptions = {},
): CompanyMatchDeps {
  const client = new HubSpotClient({ tenantId, db, fetch: options.fetch });
  return {
    lookupAlias: createLookupAlias(db),
    writeAlias: createWriteAlias(db),
    searchCompanyByDomain: createSearchCompanyByDomain(client),
  };
}
