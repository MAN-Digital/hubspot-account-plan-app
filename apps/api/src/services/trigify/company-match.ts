/**
 * Trigify company matching — LinkedIn company URL/domain -> HubSpot
 * `hs_company_id` (Stage A Task 5).
 *
 * Entity-resolution-LITE (mirrors the `company_aliases` lookup pattern in
 * `signal_store.py`, ported to the app's `company_signal_map` table —
 * `packages/db/src/schema/company-signal-map.ts`, owned by db-foundation).
 *
 * Resolution order:
 *  1. `company_signal_map` lookup by LinkedIn URL, else by domain (fast path,
 *     no HubSpot API call).
 *  2. HubSpot company search fallback by domain (`HubSpotClient.
 *     searchCompaniesByMarker("domain", domain, "EQ")`), when a domain is
 *     available and no alias exists yet.
 *  3. On a fallback hit, the alias is written back with a confidence so
 *     subsequent polls skip the HubSpot search.
 *
 * NEVER FABRICATE: when neither the alias table nor the HubSpot search
 * yields a match, this returns `null`. The caller (poller, Task 6) leaves
 * `hsCompanyId` unset on the signal record rather than guessing.
 *
 * Decoupled from `HubSpotClient` and the DB layer by design: this module
 * takes injectable `CompanyMatchDeps` so it can be unit-tested without a
 * live database or HubSpot connection, and so it composes with whatever
 * `HubSpotClient` instance the poller already holds for the tenant.
 */

export interface CompanyAliasLookupKey {
  linkedinUrl?: string | null;
  domain?: string | null;
}

export interface CompanyAliasRow {
  hsCompanyId: string;
  /** 0..1 confidence carried on the existing alias row. */
  confidence: number;
}

export interface CompanyAliasWrite {
  hsCompanyId: string;
  linkedinUrl: string | null;
  domain: string | null;
  confidence: number;
}

/**
 * Confidence assigned to a fresh alias created from a HubSpot domain-search
 * hit. An exact domain match on a company record is high-confidence but not
 * 1.0 — a company can legitimately share a domain across regional
 * subsidiaries, so we leave room below a manually-verified alias.
 */
export const DOMAIN_SEARCH_MATCH_CONFIDENCE = 0.85;

export interface CompanyMatchDeps {
  /** Read an existing alias row for this tenant, by LinkedIn URL or domain. */
  lookupAlias: (tenantId: string, key: CompanyAliasLookupKey) => Promise<CompanyAliasRow | null>;
  /** HubSpot company search fallback by exact domain match. */
  searchCompanyByDomain: (domain: string) => Promise<{ hsCompanyId: string } | null>;
  /** Persist a freshly-resolved alias so future polls skip the HubSpot search. */
  writeAlias: (tenantId: string, alias: CompanyAliasWrite) => Promise<void>;
}

export interface CompanyMatchInput {
  linkedinUrl?: string | null;
  domain?: string | null;
}

export type CompanyMatchSource = "alias" | "domain-search";

export interface CompanyMatchResult {
  hsCompanyId: string;
  confidence: number;
  source: CompanyMatchSource;
}

/**
 * Resolve a signal's company identity to a HubSpot `hs_company_id`. Returns
 * `null` when unresolved — never a fabricated match.
 */
export async function matchCompany(
  deps: CompanyMatchDeps,
  tenantId: string,
  input: CompanyMatchInput,
): Promise<CompanyMatchResult | null> {
  const linkedinUrl = input.linkedinUrl?.trim() || null;
  const domain = input.domain?.trim().toLowerCase() || null;

  if (!linkedinUrl && !domain) {
    return null;
  }

  const existing = await deps.lookupAlias(tenantId, { linkedinUrl, domain });
  if (existing) {
    return {
      hsCompanyId: existing.hsCompanyId,
      confidence: existing.confidence,
      source: "alias",
    };
  }

  if (!domain) {
    return null;
  }

  const hit = await deps.searchCompanyByDomain(domain);
  if (!hit) {
    return null;
  }

  await deps.writeAlias(tenantId, {
    hsCompanyId: hit.hsCompanyId,
    linkedinUrl,
    domain,
    confidence: DOMAIN_SEARCH_MATCH_CONFIDENCE,
  });

  return {
    hsCompanyId: hit.hsCompanyId,
    confidence: DOMAIN_SEARCH_MATCH_CONFIDENCE,
    source: "domain-search",
  };
}
