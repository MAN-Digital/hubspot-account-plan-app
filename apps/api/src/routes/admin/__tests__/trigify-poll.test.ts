/**
 * Tests for the /admin/trigify-poll cron route (Stage A Task 6).
 *
 * Auth pattern copied EXACTLY from `routes/admin/keep-alive.ts`:
 * `Authorization: Bearer <CRON_SECRET>`, constant-time compare, 503 when
 * unconfigured, 401 missing token, 403 wrong token.
 */

import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createTrigifyPollHandler } from "../trigify-poll";

function buildApp(deps: Parameters<typeof createTrigifyPollHandler>[0]) {
  const app = new Hono();
  app.get("/admin/trigify-poll", createTrigifyPollHandler(deps));
  return app;
}

describe("createTrigifyPollHandler", () => {
  it("returns 503 when CRON_SECRET is not configured", async () => {
    const app = buildApp({
      poll: vi.fn(async () => ({
        tenantsPolled: 0,
        signalsRecorded: 0,
        skipped: 0,
        errors: [],
      })),
      env: {},
    });
    const res = await app.request("/admin/trigify-poll", {
      headers: { Authorization: "Bearer whatever" },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("trigify_poll_not_configured");
  });

  it("returns 401 when the Authorization header is missing", async () => {
    const app = buildApp({
      poll: vi.fn(async () => ({
        tenantsPolled: 0,
        signalsRecorded: 0,
        skipped: 0,
        errors: [],
      })),
      env: { CRON_SECRET: "s3cret" },
    });
    const res = await app.request("/admin/trigify-poll");
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("missing_cron_token");
  });

  it("returns 403 when the bearer token is wrong", async () => {
    const app = buildApp({
      poll: vi.fn(async () => ({
        tenantsPolled: 0,
        signalsRecorded: 0,
        skipped: 0,
        errors: [],
      })),
      env: { CRON_SECRET: "s3cret" },
    });
    const res = await app.request("/admin/trigify-poll", {
      headers: { Authorization: "Bearer wrong-token" },
    });
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("invalid_cron_token");
  });

  it("runs the poll and returns 200 with the summary on a valid token", async () => {
    const poll = vi.fn(async () => ({
      tenantsPolled: 2,
      signalsRecorded: 5,
      skipped: 1,
      errors: [],
    }));
    const app = buildApp({ poll, env: { CRON_SECRET: "s3cret" } });
    const res = await app.request("/admin/trigify-poll", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.tenantsPolled).toBe(2);
    expect(body.signalsRecorded).toBe(5);
    expect(body.skipped).toBe(1);
    expect(poll).toHaveBeenCalledTimes(1);
  });

  it("returns 503 when the poll itself throws, without leaking the error message", async () => {
    const poll = vi.fn(async () => {
      throw new Error("postgres://user:pass@host/db is unreachable");
    });
    const app = buildApp({ poll, env: { CRON_SECRET: "s3cret" } });
    const res = await app.request("/admin/trigify-poll", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toBe("poll_failed");
    expect(JSON.stringify(body)).not.toContain("postgres://");
  });

  it("returns 200 with per-tenant errors surfaced when the poll partially fails", async () => {
    const poll = vi.fn(async () => ({
      tenantsPolled: 2,
      signalsRecorded: 3,
      skipped: 0,
      errors: [{ tenantId: "tenant-x", error: "feed read failed" }],
    }));
    const app = buildApp({ poll, env: { CRON_SECRET: "s3cret" } });
    const res = await app.request("/admin/trigify-poll", {
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.errors).toHaveLength(1);
    expect(body.errors[0].tenantId).toBe("tenant-x");
  });
});
