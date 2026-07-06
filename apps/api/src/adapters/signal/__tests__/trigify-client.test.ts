/**
 * Tests for the TrigifyClient REST port (Stage A Task 3).
 *
 * Source of truth: `trigify_client.py` (OrbStack VM,
 * `.../outreach-engine/trigify_client.py`). This test suite ports its
 * contract:
 *  - Bearer auth (`Authorization: Bearer <key>`).
 *  - FREE reads: getSocialSignalsFeed, listSubscriptions, getUsage, getLimits.
 *  - GUARDED writes: createSubscription requires `confirm: true`, else throws
 *    TrigifyWriteGuardError — no request is ever sent when unconfirmed.
 *  - The API key is NEVER interpolated into thrown errors or `toString()`.
 *
 * Cassette replay: fake `fetch` injection, no network access, mirrors
 * `exa.test.ts`. Cassettes are SCRUBBED of the Authorization header value.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  TrigifyAPIError,
  TrigifyClient,
  TrigifyConfigError,
  TrigifyWriteGuardError,
} from "../trigify-client";

const here = dirname(fileURLToPath(import.meta.url));

function loadCassette(name: string): {
  response: { status: number; body: unknown };
  usage: { response: { status: number; body: unknown } };
  limits: { response: { status: number; body: unknown } };
} {
  return JSON.parse(readFileSync(join(here, "cassettes", name), "utf8"));
}

function fakeFetchReturning(status: number, body: unknown): typeof fetch {
  return vi.fn(async () => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
}

describe("TrigifyClient", () => {
  describe("construction", () => {
    it("throws TrigifyConfigError when no API key is provided", () => {
      expect(() => new TrigifyClient({ apiKey: "", fetch: fakeFetchReturning(200, {}) })).toThrow(
        TrigifyConfigError,
      );
    });

    it("defaults the API base to https://api.trigify.io", async () => {
      const spy = vi.fn(async () => new Response(JSON.stringify({ data: [] }), { status: 200 }));
      const client = new TrigifyClient({
        apiKey: "trigify-secret-1",
        fetch: spy as unknown as typeof fetch,
      });
      await client.getSocialSignalsFeed();
      const [url] = spy.mock.calls[0] as unknown as [string];
      expect(url.startsWith("https://api.trigify.io/v1/social-signals/feed")).toBe(true);
    });
  });

  describe("FREE reads", () => {
    it("getSocialSignalsFeed sends Bearer auth and returns the feed page", async () => {
      const cassette = loadCassette("trigify-feed.json");
      const spy = vi.fn(async () => {
        return new Response(JSON.stringify(cassette.response.body), {
          status: cassette.response.status,
          headers: { "content-type": "application/json" },
        });
      });
      const client = new TrigifyClient({
        apiKey: "trigify-secret-1",
        fetch: spy as unknown as typeof fetch,
      });

      const result = await client.getSocialSignalsFeed({
        page: 1,
        pageSize: 2,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.trigify.io/v1/social-signals/feed?page=1&page_size=2");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer trigify-secret-1");
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.type).toBe("changed_role");
    });

    it("listSubscriptions returns subscription rows", async () => {
      const cassette = loadCassette("trigify-subscriptions.json");
      const client = new TrigifyClient({
        apiKey: "trigify-secret-1",
        fetch: fakeFetchReturning(cassette.response.status, cassette.response.body),
      });
      const result = await client.listSubscriptions();
      expect(result.data).toHaveLength(1);
      expect(result.data[0]?.status).toBe("ACTIVE");
    });

    it("getUsage returns credit consumption", async () => {
      const cassette = loadCassette("trigify-usage-limits.json");
      const client = new TrigifyClient({
        apiKey: "trigify-secret-1",
        fetch: fakeFetchReturning(cassette.usage.response.status, cassette.usage.response.body),
      });
      const usage = await client.getUsage();
      expect(usage.credits_remaining).toBe(880);
    });

    it("getLimits returns plan-aware lookback caps", async () => {
      const cassette = loadCassette("trigify-usage-limits.json");
      const client = new TrigifyClient({
        apiKey: "trigify-secret-1",
        fetch: fakeFetchReturning(cassette.limits.response.status, cassette.limits.response.body),
      });
      const limits = await client.getLimits();
      expect(limits.max_lookback_window_ms).toBe(2592000000);
    });

    it("throws TrigifyAPIError on 401 without leaking the key in the message", async () => {
      const apiKey = "trigify-leak-me-nope";
      const client = new TrigifyClient({
        apiKey,
        fetch: fakeFetchReturning(401, { message: "invalid API key" }),
      });
      let caught: unknown;
      try {
        await client.getUsage();
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TrigifyAPIError);
      const err = caught as TrigifyAPIError;
      expect(err.status).toBe(401);
      expect(err.message).not.toContain(apiKey);
      expect(String(err)).not.toContain(apiKey);
    });
  });

  describe("GUARDED writes", () => {
    it("createSubscription throws TrigifyWriteGuardError when confirm is not true", async () => {
      const spy = vi.fn();
      const client = new TrigifyClient({
        apiKey: "trigify-secret-1",
        fetch: spy as unknown as typeof fetch,
      });

      await expect(
        client.createSubscription({
          subscriptions: [{ linkedin_url: "https://www.linkedin.com/in/jane-doe/" }],
        }),
      ).rejects.toBeInstanceOf(TrigifyWriteGuardError);

      // The write-guard must block BEFORE any network call — no silent spend.
      expect(spy).not.toHaveBeenCalled();
    });

    it("createSubscription throws TrigifyWriteGuardError when confirm is explicitly false", async () => {
      const spy = vi.fn();
      const client = new TrigifyClient({
        apiKey: "trigify-secret-1",
        fetch: spy as unknown as typeof fetch,
      });

      await expect(
        client.createSubscription(
          {
            subscriptions: [{ linkedin_url: "https://www.linkedin.com/in/jane-doe/" }],
          },
          { confirm: false },
        ),
      ).rejects.toBeInstanceOf(TrigifyWriteGuardError);
      expect(spy).not.toHaveBeenCalled();
    });

    it("createSubscription posts the body verbatim when confirm is true", async () => {
      const spy = vi.fn(async () => {
        return new Response(JSON.stringify({ data: [{ id: "sub_new" }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      });
      const client = new TrigifyClient({
        apiKey: "trigify-secret-1",
        fetch: spy as unknown as typeof fetch,
      });

      const payload = {
        subscriptions: [
          {
            linkedin_url: "https://www.linkedin.com/in/jane-doe/",
            config: {
              version: 1,
              cadence: "daily",
              lookbackWindowMs: 2592000000,
            },
          },
        ],
      };
      const result = await client.createSubscription(payload, {
        confirm: true,
      });

      expect(spy).toHaveBeenCalledTimes(1);
      const [url, init] = spy.mock.calls[0] as unknown as [string, RequestInit];
      expect(url).toBe("https://api.trigify.io/v1/social-signals/subscriptions");
      expect(init.method).toBe("POST");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer trigify-secret-1");
      expect(JSON.parse(init.body as string)).toEqual(payload);
      expect(result.data?.[0]?.id).toBe("sub_new");
    });

    it("createSubscription rejects an empty subscriptions array even when confirmed", async () => {
      const spy = vi.fn();
      const client = new TrigifyClient({
        apiKey: "trigify-secret-1",
        fetch: spy as unknown as typeof fetch,
      });
      await expect(
        client.createSubscription({ subscriptions: [] }, { confirm: true }),
      ).rejects.toThrow(/non-empty/);
      expect(spy).not.toHaveBeenCalled();
    });

    it("never includes the API key in a TrigifyWriteGuardError message", async () => {
      const apiKey = "trigify-guard-leak-nope";
      const client = new TrigifyClient({
        apiKey,
        fetch: vi.fn() as unknown as typeof fetch,
      });
      let caught: unknown;
      try {
        await client.createSubscription({
          subscriptions: [{ linkedin_url: "https://x" }],
        });
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(TrigifyWriteGuardError);
      expect(String(caught)).not.toContain(apiKey);
    });
  });
});
