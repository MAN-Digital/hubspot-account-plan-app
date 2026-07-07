/**
 * TrigifyClient — TS port of `trigify_client.py` (Stage A Task 3).
 *
 * Source: `.../outreach-engine/trigify_client.py` (OrbStack VM). Contract
 * pinned by the Task-1 spike (verified live 2026-07-03):
 *  - Base URL: `https://api.trigify.io/v1` (override via `apiBase`).
 *  - Auth: `Authorization: Bearer <TRIGIFY_API_KEY>`.
 *  - Transport: REST only.
 *
 * Credit model (verified live — reads never move `/v1/usage`):
 *  - FREE (reads): getSocialSignalsFeed, listSubscriptions, getUsage,
 *    getLimits (`/v1/social-signals/limits`).
 *  - CREDIT SPEND (create): guarded. `createSubscription` REQUIRES
 *    `{ confirm: true }` and throws {@link TrigifyWriteGuardError} otherwise —
 *    no request is ever sent when unconfirmed, so a monitor is never created
 *    by accident.
 *
 * Security:
 *  - The API key is NEVER interpolated into thrown error messages or
 *    `toString()` output. {@link TrigifyAPIError} carries only HTTP status
 *    and a parsed provider message/body — never headers.
 *  - Testability: the constructor accepts an injected `fetch` so
 *    replay-cassette tests drive deterministic responses without network
 *    access (mirrors {@link ../signal/exa.ExaAdapter}).
 */

const DEFAULT_API_BASE = "https://api.trigify.io";
const API_PREFIX = "/v1";

/** Base class for all TrigifyClient errors. */
export class TrigifyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TrigifyError";
  }
}

/** Missing/invalid configuration (e.g. no API key). */
export class TrigifyConfigError extends TrigifyError {
  constructor(message: string) {
    super(message);
    this.name = "TrigifyConfigError";
  }
}

/**
 * Non-2xx REST response. `message` is a stable, redacted description; the
 * API key is never interpolated into it (the key never appears in `data`
 * either, since it's never echoed by the Trigify API).
 */
export class TrigifyAPIError extends TrigifyError {
  readonly status: number;
  readonly data: unknown;

  constructor(args: {
    status: number;
    data: unknown;
    method: string;
    url: string;
  }) {
    const msg = extractMessage(args.data);
    super(`${args.method} ${args.url} -> HTTP ${args.status}${msg ? `: ${msg}` : ""}`);
    this.name = "TrigifyAPIError";
    this.status = args.status;
    this.data = args.data;
  }
}

/**
 * A mutating call was attempted without `confirm: true`.
 *
 * `createSubscription` additionally SPENDS CREDITS. This guard exists so no
 * monitor is ever created implicitly — credits are for signals + monitoring
 * only, and only for approved targets.
 */
export class TrigifyWriteGuardError extends TrigifyError {
  constructor(action: string) {
    super(
      `${action} is a CREDIT SPEND and is guarded: pass { confirm: true } to execute it (only for approved targets).`,
    );
    this.name = "TrigifyWriteGuardError";
  }
}

function extractMessage(data: unknown): string | null {
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const rec = data as Record<string, unknown>;
    if (typeof rec.message === "string") return rec.message;
    if (typeof rec.error === "string") return rec.error;
  }
  return null;
}

export interface TrigifyClientOptions {
  apiKey: string;
  /** Override the API base. Defaults to `https://api.trigify.io`. */
  apiBase?: string;
  /** Defaults to the global `fetch`. Inject in tests. */
  fetch?: typeof fetch;
}

export interface TrigifySignalFeedItem {
  id?: string;
  type?: string;
  profile_url?: string;
  company_url?: string;
  company_domain?: string;
  headline?: string;
  detail?: string;
  url?: string;
  /** Real field name per `normalize.ts`'s DATE_KEYS — NOT `occurred_at`. */
  posted_at?: string;
  detected_at?: string;
  [key: string]: unknown;
}

