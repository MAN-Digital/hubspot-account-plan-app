/**
 * Tests for GET /admin/keep-alive — Vercel cron endpoint that pings the DB
 * (`select 1`) and sweeps expired signed_request_nonce rows. Two birds:
 *  1) keep Supabase free-tier project from auto-pausing after ~7 days
 *  2) run the long-dangling nonce TTL sweep on a schedule
 *
 * Security contract:
 *   - Auth is `Authorization: Bearer <CRON_SECRET>` (Vercel cron convention).
 *   - Constant-time compare. Wrong length and wrong content both return 403.
 *   - Missing env -> 503 `keepalive_not_configured` (so a misconfigured
 *     deploy fails loudly to Vercel cron, surfacing in dashboard alerts).
 *   - DB failure -> 503 `database_unreachable` (also signals cron failure).
 */
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { createKeepAliveRoute } from "../keep-alive";

const VALID_TOKEN = "cron-secret-token-0123456789abcdef";

function mount(
  deps: {
    ping?: () => Promise<void>;
    sweep?: () => Promise<{ deletedCount: number }>;
    env?: Record<string, string | undefined>;
  } = {},
) {
  const ping = deps.ping ?? vi.fn(async () => undefined);
  const sweep = deps.sweep ?? vi.fn(async () => ({ deletedCount: 0 }));
  const env = deps.env ?? { CRON_SECRET: VALID_TOKEN };

  const app = new Hono();
  app.route("/admin/keep-alive", createKeepAliveRoute({ ping, sweep, env }));
  return { app, ping, sweep };
}

describe("GET /admin/keep-alive", () => {
  it("returns 401 when Authorization header is missing", async () => {
    const { app, ping, sweep } = mount();

    const res = await app.request("/admin/keep-alive");

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "missing_cron_token" });
    expect(ping).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });

  it("returns 401 when Authorization header is not a Bearer token", async () => {
    const { app, ping, sweep } = mount();

    const res = await app.request("/admin/keep-alive", {
      headers: { Authorization: VALID_TOKEN }, // missing "Bearer " prefix
    });

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "missing_cron_token" });
    expect(ping).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });

  it("returns 403 when bearer has the same length but wrong value", async () => {
    const wrong = VALID_TOKEN.split("").reverse().join("");
    expect(wrong.length).toBe(VALID_TOKEN.length);
    const { app, ping, sweep } = mount();

    const res = await app.request("/admin/keep-alive", {
      headers: { Authorization: `Bearer ${wrong}` },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalid_cron_token" });
    expect(ping).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });

  it("returns 403 when bearer has a different length than the configured secret", async () => {
    const { app, ping, sweep } = mount();

    const res = await app.request("/admin/keep-alive", {
      headers: { Authorization: "Bearer short" },
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: "invalid_cron_token" });
    expect(ping).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });

  it("returns 503 when CRON_SECRET env is missing (misconfigured)", async () => {
    const { app, ping, sweep } = mount({
      env: { CRON_SECRET: undefined },
    });

    const res = await app.request("/admin/keep-alive", {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "keepalive_not_configured" });
    expect(ping).not.toHaveBeenCalled();
    expect(sweep).not.toHaveBeenCalled();
  });

  it("returns 200 with status, dbPingMs, sweptNonces, and timestamp on success", async () => {
    const ping = vi.fn(async () => undefined);
    const sweep = vi.fn(async () => ({ deletedCount: 7 }));
    const { app } = mount({ ping, sweep });

    const res = await app.request("/admin/keep-alive", {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.status).toBe("ok");
    expect(typeof body.dbPingMs).toBe("number");
    expect(body.dbPingMs).toBeGreaterThanOrEqual(0);
    expect(body.sweptNonces).toBe(7);
    expect(typeof body.timestamp).toBe("string");
    // Must not leak the secret in any field.
    expect(JSON.stringify(body)).not.toContain(VALID_TOKEN);
    expect(ping).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledTimes(1);
  });

  it("returns 503 with database_unreachable when ping throws", async () => {
    const ping = vi.fn(async () => {
      throw new Error("connect ECONNREFUSED 10.0.0.1:5432");
    });
    const sweep = vi.fn(async () => ({ deletedCount: 0 }));
    const { app } = mount({ ping, sweep });

    const res = await app.request("/admin/keep-alive", {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "database_unreachable" });
    // Must not leak the underlying error message (could contain host:port).
    expect(JSON.stringify(body)).not.toContain("ECONNREFUSED");
    expect(JSON.stringify(body)).not.toContain("10.0.0.1");
    expect(sweep).not.toHaveBeenCalled();
  });

  it("returns 503 with database_unreachable when sweep throws after a successful ping", async () => {
    const ping = vi.fn(async () => undefined);
    const sweep = vi.fn(async () => {
      throw new Error('relation "signed_request_nonce" does not exist');
    });
    const { app } = mount({ ping, sweep });

    const res = await app.request("/admin/keep-alive", {
      headers: { Authorization: `Bearer ${VALID_TOKEN}` },
    });

    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toEqual({ error: "database_unreachable" });
    expect(JSON.stringify(body)).not.toContain("signed_request_nonce");
    expect(ping).toHaveBeenCalledTimes(1);
    expect(sweep).toHaveBeenCalledTimes(1);
  });
});
