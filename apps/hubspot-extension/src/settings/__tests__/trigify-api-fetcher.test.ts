import { afterEach, describe, expect, it, vi } from "vitest";

// The fetcher module imports `hubspot` from @hubspot/ui-extensions; we mock
// `hubspot.fetch` to assert URL/method/body without a live host.
const fetchMock = vi.fn();
vi.mock("@hubspot/ui-extensions", () => ({
  hubspot: { fetch: (...args: unknown[]) => fetchMock(...args) },
}));

import {
  createTrigifyConnectionFetcher,
  createTrigifyMonitorLifecycle,
  createTrigifyPlanFetcher,
  createTrigifySubscriber,
} from "../trigify-api-fetcher";

const BASE = "https://api.test";

function okJson(body: unknown) {
  return { ok: true, status: 200, statusText: "OK", json: async () => body };
}

afterEach(() => {
  fetchMock.mockReset();
});

describe("createTrigifyConnectionFetcher", () => {
  it("GETs /api/settings/trigify and returns the parsed body", async () => {
    fetchMock.mockResolvedValueOnce(
      okJson({
        connected: true,
        usage: { credits_remaining: 9 },
        monitors: [],
      }),
    );
    const fetchConnection = createTrigifyConnectionFetcher(BASE);
    const result = await fetchConnection();
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/api/settings/trigify`, {
      method: "GET",
    });
    expect(result.connected).toBe(true);
    expect(result.usage?.credits_remaining).toBe(9);
  });

  it("degrades to connected:false when the request fails (never throws)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "err",
      json: async () => ({}),
    });
    const fetchConnection = createTrigifyConnectionFetcher(BASE);
    const result = await fetchConnection();
    expect(result).toEqual({ connected: false, usage: null, monitors: [] });
  });
});

describe("createTrigifyPlanFetcher", () => {
  it("POSTs the dry-run plan body WITHOUT confirm", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ projectedSpend: 1, notes: "ready to create" }));
    const plan = createTrigifyPlanFetcher(BASE);
    await plan({
      monitorType: "linkedin-profile",
      targetUrl: "https://linkedin.com/in/x",
    });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/api/settings/trigify/monitors/plan`, {
      method: "POST",
      body: {
        monitorType: "linkedin-profile",
        targetUrl: "https://linkedin.com/in/x",
      },
    });
  });
});

describe("createTrigifySubscriber", () => {
  it("POSTs the subscribe body with confirm:true", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ created: true, spend: 1, monitor: { id: "m1" } }));
    const subscribe = createTrigifySubscriber(BASE);
    await subscribe({
      monitorType: "linkedin-profile",
      targetUrl: "https://linkedin.com/in/x",
      confirm: true,
    });
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/api/settings/trigify/monitors`, {
      method: "POST",
      body: {
        monitorType: "linkedin-profile",
        targetUrl: "https://linkedin.com/in/x",
        confirm: true,
      },
    });
  });
});

describe("createTrigifyMonitorLifecycle", () => {
  it("POSTs pause to /monitors/:id/pause", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ id: "m1", status: "paused" }));
    const { pause } = createTrigifyMonitorLifecycle(BASE);
    const m = await pause("m1");
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/api/settings/trigify/monitors/m1/pause`, {
      method: "POST",
    });
    expect(m.status).toBe("paused");
  });

  it("POSTs delete to /monitors/:id/delete", async () => {
    fetchMock.mockResolvedValueOnce(okJson({ id: "m1", status: "deleted" }));
    const { remove } = createTrigifyMonitorLifecycle(BASE);
    const m = await remove("m1");
    expect(fetchMock).toHaveBeenCalledWith(`${BASE}/api/settings/trigify/monitors/m1/delete`, {
      method: "POST",
    });
    expect(m.status).toBe("deleted");
  });

  it("throws on a non-2xx lifecycle response (e.g. 404 foreign id)", async () => {
    fetchMock.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({ error: "not_found" }),
    });
    const { pause } = createTrigifyMonitorLifecycle(BASE);
    await expect(pause("foreign")).rejects.toThrow();
  });
});
