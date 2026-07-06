/**
 * Tests for the real HubSpot-backed CompanyPropertyFetcher + ContactFetcher
 * (Stage A Task 8). Both are thin adapters over {@link HubSpotClient} that
 * conform to the `eligibility.ts` / `people-selector.ts` fetcher contracts so
 * the snapshot route can stop injecting fixtures in production.
 *
 * The HubSpotClient itself is unit-tested against a fake fetch in
 * `lib/__tests__/hubspot-client.test.ts` — these tests stub HubSpotClient
 * construction via dependency injection (a `clientFactory` hook) so we can
 * assert the fetcher contracts (argument plumbing, error→undefined/[]
 * collapse) without re-testing HTTP plumbing.
 */

import type { Database } from "@hap/db";
import { describe, expect, it, vi } from "vitest";
import type { HubSpotAssociatedContact, HubSpotClient } from "../../lib/hubspot-client";
import { createHubSpotCompanyPropertyFetcher, createHubSpotContactFetcher } from "../crm-fetchers";

const FAKE_DB = {} as Database;

function makeFakeClient(overrides?: {
  getCompanyProperties?: HubSpotClient["getCompanyProperties"];
  getAssociatedContacts?: HubSpotClient["getAssociatedContacts"];
}): HubSpotClient {
  return {
    getCompanyProperties: overrides?.getCompanyProperties ?? vi.fn().mockResolvedValue({}),
    getAssociatedContacts: overrides?.getAssociatedContacts ?? vi.fn().mockResolvedValue([]),
  } as unknown as HubSpotClient;
}

describe("createHubSpotCompanyPropertyFetcher", () => {
  it("reads the requested property from HubSpotClient.getCompanyProperties", async () => {
    const getCompanyProperties = vi.fn().mockResolvedValue({ hs_is_target_account: "true" });
    const client = makeFakeClient({ getCompanyProperties });
    const clientFactory = vi.fn().mockReturnValue(client);

    const fetcher = createHubSpotCompanyPropertyFetcher({
      db: FAKE_DB,
      clientFactory,
    });
    const value = await fetcher("tenant-1", "co-1", "hs_is_target_account");

    expect(value).toBe("true");
    expect(clientFactory).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      db: FAKE_DB,
    });
    expect(getCompanyProperties).toHaveBeenCalledWith("co-1", ["hs_is_target_account"]);
  });

  it("returns undefined when the property is absent from the response", async () => {
    const client = makeFakeClient({
      getCompanyProperties: vi.fn().mockResolvedValue({}),
    });
    const fetcher = createHubSpotCompanyPropertyFetcher({
      db: FAKE_DB,
      clientFactory: () => client,
    });
    const value = await fetcher("tenant-1", "co-1", "hs_is_target_account");
    expect(value).toBeUndefined();
  });

  it("propagates transport errors (checkEligibility collapses to unconfigured upstream)", async () => {
    const client = makeFakeClient({
      getCompanyProperties: vi.fn().mockRejectedValue(new Error("hubspot: 500")),
    });
    const fetcher = createHubSpotCompanyPropertyFetcher({
      db: FAKE_DB,
      clientFactory: () => client,
    });
    await expect(fetcher("tenant-1", "co-1", "hs_is_target_account")).rejects.toThrow(
      "hubspot: 500",
    );
  });

  it("respects a custom property name (not hardcoded to hs_is_target_account)", async () => {
    const getCompanyProperties = vi.fn().mockResolvedValue({ custom_eligibility_flag: "false" });
    const client = makeFakeClient({ getCompanyProperties });
    const fetcher = createHubSpotCompanyPropertyFetcher({
      db: FAKE_DB,
      clientFactory: () => client,
    });
    const value = await fetcher("tenant-1", "co-1", "custom_eligibility_flag");
    expect(value).toBe("false");
    expect(getCompanyProperties).toHaveBeenCalledWith("co-1", ["custom_eligibility_flag"]);
  });
});

describe("createHubSpotContactFetcher", () => {
  it("maps HubSpotAssociatedContact rows onto the RawContact shape", async () => {
    const rows: HubSpotAssociatedContact[] = [
      {
        id: "contact-1",
        name: "Alex Champion",
        title: "VP Engineering",
        lastActivityAt: new Date("2026-04-10T00:00:00.000Z"),
      },
      { id: "contact-2", name: "Jordan Decider", title: "CTO" },
    ];
    const getAssociatedContacts = vi.fn().mockResolvedValue(rows);
    const client = makeFakeClient({ getAssociatedContacts });
    const clientFactory = vi.fn().mockReturnValue(client);

    const fetcher = createHubSpotContactFetcher({ db: FAKE_DB, clientFactory });
    const contacts = await fetcher("tenant-1", "co-1");

    expect(contacts).toEqual(rows);
    expect(clientFactory).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      db: FAKE_DB,
    });
    expect(getAssociatedContacts).toHaveBeenCalledWith("co-1");
  });

  it("returns [] when the company has no associated contacts (never fabricate)", async () => {
    const client = makeFakeClient({
      getAssociatedContacts: vi.fn().mockResolvedValue([]),
    });
    const fetcher = createHubSpotContactFetcher({
      db: FAKE_DB,
      clientFactory: () => client,
    });
    const contacts = await fetcher("tenant-1", "co-1");
    expect(contacts).toEqual([]);
  });

  it("propagates transport errors (people-selector.fetchContacts collapses to [] upstream)", async () => {
    const client = makeFakeClient({
      getAssociatedContacts: vi.fn().mockRejectedValue(new Error("hubspot: 500")),
    });
    const fetcher = createHubSpotContactFetcher({
      db: FAKE_DB,
      clientFactory: () => client,
    });
    await expect(fetcher("tenant-1", "co-1")).rejects.toThrow("hubspot: 500");
  });
});
