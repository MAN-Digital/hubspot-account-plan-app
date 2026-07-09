#!/usr/bin/env node

/**
 * Enable HubSpot App Cards for a specific installed portal.
 *
 * HubSpot project upload can deploy a CARD component successfully while the
 * CRM layout editor still hides it behind the hs-release-app-cards rollout
 * flag. This script performs the exact flag update for one portal.
 *
 * Auth:
 * - Prefer HUBSPOT_APP_MANAGEMENT_TOKEN for the current 2026-03 endpoint.
 * - Fall back to HUBSPOT_DEVELOPER_API_KEY for the legacy v3 endpoint.
 *
 * Usage:
 *   HUBSPOT_APP_MANAGEMENT_TOKEN=... pnpm hubspot:app-cards:release -- --app 37116835 --portal 147062576
 *   HUBSPOT_DEVELOPER_API_KEY=... pnpm hubspot:app-cards:release -- --app 37116835 --portal 147062576
 */

import { pathToFileURL } from "node:url";

const FLAG_NAME = "hs-release-app-cards";
const DEFAULT_BASE_URL = "https://api.hubapi.com";

export type FlagState = "ON" | "OFF";

export interface EnableAppCardsArgs {
  appId: string;
  portalId: string;
  flagState: FlagState;
  dryRun: boolean;
}

export interface FeatureFlagRequestInput {
  appId: string;
  portalId: string;
  flagState: FlagState;
  env: Record<string, string | undefined>;
  baseUrl?: string;
}

export interface FeatureFlagRequest {
  url: string;
  init: RequestInit & { headers: Record<string, string>; body: string };
  authMode: "oauth" | "developer-api-key";
}

export interface RunDeps {
  env?: Record<string, string | undefined>;
  fetcher?: typeof fetch;
  log?: (message: string) => void;
  baseUrl?: string;
}

export function parseArgs(args: string[]): EnableAppCardsArgs {
  let appId: string | undefined;
  let portalId: string | undefined;
  let flagState: FlagState = "ON";
  let dryRun = false;

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--") {
      continue;
    }
    if (arg === "--app") {
      appId = readValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--app=")) {
      appId = arg.slice("--app=".length);
      continue;
    }
    if (arg === "--portal") {
      portalId = readValue(args, i, arg);
      i += 1;
      continue;
    }
    if (arg?.startsWith("--portal=")) {
      portalId = arg.slice("--portal=".length);
      continue;
    }
    if (arg === "--state") {
      flagState = parseFlagState(readValue(args, i, arg));
      i += 1;
      continue;
    }
    if (arg?.startsWith("--state=")) {
      flagState = parseFlagState(arg.slice("--state=".length));
      continue;
    }
    if (arg === "--dry-run") {
      dryRun = true;
      continue;
    }
    throw new Error(`Unknown argument: ${arg}`);
  }

  if (!appId) {
    throw new Error("Missing --app <appId>");
  }
  if (!portalId) {
    throw new Error("Missing --portal <portalId>");
  }

  return { appId, portalId, flagState, dryRun };
}

export function buildFeatureFlagRequest(input: FeatureFlagRequestInput): FeatureFlagRequest {
  const baseUrl = input.baseUrl ?? DEFAULT_BASE_URL;
  const body = JSON.stringify({ flagState: input.flagState });
  const bearerToken = input.env.HUBSPOT_APP_MANAGEMENT_TOKEN;

  if (bearerToken) {
    return {
      url: `${baseUrl}/feature-flags/2026-03/${input.appId}/flags/${FLAG_NAME}/portals/${input.portalId}`,
      init: {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${bearerToken}`,
          "Content-Type": "application/json",
        },
        body,
      },
      authMode: "oauth",
    };
  }

  const developerApiKey = input.env.HUBSPOT_DEVELOPER_API_KEY;
  if (developerApiKey) {
    const query = new URLSearchParams({ hapikey: developerApiKey });
    return {
      url: `${baseUrl}/feature-flags/v3/${input.appId}/flags/${FLAG_NAME}/portals/${input.portalId}?${query.toString()}`,
      init: {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body,
      },
      authMode: "developer-api-key",
    };
  }

  throw new Error(
    "Missing app-card rollout credential. Set HUBSPOT_APP_MANAGEMENT_TOKEN or HUBSPOT_DEVELOPER_API_KEY.",
  );
}

export async function runEnableAppCards(args: string[], deps: RunDeps = {}) {
  const parsed = parseArgs(args);
  const env = deps.env ?? process.env;
  const fetcher = deps.fetcher ?? fetch;
  const log = deps.log ?? console.log;
  const request = buildFeatureFlagRequest({
    appId: parsed.appId,
    portalId: parsed.portalId,
    flagState: parsed.flagState,
    env,
    baseUrl: deps.baseUrl,
  });

  const safeUrl = redactFeatureFlagUrl(request.url);

  if (parsed.dryRun) {
    log(
      `[hubspot-app-cards] dry-run: would set ${FLAG_NAME}=${parsed.flagState} for portal ${parsed.portalId} using ${request.authMode} at ${safeUrl}`,
    );
    return { dryRun: true, request };
  }

  const response = await fetcher(request.url, request.init);
  const text = await response.text();
  if (!response.ok) {
    throw new Error(
      `[hubspot-app-cards] failed to set ${FLAG_NAME}=${parsed.flagState}: HTTP ${response.status} ${text}`,
    );
  }

  log(
    `[hubspot-app-cards] set ${FLAG_NAME}=${parsed.flagState} for portal ${parsed.portalId} using ${request.authMode}`,
  );
  return { dryRun: false, status: response.status, body: text };
}

function readValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function parseFlagState(value: string): FlagState {
  if (value === "ON" || value === "OFF") return value;
  throw new Error(`Invalid --state ${value}; expected ON or OFF`);
}

function redactFeatureFlagUrl(url: string): string {
  const parsed = new URL(url);
  if (parsed.searchParams.has("hapikey")) {
    parsed.searchParams.set("hapikey", "<redacted>");
  }
  return parsed.toString();
}

function isMain(): boolean {
  const entry = process.argv[1];
  return Boolean(entry && import.meta.url === pathToFileURL(entry).href);
}

if (isMain()) {
  runEnableAppCards(process.argv.slice(2)).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
