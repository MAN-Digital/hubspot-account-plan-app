/**
 * Tests for lifecycle observability logs (issue #19).
 *
 * Contract: docs/slice-12-preflight-notes.md §1. The receiver MUST emit:
 *   1. `console.log("hubspot-lifecycle-webhook: request received")` at
 *      handler entry, before signature/timestamp header reads.
 *   2. `console.log(`hubspot-lifecycle-webhook: applied=N ignored=N
 *      portalIds=<comma-joined>`)` after the for-loop close, before the
 *      return.
 *
 * portalIds are collected only on the applied path. Ignored events
 * (unknown eventTypeId, missing portalId) MUST NOT contribute to the list.
 *
 * Order MUST be request-arrival first, summary second.
 *
 * Intentionally DB-free: `applyHubSpotLifecycleEvent` is mocked so the
 * receiver's log-emission contract can be verified independently of the
 * Postgres pool that the broader test suite depends on. This keeps the log
 * assertions fast and deterministic, and avoids coupling observability
 * coverage to a reachable database.
 */
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../lib/tenant-lifecycle.js", () => ({
  applyHubSpotLifecycleEvent: vi.fn(async () => {}),
}));

// Import AFTER the mock so the receiver picks up the mocked function.
const { lifecycleWebhookRoutes } = await import("../routes/lifecycle");

const LIFECYCLE_EVENT_TYPE_INSTALL = "4-1909196";

const TEST_CLIENT_SECRET = process.env.HUBSPOT_CLIENT_SECRET ?? "";
if (TEST_CLIENT_SECRET.length === 0) {
  throw new Error(
    "lifecycle-logging.test.ts requires HUBSPOT_CLIENT_SECRET (seeded by vitest.setup.ts)",
  );
}

function buildApp() {
  const app = new Hono();
  // The receiver only touches `deps.db` indirectly via the (now mocked)
  // applyHubSpotLifecycleEvent, so an empty object is a sufficient stand-in.
  app.route(
    "/webhooks/hubspot/lifecycle",
    // biome-ignore lint/suspicious/noExplicitAny: db is unused due to module mock
    lifecycleWebhookRoutes({ db: {} as any }),
  );
  return app;
}

function signV3(params: {
  clientSecret: string;
  method: string;
  url: string;
  body: string;
  timestamp: number;
}): string {
  const raw = `${params.method}${decodeURIComponent(params.url)}${params.body}${params.timestamp}`;
  return createHmac("sha256", params.clientSecret).update(raw, "utf8").digest("base64");
}

async function postLifecycleRequest(events: Array<Record<string, unknown>>) {
  const app = buildApp();
  const url = "http://localhost/webhooks/hubspot/lifecycle";
  const body = JSON.stringify(events);
  const timestamp = Date.now();
  const signature = signV3({
    clientSecret: TEST_CLIENT_SECRET,
    method: "POST",
    url,
    body,
    timestamp,
  });

  return app.request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-hubspot-signature-v3": signature,
      "x-hubspot-request-timestamp": String(timestamp),
    },
    body,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("POST /webhooks/hubspot/lifecycle — observability logs (issue #19)", () => {
  it("emits a request-arrival log and an applied/ignored summary log for an applied event", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});
    const pid = "146425426";

    const res = await postLifecycleRequest([
      {
        eventId: 1,
        subscriptionId: 123,
        portalId: pid,
        appId: 12345,
        occurredAt: Date.now(),
        subscriptionType: "APP_LIFECYCLE_EVENT",
        attemptNumber: 0,
        eventTypeId: LIFECYCLE_EVENT_TYPE_INSTALL,
        sourceId: "source-1",
      },
    ]);

    expect(res.status).toBe(200);
    expect(spy).toHaveBeenCalledTimes(2);

    expect(spy.mock.calls[0]?.[0]).toBe("hubspot-lifecycle-webhook: request received");

    const summary = spy.mock.calls[1]?.[0] as string;
    expect(summary).toMatch(
      /^hubspot-lifecycle-webhook: applied=\d+ ignored=\d+ portalIds=[\d,]*$/,
    );
    expect(summary).toBe(`hubspot-lifecycle-webhook: applied=1 ignored=0 portalIds=${pid}`);
  });

  it("emits the summary log with empty portalIds when the event is ignored (missing portalId)", async () => {
    const spy = vi.spyOn(console, "log").mockImplementation(() => {});

    const res = await postLifecycleRequest([
      {
        eventId: 2,
        subscriptionId: 123,
        // No portalId — receiver MUST count as ignored and MUST NOT push
        // anything to portalIds.
        appId: 12345,
        occurredAt: Date.now(),
        subscriptionType: "APP_LIFECYCLE_EVENT",
        attemptNumber: 0,
        eventTypeId: LIFECYCLE_EVENT_TYPE_INSTALL,
        sourceId: "source-1",
      },
    ]);

    expect(res.status).toBe(200);
    // Two console.log calls (arrival + summary). The existing
    // `event missing portalId` warning goes through `console.warn`, not
    // `console.log`, so it does not show up in this spy.
    expect(spy).toHaveBeenCalledTimes(2);

    expect(spy.mock.calls[0]?.[0]).toBe("hubspot-lifecycle-webhook: request received");

    const summary = spy.mock.calls[1]?.[0] as string;
    expect(summary).toBe("hubspot-lifecycle-webhook: applied=0 ignored=1 portalIds=");
  });
});