/**
 * Normalized, ALREADY-UNWRAPPED shape returned by
 * {@link TrigifyClient.getSocialSignalsFeed} to every caller in this app.
 *
 * The REAL wire response from `GET /v1/social-signals/feed` nests the item
 * list one level deeper than this: `{data: {items: [...], page, page_size,
 * total_count, has_next_page}}` — verified live against api.trigify.io with
 * a real key (Task 16). `getSocialSignalsFeed` unwraps that envelope
 * internally (see {@link extractFeedItems}) so `data` here is ALWAYS the
 * flat item array; callers (the poller) never see the nested envelope.
 */
export interface TrigifyFeedResponse {
  data: TrigifySignalFeedItem[];
  page?: number;
  pageSize?: number;
  totalCount?: number;
  hasNextPage?: boolean;
}

/** Raw wire shape of `GET /v1/social-signals/feed` before unwrapping. */
interface RawTrigifyFeedEnvelope {
  data?:
    | TrigifySignalFeedItem[]
    | {
        items?: TrigifySignalFeedItem[];
        results?: TrigifySignalFeedItem[];
        page?: number;
        page_size?: number;
        total_count?: number;
        has_next_page?: boolean;
      };
  [key: string]: unknown;
}

/**
 * Extract the flat item array + pagination metadata from a raw feed
 * envelope, tolerating every documented shape (mirrors
 * `trigify_source.py`'s `_feed_items()` docstring: "the spike shape is
 * {data:{items:[...], page, page_size, total_count, has_next_page}}; also
 * tolerate {data:[...]} and a bare list"):
 *  1. `{data: {items: [...]}}` — the REAL, live-verified shape.
 *  2. `{data: {results: [...]}}` — a documented alternate shape.
 *  3. `{data: [...]}` — a bare array (pre-live-verification assumption).
 * Anything else (missing/malformed `data`) returns an empty array rather
 * than throwing — a malformed envelope must never crash the poller.
 */
function extractFeedItems(raw: RawTrigifyFeedEnvelope): TrigifyFeedResponse {
  const data = raw.data;
  if (Array.isArray(data)) {
    return { data };
  }
  if (data && typeof data === "object") {
    if (Array.isArray(data.items)) {
      return {
        data: data.items,
        page: data.page,
        pageSize: data.page_size,
        totalCount: data.total_count,
        hasNextPage: data.has_next_page,
      };
    }
    if (Array.isArray(data.results)) {
      return {
        data: data.results,
        page: data.page,
        pageSize: data.page_size,
        totalCount: data.total_count,
        hasNextPage: data.has_next_page,
      };
    }
  }
  return { data: [] };
}

export interface TrigifySubscription {
  id?: string;
  linkedin_url?: string;
  status?: string;
  config?: Record<string, unknown>;
  created_at?: string;
  [key: string]: unknown;
}

export interface TrigifySubscriptionsResponse {
  data: TrigifySubscription[];
  [key: string]: unknown;
}

export interface TrigifyUsageResponse {
  credits_used?: number;
  credits_remaining?: number;
  monitor_count?: number;
  [key: string]: unknown;
}

export interface TrigifyLimitsResponse {
  plan?: string;
  max_lookback_window_ms?: number;
  max_subscriptions?: number;
  [key: string]: unknown;
}

export interface TrigifyCreateSubscriptionPayload {
  /** REQUIRED, 1..100 items per the v1 schema. */
  subscriptions: Array<{
    linkedin_url: string;
    config?: {
      version?: number;
      cadence?: "daily" | "weekly" | "hourly";
      lookbackWindowMs?: number;
      signals?: Array<{ type: string; config?: Record<string, unknown> }>;
    };
  }>;
}

export interface TrigifyCreateSubscriptionResponse {
  data?: Array<{ id?: string; [key: string]: unknown }>;
  [key: string]: unknown;
}

/**
 * Thin REST wrapper over `https://api.trigify.io/v1`.
 *
 * Holds the plaintext key only in its closure; never logs it. Tenant-scoped
 * decryption happens one layer up (config-resolver) — this class receives an
 * already-decrypted key.
 */
