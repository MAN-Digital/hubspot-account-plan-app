/**
 * Tests for `scripts/seed-hubspot-private-app-client.ts`.
 *
 * `PrivateAppSeedClient` implements the `SeedHubSpotClient` interface using
 * a HubSpot Private App access token (static Bearer) instead of the per-
 * tenant OAuth token resolved through `apps/api/src/lib/hubspot-client.ts`.
 *
 * Why this exists: the production HubSpot app is marketplace-distributed
 * with read-only scopes. Adding write scopes would trigger marketplace
 * re-review (days to weeks). A Private App token issued by the portal admin
 * carries the write scopes the seed script needs without changing the
 * user-facing OAuth grant. See `docs/decisions/oauth-scope-policy.md` for
 * the full rationale.
 *
 * The tests mock `global.fetch` directly — no real HubSpot calls.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PrivateAppSeedClient } from "../seed-hubspot-private-app-client";

const TOKEN = "pat-na1-test-token-0123456789";
const API_ROOT = "https://api.hubapi.com";

function mockFetchOnce(body: unknown, init: { status?: number; statusText?: string } = {}) {
  const status = init.status ?? 200;
  const statusText = init.statusText ?? "OK";
  return vi.fn<typeof fetch>().mockResolvedValueOnce(
    new Response(JSON.stringify(body), {
      status,
      statusText,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("PrivateAppSeedClient", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe("constructor", () => {
    it("rejects empty token at construction time (loud failure beats lazy 401)", () => {
      expect(() => new PrivateAppSeedClient({ token: "" })).toThrow(/token/i);
    });
  });

  describe("auth header", () => {
    it("sends Authorization: Bearer <token> on every request", async () => {
      const fetchMock = mockFetchOnce({
        id: "co-1",
        properties: { name: "Acme" },
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      await client.createCompany({ name: "Acme" });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const init = fetchMock.mock.calls[0]?.[1] as RequestInit | undefined;
      const headers = init?.headers as Headers | undefined;
      expect(headers?.get("authorization")).toBe(`Bearer ${TOKEN}`);
    });

    it("never logs the token in thrown error messages", async () => {
      const fetchMock = mockFetchOnce({}, { status: 403, statusText: "Forbidden" });
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      await expect(client.createCompany({ name: "Acme" })).rejects.toThrow(/403/);
      try {
        await client.createCompany({ name: "Acme" });
      } catch (err) {
        expect((err as Error).message).not.toContain(TOKEN);
      }
    });
  });

  describe("searchCompaniesByMarker", () => {
    it("POSTs to /crm/v3/objects/companies/search with the correct filter and returns mapped results", async () => {
      const fetchMock = mockFetchOnce({
        results: [
          {
            id: "co-1",
            properties: { name: "Slice2-EligibleStrong-AcmeCorp" },
          },
          { id: "co-2", properties: { name: "Slice2-Empty-GammaCo" } },
        ],
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      const results = await client.searchCompaniesByMarker("name", "Slice2*", "CONTAINS_TOKEN");

      expect(results).toEqual([
        { id: "co-1", properties: { name: "Slice2-EligibleStrong-AcmeCorp" } },
        { id: "co-2", properties: { name: "Slice2-Empty-GammaCo" } },
      ]);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_ROOT}/crm/v3/objects/companies/search`);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.filterGroups[0].filters[0]).toEqual({
        propertyName: "name",
        operator: "CONTAINS_TOKEN",
        value: "Slice2*",
      });
    });

    it("defaults the operator to EQ when not provided", async () => {
      const fetchMock = mockFetchOnce({ results: [] });
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      await client.searchCompaniesByMarker("hap_seed_marker", "slice-2");

      const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
      const body = JSON.parse(init.body as string);
      expect(body.filterGroups[0].filters[0].operator).toBe("EQ");
    });

    it("returns [] when HubSpot returns no results", async () => {
      const fetchMock = mockFetchOnce({});
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      const results = await client.searchCompaniesByMarker("name", "Slice2*", "CONTAINS_TOKEN");

      expect(results).toEqual([]);
    });
  });

  describe("createCompany", () => {
    it("POSTs to /crm/v3/objects/companies with coerced string properties", async () => {
      const fetchMock = mockFetchOnce({
        id: "co-new",
        properties: { name: "Acme", hs_is_target_account: "true" },
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      const result = await client.createCompany({
        name: "Acme",
        hs_is_target_account: true,
      });

      expect(result).toEqual({
        id: "co-new",
        properties: { name: "Acme", hs_is_target_account: "true" },
      });
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_ROOT}/crm/v3/objects/companies`);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      // HubSpot v3 requires ALL property values to be strings on the wire.
      expect(body.properties).toEqual({
        name: "Acme",
        hs_is_target_account: "true",
      });
    });

    it("throws with HTTP status when HubSpot returns non-2xx", async () => {
      const fetchMock = mockFetchOnce(
        { message: "Property name is required" },
        { status: 400, statusText: "Bad Request" },
      );
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      await expect(client.createCompany({})).rejects.toThrow(/400/);
    });
  });

  describe("updateCompany", () => {
    it("PATCHes /crm/v3/objects/companies/{id} with coerced properties and URL-encoded id", async () => {
      const fetchMock = mockFetchOnce({
        id: "co-1",
        properties: { name: "Renamed" },
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      const result = await client.updateCompany("co/1", { name: "Renamed" });

      expect(result.id).toBe("co-1");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_ROOT}/crm/v3/objects/companies/co%2F1`);
      expect(init.method).toBe("PATCH");
    });
  });

  describe("createContact", () => {
    it("POSTs to /crm/v3/objects/contacts with the given properties", async () => {
      const fetchMock = mockFetchOnce({
        id: "ct-1",
        properties: { email: "a@example.com", firstname: "Ada" },
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      const result = await client.createContact({
        email: "a@example.com",
        firstname: "Ada",
        lastname: "Lovelace",
      });

      expect(result.id).toBe("ct-1");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_ROOT}/crm/v3/objects/contacts`);
      expect(init.method).toBe("POST");
      const body = JSON.parse(init.body as string);
      expect(body.properties.email).toBe("a@example.com");
    });
  });

  describe("findContactByEmail", () => {
    it("POSTs to /crm/v3/objects/contacts/search with an EQ filter on email and returns the first result", async () => {
      const fetchMock = mockFetchOnce({
        results: [{ id: "ct-1", properties: { email: "a@example.com" } }],
      });
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      const result = await client.findContactByEmail("a@example.com");

      expect(result?.id).toBe("ct-1");
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(`${API_ROOT}/crm/v3/objects/contacts/search`);
      const body = JSON.parse(init.body as string);
      expect(body.filterGroups[0].filters[0]).toEqual({
        propertyName: "email",
        operator: "EQ",
        value: "a@example.com",
      });
      expect(body.limit).toBe(1);
    });

    it("returns null when HubSpot reports no match", async () => {
      const fetchMock = mockFetchOnce({ results: [] });
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      const result = await client.findContactByEmail("ghost@example.com");

      expect(result).toBeNull();
    });
  });

  describe("associateContactWithCompany", () => {
    it("PUTs the v4 default-association endpoint with URL-encoded ids", async () => {
      const fetchMock = mockFetchOnce({});
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      await client.associateContactWithCompany("co/1", "ct/2");

      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe(
        `${API_ROOT}/crm/v4/objects/companies/co%2F1/associations/default/contacts/ct%2F2`,
      );
      expect(init.method).toBe("PUT");
    });

    it("throws on non-2xx so the seed run halts on association failure", async () => {
      const fetchMock = mockFetchOnce({}, { status: 409, statusText: "Conflict" });
      vi.stubGlobal("fetch", fetchMock);
      const client = new PrivateAppSeedClient({ token: TOKEN });

      await expect(client.associateContactWithCompany("co1", "ct1")).rejects.toThrow(/409/);
    });
  });
});
