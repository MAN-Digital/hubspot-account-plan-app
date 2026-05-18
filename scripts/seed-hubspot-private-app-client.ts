/**
 * HubSpot Private App seed client.
 *
 * Implements the `SeedHubSpotClient` interface from
 * `scripts/seed-hubspot-test-portal.ts` using a HubSpot Private App access
 * token. Unlike `apps/api/src/lib/hubspot-client.ts`, this client:
 *   - takes a static Bearer token (no OAuth, no refresh, no DB lookup)
 *   - is not tenant-coupled — the token is portal-scoped on the HubSpot side
 *
 * Used by the test-portal seed when `HUBSPOT_PRIVATE_APP_TOKEN` is set in
 * the environment. The full rationale (why a Private App rather than
 * widening marketplace OAuth scopes) lives in
 * `docs/decisions/oauth-scope-policy.md`.
 *
 * Each method's request/response shape mirrors the seed-relevant methods
 * of `HubSpotClient` exactly so the two implementations are
 * substitutable behind the `SeedHubSpotClient` interface.
 */

const HUBSPOT_API_ROOT = "https://api.hubapi.com";

export interface PrivateAppSeedClientOptions {
  /** Private App access token (`pat-...`). Required. */
  token: string;
  /**
   * Override the global `fetch` for tests. Defaults to `globalThis.fetch`,
   * which is `undici` on Node 22 and behaves like the WHATWG fetch standard.
   */
  fetchImpl?: typeof fetch;
}

interface HubSpotObjectResponse {
  id: string;
  properties: Record<string, string>;
}

/**
 * HubSpot CRM v3 requires ALL property values to be strings on the wire.
 * Mirrors `coercePropertiesToStrings` in `apps/api/src/lib/hubspot-client.ts`.
 */
function coercePropertiesToStrings(
  properties: Record<string, string | boolean | number>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(properties)) {
    out[key] = typeof value === "string" ? value : String(value);
  }
  return out;
}

export class PrivateAppSeedClient {
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: PrivateAppSeedClientOptions) {
    if (!options.token || options.token.length === 0) {
      throw new Error(
        "PrivateAppSeedClient: token is required. Set HUBSPOT_PRIVATE_APP_TOKEN or pass it explicitly.",
      );
    }
    this.token = options.token;
    this.fetchImpl = options.fetchImpl ?? globalThis.fetch;
  }

  /**
   * Authenticated fetch wrapper. Never includes the token in error messages
   * — only HTTP status + statusText so callers get useful diagnostics
   * without leaking the credential into logs.
   */
  private async authenticatedFetch(url: string, init: RequestInit = {}): Promise<Response> {
    const headers = new Headers(init.headers);
    headers.set("Authorization", `Bearer ${this.token}`);
    if (!headers.has("Accept")) headers.set("Accept", "application/json");
    return this.fetchImpl(url, { ...init, headers });
  }

  async searchCompaniesByMarker(
    markerProperty: string,
    markerValue: string,
    operator: "EQ" | "CONTAINS_TOKEN" = "EQ",
  ): Promise<Array<HubSpotObjectResponse>> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies/search`;
    const body = {
      filterGroups: [
        {
          filters: [
            {
              propertyName: markerProperty,
              operator,
              value: markerValue,
            },
          ],
        },
      ],
      properties: [markerProperty, "name", "domain", "hs_is_target_account"],
      limit: 100,
    };

    const res = await this.authenticatedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as {
      results?: Array<HubSpotObjectResponse>;
    };
    return (json.results ?? []).map((r) => ({
      id: r.id,
      properties: r.properties ?? {},
    }));
  }

  async createCompany(
    properties: Record<string, string | boolean | number>,
  ): Promise<HubSpotObjectResponse> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies`;
    const res = await this.authenticatedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: coercePropertiesToStrings(properties),
      }),
    });
    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as HubSpotObjectResponse;
    return { id: json.id, properties: json.properties ?? {} };
  }

  async updateCompany(
    companyId: string,
    properties: Record<string, string | boolean | number>,
  ): Promise<HubSpotObjectResponse> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/companies/${encodeURIComponent(companyId)}`;
    const res = await this.authenticatedFetch(url, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: coercePropertiesToStrings(properties),
      }),
    });
    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as HubSpotObjectResponse;
    return { id: json.id, properties: json.properties ?? {} };
  }

  async createContact(properties: Record<string, string>): Promise<HubSpotObjectResponse> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/contacts`;
    const res = await this.authenticatedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        properties: coercePropertiesToStrings(properties),
      }),
    });
    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }

    const json = (await res.json()) as HubSpotObjectResponse;
    return { id: json.id, properties: json.properties ?? {} };
  }

  async findContactByEmail(email: string): Promise<HubSpotObjectResponse | null> {
    const url = `${HUBSPOT_API_ROOT}/crm/v3/objects/contacts/search`;
    const res = await this.authenticatedFetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filterGroups: [
          {
            filters: [{ propertyName: "email", operator: "EQ", value: email }],
          },
        ],
        properties: ["email", "firstname", "lastname"],
        limit: 1,
      }),
    });
    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }
    const json = (await res.json()) as {
      results?: Array<HubSpotObjectResponse>;
    };
    return json.results?.[0] ?? null;
  }

  async associateContactWithCompany(companyId: string, contactId: string): Promise<void> {
    const url = `${HUBSPOT_API_ROOT}/crm/v4/objects/companies/${encodeURIComponent(
      companyId,
    )}/associations/default/contacts/${encodeURIComponent(contactId)}`;
    const res = await this.authenticatedFetch(url, { method: "PUT" });
    if (!res.ok) {
      throw new Error(`hubspot: ${res.status} ${res.statusText}`);
    }
  }
}
