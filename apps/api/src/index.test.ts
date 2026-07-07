import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.resetModules();
  vi.doUnmock("@hono/node-server");
});

describe("API health endpoint", () => {
  it("should be importable", async () => {
    // Verify the Hono app module can be imported without errors
    const mod = await import("./index.js");
    expect(mod.default).toBeDefined();
  });

  it("should respond to /health", async () => {
    const { default: app } = await import("./index.js");
    const res = await app.request("/health");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(body.timestamp).toBeDefined();
  });

  it("mounts the HubSpot lifecycle webhook receiver at /webhooks/hubspot/lifecycle and rejects unsigned requests with 401", async () => {
    const { default: app } = await import("./index.js");
    const res = await app.request("/webhooks/hubspot/lifecycle", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "[]",
    });
    // A 404 here would mean the route was never mounted in index.ts; the
    // specific 401 proves the request reached the lifecycle route's own
    // signature check rather than falling through to a generic handler.
    expect(res.status).toBe(401);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("unauthorized");
  });

  it("mounts /admin/trigify-poll on the real exported app (Task 16 regression: was never registered in app.ts)", async () => {
    // A locally-constructed Hono instance (the pattern
    // routes/admin/__tests__/trigify-poll.test.ts uses) proves the HANDLER's
    // own logic works, but never proves app.ts actually calls
    // app.get("/admin/trigify-poll", ...) — that's exactly how this bug
    // shipped. This test imports the REAL exported app (mirrors the
    // lifecycle-webhook mount test above) so a missing mount shows up as a
    // 404 here, not just in production.
    const previousCronSecret = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "test-cron-secret-index-mount-check";
    try {
      const { default: app } = await import("./index.js");
      const res = await app.request("/admin/trigify-poll", {
        headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
      });
      // A 404 here means the route was never mounted in app.ts.
      expect(res.status).not.toBe(404);
      // Proves the request reached the REAL poll driver (createDbPollAllTenantsDeps
      // against the real test DB), not just that SOME handler matched the
      // path: 200 with a real summary shape (zero trigify-enabled tenants in
      // this test DB, so tenantsPolled is 0 but the shape is genuine).
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.status).toBe("ok");
      expect(typeof body.tenantsPolled).toBe("number");
      expect(typeof body.signalsRecorded).toBe("number");
      expect(Array.isArray(body.errors)).toBe(true);
    } finally {
      if (previousCronSecret === undefined) {
        delete process.env.CRON_SECRET;
      } else {
        process.env.CRON_SECRET = previousCronSecret;
      }
    }
  });

  it("does not auto-start the HTTP server inside Vitest, even when simulating production mode", async () => {
    const serveSpy = vi.fn();
    vi.doMock("@hono/node-server", () => ({
      serve: serveSpy,
    }));

    const previousNodeEnv = process.env.NODE_ENV;
    const previousRedirectUri = process.env.HUBSPOT_OAUTH_REDIRECT_URI;
    process.env.NODE_ENV = "production";
    process.env.HUBSPOT_OAUTH_REDIRECT_URI =
      "https://hap-signal-workspace-staging.vercel.app/oauth/callback";

    try {
      const mod = await import("./index.js");
      expect(mod.default).toBeDefined();
      expect(serveSpy).not.toHaveBeenCalled();
    } finally {
      if (previousNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = previousNodeEnv;
      }
      if (previousRedirectUri === undefined) {
        delete process.env.HUBSPOT_OAUTH_REDIRECT_URI;
      } else {
        process.env.HUBSPOT_OAUTH_REDIRECT_URI = previousRedirectUri;
      }
    }
  });
});
