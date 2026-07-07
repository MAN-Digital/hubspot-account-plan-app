/**
 * `hubspot.fetch()`-backed callers for the `/api/settings/trigify` routes
 * (Stage A Task 10). Mirrors the transport conventions of
 * `settings/api-fetcher.ts`: no custom headers (HubSpot signs every outbound
 * request and injects the authenticated portalId server-side), object `body`,
 * and a shared prod-default base URL.
 *
 * The credit-spend discipline lives in the CALLERS, not here: `plan` never
 * sends `confirm`, and `subscribe` only sends `confirm: true` when the caller
 * passes it — which the UI does only after an explicit user confirmation step.
 */
import { hubspot } from "@hubspot/ui-extensions";
import { DEFAULT_API_BASE_URL, SettingsApiError } from "./api-fetcher";
import type {
  SubscribePlan,
  SubscribeRequestBody,
  SubscribeResult,
  TrigifyConnectionResponse,
  TrigifyMonitor,
} from "./trigify-types";

export type TrigifyConnectionFetcher = () => Promise<TrigifyConnectionResponse>;
export type TrigifyPlanFetcher = (
  body: Omit<SubscribeRequestBody, "confirm">,
) => Promise<SubscribePlan>;
export type TrigifySubscriber = (body: SubscribeRequestBody) => Promise<SubscribeResult>;
export type TrigifyMonitorLifecycle = {
  pause: (id: string) => Promise<TrigifyMonitor>;
  remove: (id: string) => Promise<TrigifyMonitor>;
};

/**
 * Connection + monitor list. The backend GET already degrades to
 * `connected:false` on a bad/missing key (never 500s), but we ALSO catch
 * transport/HTTP failures here and return the same degraded shape so a
 * network blip renders the disconnected state instead of an error boundary.
 */
export function createTrigifyConnectionFetcher(
  baseUrl = DEFAULT_API_BASE_URL,
): TrigifyConnectionFetcher {
  return async () => {
    try {
      const response = await hubspot.fetch(`${baseUrl}/api/settings/trigify`, {
        method: "GET",
      });
      if (!response.ok) {
        return { connected: false, usage: null, monitors: [] };
      }
      return (await response.json()) as TrigifyConnectionResponse;
    } catch {
      return { connected: false, usage: null, monitors: [] };
    }
  };
}

/** Dry-run plan — NEVER sends `confirm`, so it can never spend a credit. */
export function createTrigifyPlanFetcher(baseUrl = DEFAULT_API_BASE_URL): TrigifyPlanFetcher {
  return async (body) => {
    const response = await hubspot.fetch(`${baseUrl}/api/settings/trigify/monitors/plan`, {
      method: "POST",
      body: body as unknown as Record<string, unknown>,
    });
    if (!response.ok) {
      throw new SettingsApiError(response.status, response.statusText);
    }
    return (await response.json()) as SubscribePlan;
  };
}

/**
 * Create a monitor. The caller is responsible for setting `confirm: true`
 * ONLY after the user has explicitly confirmed the credit spend. Without it,
 * the backend returns `{ created:false, spend:0 }` — a preview, no side effect.
 */
export function createTrigifySubscriber(baseUrl = DEFAULT_API_BASE_URL): TrigifySubscriber {
  return async (body) => {
    const response = await hubspot.fetch(`${baseUrl}/api/settings/trigify/monitors`, {
      method: "POST",
      body: body as unknown as Record<string, unknown>,
    });
    if (!response.ok) {
      throw new SettingsApiError(response.status, response.statusText);
    }
    return (await response.json()) as SubscribeResult;
  };
}

/** Pause / delete a monitor by id. A foreign id 404s → surfaced as an error. */
export function createTrigifyMonitorLifecycle(
  baseUrl = DEFAULT_API_BASE_URL,
): TrigifyMonitorLifecycle {
  async function transition(id: string, action: "pause" | "delete"): Promise<TrigifyMonitor> {
    const response = await hubspot.fetch(
      `${baseUrl}/api/settings/trigify/monitors/${id}/${action}`,
      { method: "POST" },
    );
    if (!response.ok) {
      throw new SettingsApiError(response.status, response.statusText);
    }
    return (await response.json()) as TrigifyMonitor;
  }
  return {
    pause: (id) => transition(id, "pause"),
    remove: (id) => transition(id, "delete"),
  };
}