export class TrigifyClient {
  private readonly apiKey: string;
  private readonly apiBase: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: TrigifyClientOptions) {
    if (!options.apiKey || options.apiKey.trim().length === 0) {
      throw new TrigifyConfigError("no Trigify API key (pass a non-empty apiKey)");
    }
    this.apiKey = options.apiKey;
    this.apiBase = (options.apiBase ?? DEFAULT_API_BASE).replace(/\/+$/, "");
    this.fetchImpl = options.fetch ?? fetch;
  }

  private headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.apiKey}` };
  }

  private buildUrl(path: string, params?: Record<string, unknown>): string {
    let url = this.apiBase + API_PREFIX + path;
    if (params) {
      const clean = Object.entries(params).filter(
        ([, v]) => v !== undefined && v !== null && v !== "",
      );
      if (clean.length > 0) {
        const search = new URLSearchParams();
        for (const [k, v] of clean) search.set(k, String(v));
        url += `?${search.toString()}`;
      }
    }
    return url;
  }

  private async request<T>(
    method: string,
    path: string,
    opts?: { params?: Record<string, unknown>; body?: unknown },
  ): Promise<T> {
    const url = this.buildUrl(path, opts?.params);
    const hasBody = opts?.body !== undefined;
    const res = await this.fetchImpl(url, {
      method,
      headers: {
        Accept: "application/json",
        ...this.headers(),
        ...(hasBody ? { "Content-Type": "application/json" } : {}),
      },
      ...(hasBody ? { body: JSON.stringify(opts?.body) } : {}),
    });

    let data: unknown = null;
    const text = await res.text();
    if (text.length > 0) {
      try {
        data = JSON.parse(text);
      } catch {
        data = text;
      }
    }

    if (!res.ok) {
      throw new TrigifyAPIError({ status: res.status, data, method, url });
    }
    return data as T;
  }

  private guardWrite(action: string, confirm: boolean | undefined): void {
    if (confirm !== true) {
      throw new TrigifyWriteGuardError(action);
    }
  }

  // -- FREE reads: Social Signals (buying-intent feed) -----------------------

  /**
   * GET /v1/social-signals/feed — the pull feed (FREE).
   *
   * The real API nests the item list as `{data: {items: [...], page,
   * page_size, total_count, has_next_page}}` (verified live, Task 16) — this
   * method unwraps that envelope so `result.data` is always the flat item
   * array for every caller.
   */
  async getSocialSignalsFeed(params?: {
    page?: number;
    pageSize?: number;
  }): Promise<TrigifyFeedResponse> {
    const raw = await this.request<RawTrigifyFeedEnvelope>("GET", "/social-signals/feed", {
      params: { page: params?.page, page_size: params?.pageSize },
    });
    return extractFeedItems(raw);
  }

  /** GET /v1/social-signals/subscriptions — Social-Signals monitors (FREE). */
  async listSubscriptions(): Promise<TrigifySubscriptionsResponse> {
    return this.request<TrigifySubscriptionsResponse>("GET", "/social-signals/subscriptions");
  }

  /** GET /v1/social-signals/limits — tier/profile/cadence caps (FREE). */
  async getLimits(): Promise<TrigifyLimitsResponse> {
    return this.request<TrigifyLimitsResponse>("GET", "/social-signals/limits");
  }

  // -- FREE reads: account / usage --------------------------------------------

  /** GET /v1/usage — credit consumption + monitor counts (FREE). */
  async getUsage(): Promise<TrigifyUsageResponse> {
    return this.request<TrigifyUsageResponse>("GET", "/usage");
  }

  // -- GUARDED writes: Social Signals subscriptions ---------------------------

  /**
   * POST /v1/social-signals/subscriptions — create Social-Signals monitors
   * over LinkedIn profile/company URLs. **CREDIT SPEND.**
   *
   * Guarded: throws {@link TrigifyWriteGuardError} unless `confirm: true` —
   * the guard runs BEFORE any network call, so an unconfirmed call never
   * spends a credit.
   */
  async createSubscription(
    payload: TrigifyCreateSubscriptionPayload,
    opts?: { confirm?: boolean },
  ): Promise<TrigifyCreateSubscriptionResponse> {
    this.guardWrite("createSubscription", opts?.confirm);
    if (!Array.isArray(payload.subscriptions) || payload.subscriptions.length === 0) {
      throw new Error(
        "createSubscription: body must contain a non-empty 'subscriptions' array (v1 schema)",
      );
    }
    return this.request<TrigifyCreateSubscriptionResponse>(
      "POST",
      "/social-signals/subscriptions",
      {
        body: payload,
      },
    );
  }
}
