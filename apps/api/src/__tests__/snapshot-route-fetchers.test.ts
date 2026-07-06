/**
 * Stage A Task 8 — snapshot route fetcher resolution.
 *
 * `routes/snapshot.ts` historically ALWAYS used fixture property/contact
 * fetchers (`fixtureContactFetcher`, `pickPropertyFetcher` from `?eligibility=`).
 * These tests pin down the real-fetcher wiring:
 *   - In production (`NODE_ENV === "production"`), the route MUST always use
 *     the real HubSpot-backed fetchers — the `?eligibility=` override must be
 *     completely inert, regardless of the query param's presence.
 *   - Outside production, `?eligibility=` may still select a fixture fetcher
 *     for QA/dev convenience (existing behavior preserved).
 *   - The contact fetcher is ALWAYS the real HubSpot-backed one once a `db`
 *     is available — there is no fixture contact override in production.
 *
 * These are unit tests against the exported resolver functions (mirrors the
 * existing `composeSignalAdapters` export pattern) — no HTTP/auth stack
 * involved, so they run fast and don't depend on the ALLOW_TEST_AUTH /
 * DATABASE_URL environment quirks that the full-route tests do.
 */

import type { Database } from "@hap/db";
import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveContactFetcher, resolvePropertyFetcher } from "../routes/snapshot";

const FAKE_DB = {} as Database;

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("resolvePropertyFetcher", () => {
  it("in production, ALWAYS returns the real HubSpot-backed fetcher regardless of mode", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const getCompanyProperties = vi.fn().mockResolvedValue({ hs_is_target_account: "true" });
    const clientFactory = vi.fn().mockReturnValue({ getCompanyProperties } as never);

    const fetcher = resolvePropertyFetcher(FAKE_DB, "ineligible", clientFactory);
    const value = await fetcher("tenant-1", "co-1", "hs_is_target_account");

    // Real data says "true" even though the caller asked for the "ineligible"
    // fixture mode — production must never honor the fixture override.
    expect(value).toBe("true");
    expect(getCompanyProperties).toHaveBeenCalledWith("co-1", ["hs_is_target_account"]);
  });

  it("outside production, an explicit fixture mode still returns the fixture fetcher", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const clientFactory = vi.fn();
    const fetcher = resolvePropertyFetcher(FAKE_DB, "ineligible", clientFactory);
    const value = await fetcher("tenant-1", "co-1", "hs_is_target_account");
    expect(value).toBe(false);
    // Fixture path never constructs a real client.
    expect(clientFactory).not.toHaveBeenCalled();
  });

  it("outside production, mode='eligible' (default) still uses the real fetcher (no query param = real path)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const getCompanyProperties = vi.fn().mockResolvedValue({ hs_is_target_account: "true" });
    const clientFactory = vi.fn().mockReturnValue({ getCompanyProperties } as never);
    const fetcher = resolvePropertyFetcher(FAKE_DB, undefined, clientFactory);
    const value = await fetcher("tenant-1", "co-1", "hs_is_target_account");
    expect(value).toBe("true");
  });
});

describe("resolveContactFetcher", () => {
  it("always returns the real HubSpot-backed contact fetcher (no fixture path in the resolver)", async () => {
    vi.stubEnv("NODE_ENV", "test");
    const rows = [{ id: "contact-1", name: "Alex Champion", title: "VP Engineering" }];
    const getAssociatedContacts = vi.fn().mockResolvedValue(rows);
    const clientFactory = vi.fn().mockReturnValue({ getAssociatedContacts } as never);

    const fetcher = resolveContactFetcher(FAKE_DB, clientFactory);
    const contacts = await fetcher("tenant-1", "co-1");

    expect(contacts).toEqual(rows);
    expect(getAssociatedContacts).toHaveBeenCalledWith("co-1");
  });

  it("behaves identically in production (real fetcher, no fixture escape hatch)", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const getAssociatedContacts = vi.fn().mockResolvedValue([]);
    const clientFactory = vi.fn().mockReturnValue({ getAssociatedContacts } as never);
    const fetcher = resolveContactFetcher(FAKE_DB, clientFactory);
    const contacts = await fetcher("tenant-1", "co-1");
    expect(contacts).toEqual([]);
  });
});
