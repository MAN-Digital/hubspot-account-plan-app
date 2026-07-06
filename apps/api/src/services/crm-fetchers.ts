/**
 * Real HubSpot-backed fetchers for the snapshot pipeline (Stage A Task 8).
 *
 * `routes/snapshot.ts` historically injected fixture fetchers
 * (`fixtureContactFetcher`, `eligiblePropertyFetcher`, ...) so the state
 * machine could be exercised end-to-end before real CRM data was wired in.
 * These factories replace that fixture path in production: they build a
 * per-tenant {@link HubSpotClient} and expose the
 * {@link CompanyPropertyFetcher} / {@link ContactFetcher} contracts that
 * `services/eligibility.ts` and `services/people-selector.ts` already define.
 *
 * Neither fetcher swallows transport errors here — `checkEligibility` and
 * `fetchContacts` already collapse thrown errors to `unconfigured` / `[]`
 * respectively (fail-safe, never bluff). Re-swallowing here would just hide
 * the error class from those call sites' logging.
 */

import type { Database } from "@hap/db";
import { HubSpotClient } from "../lib/hubspot-client.js";
import type { CompanyPropertyFetcher } from "./eligibility.js";
import type { ContactFetcher, RawContact } from "./people-selector.js";

/** Injectable HubSpotClient constructor — overridable in tests. */
export type HubSpotClientFactory = (args: { tenantId: string; db: Database }) => HubSpotClient;

const defaultClientFactory: HubSpotClientFactory = ({ tenantId, db }) =>
  new HubSpotClient({ tenantId, db });

export type CrmFetcherDeps = {
  db: Database;
  /** Override client construction in tests; defaults to `new HubSpotClient(...)`. */
  clientFactory?: HubSpotClientFactory;
};

/**
 * Build a {@link CompanyPropertyFetcher} that reads a single company property
 * (e.g. `hs_is_target_account`) from the real HubSpot CRM via a per-tenant
 * {@link HubSpotClient}. The property name is NOT hardcoded here — the caller
 * (`checkEligibility`) resolves it per-tenant from `provider_config.settings`
 * and passes it through on every call.
 */
export function createHubSpotCompanyPropertyFetcher(deps: CrmFetcherDeps): CompanyPropertyFetcher {
  const clientFactory = deps.clientFactory ?? defaultClientFactory;
  return async (tenantId, companyId, propertyName) => {
    const client = clientFactory({ tenantId, db: deps.db });
    const properties = await client.getCompanyProperties(companyId, [propertyName]);
    return properties[propertyName];
  };
}

/**
 * Build a {@link ContactFetcher} that reads real company-associated contacts
 * via a per-tenant {@link HubSpotClient}. Maps
 * {@link HubSpotClient.getAssociatedContacts} rows 1:1 onto {@link RawContact}
 * — the shapes already match by design (Stage A Task 8). Returns whatever the
 * client returns, including `[]`; never fabricates filler contacts.
 */
export function createHubSpotContactFetcher(deps: CrmFetcherDeps): ContactFetcher {
  const clientFactory = deps.clientFactory ?? defaultClientFactory;
  return async (tenantId, companyId): Promise<RawContact[]> => {
    const client = clientFactory({ tenantId, db: deps.db });
    return client.getAssociatedContacts(companyId);
  };
}
