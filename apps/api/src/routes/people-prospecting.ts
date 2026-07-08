import {
  creditLedger,
  type Database,
  peopleProspectingCandidates,
  peopleProspectingRuns,
  providerConfig,
  tenantUsers,
  usageEvents,
} from "@hap/db";
import { and, eq, gte, inArray } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import { decryptProviderKey } from "../lib/encryption.js";
import type { TenantVariables } from "../middleware/tenant.js";

type Vars = TenantVariables & { userId?: string };

const PEOPLE_ACCEPTED_CONTACT_CREDIT_COST = 4;
const MAX_PROSPECTING_CONTACTS = 50;

const SOURCE_MODES = new Set(["apollo_harvest", "apollo_only", "harvest_only", "hubspot_first"]);

type SourceMode = "apollo_harvest" | "apollo_only" | "harvest_only" | "hubspot_first";

type ProspectingFilters = {
  titles?: string[];
  seniorities?: string[];
  personLocations?: string[];
  organizationLocations?: string[];
  organizationDomains?: string[];
  organizationIds?: string[];
  emailStatuses?: string[];
  employeeRanges?: string[];
  revenueRange?: { min?: number; max?: number };
  technologies?: string[];
  keywords?: string;
  linkedinCompanyUrl?: string;
  harvest?: {
    search?: string;
    currentCompany?: string;
    location?: string;
    postedOnLinkedIn?: boolean;
  };
};

export type PeopleProspectingCandidateDraft = {
  provider: "apollo" | "harvest" | "hubspot";
  providerPersonId?: string;
  hubspotContactId?: string;
  firstName?: string;
  lastName?: string;
  title?: string;
  company?: string;
  location?: string;
  linkedinUrl?: string;
  emailStatus?: string;
  requiredFieldCompleteness?: Record<string, unknown>;
  evidenceRefs?: unknown[];
  duplicateMatch?: Record<string, unknown>;
};

export type PeopleProspectingPreviewRequest = {
  tenantId: string;
  companyId: string;
  sourceMode: SourceMode;
  maxContacts: number;
  filters: ProspectingFilters;
  db: Database;
};

export type PeopleProspectingPreviewResult = {
  providerRequests: Record<string, unknown>;
  blockers: Record<string, unknown>;
  candidates: PeopleProspectingCandidateDraft[];
};

export type PeopleProspectingPreviewer = (
  request: PeopleProspectingPreviewRequest,
) => Promise<PeopleProspectingPreviewResult>;

type RoutesDeps = {
  previewer?: PeopleProspectingPreviewer;
};

type PreviewBody = {
  sourceMode?: unknown;
  maxContacts?: unknown;
  filters?: unknown;
};

type AcceptBody = {
  runId?: unknown;
  candidateIds?: unknown;
};

function normalizeCompanyId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 128) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}

async function parseJson(c: Context): Promise<unknown | null> {
  try {
    return await c.req.json();
  } catch {
    return null;
  }
}

function stringArray(raw: unknown): string[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const values = raw
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return values.length > 0 ? values : undefined;
}

function parseFilters(raw: unknown): ProspectingFilters {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const record = raw as Record<string, unknown>;
  const revenueRangeRaw = record.revenueRange;
  const harvestRaw = record.harvest;
  const revenueRange =
    revenueRangeRaw && typeof revenueRangeRaw === "object" && !Array.isArray(revenueRangeRaw)
      ? (revenueRangeRaw as { min?: number; max?: number })
      : undefined;
  const harvest =
    harvestRaw && typeof harvestRaw === "object" && !Array.isArray(harvestRaw)
      ? (harvestRaw as ProspectingFilters["harvest"])
      : undefined;
  return {
    titles: stringArray(record.titles),
    seniorities: stringArray(record.seniorities),
    personLocations: stringArray(record.personLocations),
    organizationLocations: stringArray(record.organizationLocations),
    organizationDomains: stringArray(record.organizationDomains),
    organizationIds: stringArray(record.organizationIds),
    emailStatuses: stringArray(record.emailStatuses),
    employeeRanges: stringArray(record.employeeRanges),
    technologies: stringArray(record.technologies),
    keywords: typeof record.keywords === "string" ? record.keywords.trim() : undefined,
    linkedinCompanyUrl:
      typeof record.linkedinCompanyUrl === "string" ? record.linkedinCompanyUrl.trim() : undefined,
    revenueRange,
    harvest,
  };
}

function parsePreviewBody(raw: PreviewBody): {
  sourceMode: SourceMode;
  maxContacts: number;
  filters: ProspectingFilters;
} | null {
  const sourceModeRaw = typeof raw.sourceMode === "string" ? raw.sourceMode : "apollo_harvest";
  if (!SOURCE_MODES.has(sourceModeRaw)) return null;
  if (!Number.isInteger(raw.maxContacts)) return null;
  const maxContacts = Number(raw.maxContacts);
  if (maxContacts < 1 || maxContacts > MAX_PROSPECTING_CONTACTS) return null;
  return {
    sourceMode: sourceModeRaw as SourceMode,
    maxContacts,
    filters: parseFilters(raw.filters),
  };
}

function parseAcceptBody(raw: AcceptBody): { runId: string; candidateIds: string[] } | null {
  if (typeof raw.runId !== "string" || raw.runId.trim().length === 0) return null;
  if (!Array.isArray(raw.candidateIds)) return null;
  const candidateIds = raw.candidateIds
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (candidateIds.length === 0 || candidateIds.length > MAX_PROSPECTING_CONTACTS) return null;
  if (new Set(candidateIds).size !== candidateIds.length) return null;
  return { runId: raw.runId.trim(), candidateIds };
}

function usesApollo(sourceMode: SourceMode): boolean {
  return sourceMode === "apollo_harvest" || sourceMode === "apollo_only";
}

function usesHarvest(sourceMode: SourceMode): boolean {
  return sourceMode === "apollo_harvest" || sourceMode === "harvest_only";
}

function appendAll(params: URLSearchParams, key: string, values: string[] | undefined): void {
  for (const value of values ?? []) params.append(key, value);
}

function compactString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function extractArray(raw: unknown, keys: string[]): Record<string, unknown>[] {
  const root = asRecord(raw);
  for (const key of keys) {
    const value = root[key];
    if (Array.isArray(value)) return value.map(asRecord);
  }
  const data = asRecord(root.data);
  for (const key of keys) {
    const value = data[key];
    if (Array.isArray(value)) return value.map(asRecord);
  }
  if (Array.isArray(root.elements)) return root.elements.map(asRecord);
  if (Array.isArray(root.results)) return root.results.map(asRecord);
  return [];
}

async function loadProviderKey(
  db: Database,
  tenantId: string,
  providerName: string,
): Promise<string | null> {
  const [row] = await db
    .select({
      enabled: providerConfig.enabled,
      apiKeyEncrypted: providerConfig.apiKeyEncrypted,
    })
    .from(providerConfig)
    .where(
      and(eq(providerConfig.tenantId, tenantId), eq(providerConfig.providerName, providerName)),
    )
    .limit(1);
  if (!row?.enabled || !row.apiKeyEncrypted) return null;
  return decryptProviderKey(tenantId, row.apiKeyEncrypted);
}

async function fetchJson(url: URL, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  if (!response.ok) {
    throw new Error(`provider_request_failed:${response.status}`);
  }
  return await response.json();
}

async function searchApolloPeople(args: {
  apiKey: string;
  filters: ProspectingFilters;
  maxContacts: number;
}): Promise<PeopleProspectingCandidateDraft[]> {
  const url = new URL("https://api.apollo.io/api/v1/mixed_people/api_search");
  const params = url.searchParams;
  appendAll(params, "person_titles[]", args.filters.titles);
  appendAll(params, "person_seniorities[]", args.filters.seniorities);
  appendAll(params, "person_locations[]", args.filters.personLocations);
  appendAll(params, "organization_locations[]", args.filters.organizationLocations);
  appendAll(params, "q_organization_domains_list[]", args.filters.organizationDomains);
  appendAll(params, "organization_ids[]", args.filters.organizationIds);
  appendAll(params, "contact_email_status[]", args.filters.emailStatuses);
  appendAll(params, "organization_num_employees_ranges[]", args.filters.employeeRanges);
  appendAll(params, "currently_using_any_of_technology_uids[]", args.filters.technologies);
  if (args.filters.keywords) params.set("q_keywords", args.filters.keywords);
  if (typeof args.filters.revenueRange?.min === "number") {
    params.set("revenue_range[min]", String(args.filters.revenueRange.min));
  }
  if (typeof args.filters.revenueRange?.max === "number") {
    params.set("revenue_range[max]", String(args.filters.revenueRange.max));
  }
  params.set("page", "1");
  params.set("per_page", String(Math.min(args.maxContacts, 100)));

  const raw = await fetchJson(url, {
    method: "POST",
    headers: {
      accept: "application/json",
      Authorization: `Bearer ${args.apiKey}`,
    },
  });
  return extractArray(raw, ["people", "contacts"])
    .slice(0, args.maxContacts)
    .map((person) => ({
      provider: "apollo",
      providerPersonId: compactString(person.id) ?? compactString(person.person_id),
      firstName: compactString(person.first_name) ?? compactString(person.firstName),
      lastName: compactString(person.last_name) ?? compactString(person.lastName),
      title: compactString(person.title) ?? compactString(person.headline),
      company:
        compactString(person.organization_name) ??
        compactString(asRecord(person.organization).name) ??
        compactString(person.company),
      location:
        compactString(person.city) ??
        compactString(person.state) ??
        compactString(person.country) ??
        compactString(person.location),
      linkedinUrl: compactString(person.linkedin_url) ?? compactString(person.linkedinUrl),
      emailStatus: compactString(person.email_status) ?? compactString(person.emailStatus),
      requiredFieldCompleteness: {
        firstName: !!(compactString(person.first_name) ?? compactString(person.firstName)),
        lastName: !!(compactString(person.last_name) ?? compactString(person.lastName)),
        title: !!(compactString(person.title) ?? compactString(person.headline)),
        linkedinUrl: !!(compactString(person.linkedin_url) ?? compactString(person.linkedinUrl)),
      },
    }));
}

async function searchHarvestProfiles(args: {
  apiKey: string;
  filters: ProspectingFilters;
  maxContacts: number;
}): Promise<PeopleProspectingCandidateDraft[]> {
  const url = new URL("https://api.harvest-api.com/linkedin/profile-search");
  const search =
    args.filters.harvest?.search ??
    args.filters.keywords ??
    args.filters.titles?.[0] ??
    args.filters.seniorities?.[0];
  if (search) url.searchParams.set("search", search);
  const company = args.filters.harvest?.currentCompany ?? args.filters.linkedinCompanyUrl;
  if (company) url.searchParams.set("currentCompany", company);
  const location = args.filters.harvest?.location ?? args.filters.personLocations?.[0];
  if (location) url.searchParams.set("location", location);
  url.searchParams.set("page", "1");

  const raw = await fetchJson(url, {
    method: "GET",
    headers: {
      accept: "application/json",
      "X-API-Key": args.apiKey,
    },
  });
  return extractArray(raw, ["elements", "profiles", "items"])
    .slice(0, args.maxContacts)
    .map((person) => ({
      provider: "harvest",
      providerPersonId: compactString(person.id) ?? compactString(person.profileId),
      firstName: compactString(person.firstName) ?? compactString(person.first_name),
      lastName: compactString(person.lastName) ?? compactString(person.last_name),
      title: compactString(person.headline) ?? compactString(person.title),
      company: compactString(person.companyName) ?? compactString(person.company),
      location: compactString(person.location),
      linkedinUrl: compactString(person.linkedinUrl) ?? compactString(person.url),
      evidenceRefs: [
        {
          type: "linkedin_profile",
          url: compactString(person.linkedinUrl) ?? compactString(person.url),
        },
      ].filter((ref) => ref.url),
    }));
}

async function defaultPreviewer(
  request: PeopleProspectingPreviewRequest,
): Promise<PeopleProspectingPreviewResult> {
  const blockers: Record<string, unknown> = {};
  const providerRequests: Record<string, unknown> = {};
  const candidates: PeopleProspectingCandidateDraft[] = [];

  if (usesApollo(request.sourceMode)) {
    providerRequests.apollo = {
      endpoint: "POST https://api.apollo.io/api/v1/mixed_people/api_search",
      creditPolicy: "preview_zero_app_credits",
    };
    const apiKey = await loadProviderKey(request.db, request.tenantId, "apollo");
    if (!apiKey) {
      blockers.apollo = "not_configured";
    } else {
      try {
        candidates.push(
          ...(await searchApolloPeople({
            apiKey,
            filters: request.filters,
            maxContacts: request.maxContacts,
          })),
        );
      } catch (error) {
        blockers.apollo = error instanceof Error ? error.message : "provider_request_failed";
      }
    }
  }

  if (usesHarvest(request.sourceMode)) {
    providerRequests.harvest = {
      endpoint: "GET https://api.harvest-api.com/linkedin/profile-search",
      creditPolicy: "preview_zero_app_credits",
    };
    const apiKey = await loadProviderKey(request.db, request.tenantId, "harvest");
    if (!apiKey) {
      blockers.harvest = "not_configured";
    } else {
      try {
        candidates.push(
          ...(await searchHarvestProfiles({
            apiKey,
            filters: request.filters,
            maxContacts: request.maxContacts,
          })),
        );
      } catch (error) {
        blockers.harvest = error instanceof Error ? error.message : "provider_request_failed";
      }
    }
  }

  return {
    providerRequests,
    blockers,
    candidates: candidates.slice(0, request.maxContacts),
  };
}

async function getCurrentBalance(db: Database, tenantId: string): Promise<number> {
  const rows = await db.select().from(creditLedger).where(eq(creditLedger.tenantId, tenantId));
  return rows.reduce((sum, row) => sum + row.deltaCredits, 0);
}

function windowStart(period: "daily" | "weekly" | "monthly"): Date {
  const now = new Date();
  if (period === "daily") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  if (period === "weekly") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = start.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setUTCDate(start.getUTCDate() - diff);
    return start;
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function creditsUsedSince(
  db: Database,
  tenantId: string,
  hubspotUserId: string,
  since: Date,
): Promise<number> {
  const rows = await db
    .select()
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.tenantId, tenantId),
        eq(usageEvents.hubspotUserId, hubspotUserId),
        gte(usageEvents.createdAt, since),
      ),
    );
  return rows.reduce((sum, row) => sum + row.credits, 0);
}

async function validateActorBudget(
  db: Database,
  tenantId: string,
  hubspotUserId: string,
  projectedCredits: number,
): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const [user] = await db
    .select()
    .from(tenantUsers)
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.hubspotUserId, hubspotUserId)))
    .limit(1);

  if (!user) {
    return { ok: false, error: "app_user_not_configured", detail: "tenant user is not configured" };
  }
  if (!user.appAccessEnabled) {
    return { ok: false, error: "app_access_disabled", detail: "tenant user access is disabled" };
  }
  if (user.uncapped || projectedCredits === 0) return { ok: true };

  const caps = [
    { period: "daily" as const, cap: user.dailyCreditCap },
    { period: "weekly" as const, cap: user.weeklyCreditCap },
    { period: "monthly" as const, cap: user.monthlyCreditCap },
  ];

  for (const { period, cap } of caps) {
    if (cap === null || cap === undefined) continue;
    const used = await creditsUsedSince(db, tenantId, hubspotUserId, windowStart(period));
    if (used + projectedCredits > cap) {
      return {
        ok: false,
        error: "rep_credit_cap_exceeded",
        detail: `${period} credit cap exceeded`,
      };
    }
  }
  return { ok: true };
}

export function createPeopleProspectingRoutes(deps: RoutesDeps = {}) {
  const routes = new Hono<{ Variables: Vars }>();
  const previewer = deps.previewer ?? defaultPreviewer;

  routes.post("/:companyId/prospect/preview", async (c) => {
    const tenantId = c.get("tenantId");
    const hubspotUserId = c.get("userId");
    const db = c.get("db");
    const companyId = normalizeCompanyId(c.req.param("companyId"));
    if (!tenantId || !db) return c.json({ error: "tenant_context_missing" }, 500);
    if (!companyId) return c.json({ error: "invalid_company_id" }, 400);

    const raw = await parseJson(c);
    if (!raw) return c.json({ error: "invalid_json" }, 400);
    const parsed = parsePreviewBody(raw as PreviewBody);
    if (!parsed) return c.json({ error: "invalid_people_prospecting_preview_request" }, 400);

    const result = await previewer({
      tenantId,
      companyId,
      sourceMode: parsed.sourceMode,
      maxContacts: parsed.maxContacts,
      filters: parsed.filters,
      db,
    });
    const projectedCreditMax = parsed.maxContacts * PEOPLE_ACCEPTED_CONTACT_CREDIT_COST;
    const [run] = await db
      .insert(peopleProspectingRuns)
      .values({
        tenantId,
        companyId,
        requestedByHubspotUserId: hubspotUserId,
        sourceMode: parsed.sourceMode,
        maxContacts: parsed.maxContacts,
        filters: parsed.filters,
        providerRequests: result.providerRequests,
        blockerState: result.blockers,
        status: Object.keys(result.blockers).length > 0 ? "blocked" : "previewed",
        projectedCreditMin: 0,
        projectedCreditMax,
      })
      .returning();
    if (!run) return c.json({ error: "people_prospecting_run_create_failed" }, 500);

    const insertedCandidates =
      result.candidates.length > 0
        ? await db
            .insert(peopleProspectingCandidates)
            .values(
              result.candidates.map((candidate) => ({
                tenantId,
                runId: run.id,
                provider: candidate.provider,
                providerPersonId: candidate.providerPersonId,
                hubspotContactId: candidate.hubspotContactId,
                firstName: candidate.firstName,
                lastName: candidate.lastName,
                title: candidate.title,
                company: candidate.company,
                location: candidate.location,
                linkedinUrl: candidate.linkedinUrl,
                emailStatus: candidate.emailStatus,
                requiredFieldCompleteness: candidate.requiredFieldCompleteness ?? {},
                evidenceRefs: candidate.evidenceRefs ?? [],
                duplicateMatch: candidate.duplicateMatch ?? {},
              })),
            )
            .returning()
        : [];

    await db.insert(usageEvents).values({
      tenantId,
      hubspotUserId,
      actionType: "people_prospecting_preview",
      entityRef: `company:${companyId}`,
      projectedCredits: projectedCreditMax,
      credits: 0,
      result: Object.keys(result.blockers).length > 0 ? "blocked" : "previewed",
      metadata: {
        sourceMode: parsed.sourceMode,
        maxContacts: parsed.maxContacts,
        providerRequests: result.providerRequests,
        blockers: result.blockers,
      },
    });

    return c.json(
      {
        runId: run.id,
        companyId,
        sourceMode: parsed.sourceMode,
        projectedCredits: { min: 0, max: projectedCreditMax },
        providerRequests: result.providerRequests,
        blockers: result.blockers,
        candidates: insertedCandidates,
      },
      200,
    );
  });

  routes.post("/:companyId/prospect/accept", async (c) => {
    const tenantId = c.get("tenantId");
    const hubspotUserId = c.get("userId");
    const db = c.get("db");
    const companyId = normalizeCompanyId(c.req.param("companyId"));
    if (!tenantId || !db) return c.json({ error: "tenant_context_missing" }, 500);
    if (!hubspotUserId) return c.json({ error: "user_context_missing" }, 401);
    if (!companyId) return c.json({ error: "invalid_company_id" }, 400);

    const raw = await parseJson(c);
    if (!raw) return c.json({ error: "invalid_json" }, 400);
    const parsed = parseAcceptBody(raw as AcceptBody);
    if (!parsed) return c.json({ error: "invalid_people_prospecting_accept_request" }, 400);

    const [run] = await db
      .select()
      .from(peopleProspectingRuns)
      .where(
        and(
          eq(peopleProspectingRuns.tenantId, tenantId),
          eq(peopleProspectingRuns.companyId, companyId),
          eq(peopleProspectingRuns.id, parsed.runId),
        ),
      )
      .limit(1);
    if (!run) return c.json({ error: "prospecting_run_not_found" }, 404);
    if (run.debitedCredits > 0) return c.json({ error: "prospecting_run_already_debited" }, 409);

    const candidates = await db
      .select()
      .from(peopleProspectingCandidates)
      .where(
        and(
          eq(peopleProspectingCandidates.tenantId, tenantId),
          eq(peopleProspectingCandidates.runId, parsed.runId),
          inArray(peopleProspectingCandidates.id, parsed.candidateIds),
        ),
      );
    if (candidates.length !== parsed.candidateIds.length) {
      return c.json({ error: "candidate_selection_invalid" }, 400);
    }

    const acceptedCount = candidates.length;
    const debitedCredits = acceptedCount * PEOPLE_ACCEPTED_CONTACT_CREDIT_COST;
    const metadata = {
      runId: parsed.runId,
      companyId,
      acceptedCount,
      candidateIds: parsed.candidateIds,
      unitCredits: PEOPLE_ACCEPTED_CONTACT_CREDIT_COST,
    };
    const actorBudget = await validateActorBudget(db, tenantId, hubspotUserId, debitedCredits);
    if (!actorBudget.ok) {
      await db.insert(usageEvents).values({
        tenantId,
        hubspotUserId,
        actionType: "people_prospecting_accept",
        entityRef: `company:${companyId}`,
        projectedCredits: debitedCredits,
        credits: 0,
        result: actorBudget.error,
        metadata,
      });
      return c.json(actorBudget, 403);
    }

    const currentBalance = await getCurrentBalance(db, tenantId);
    if (currentBalance < debitedCredits) {
      await db.insert(usageEvents).values({
        tenantId,
        hubspotUserId,
        actionType: "people_prospecting_accept",
        entityRef: `company:${companyId}`,
        projectedCredits: debitedCredits,
        credits: 0,
        result: "insufficient_credits",
        metadata: { ...metadata, currentBalance },
      });
      return c.json({ error: "insufficient_credits", currentBalance }, 402);
    }

    const balanceAfter = currentBalance - debitedCredits;
    await db.insert(creditLedger).values({
      tenantId,
      hubspotUserId,
      actionType: "people_prospecting_accept",
      entityRef: `company:${companyId}`,
      deltaCredits: -debitedCredits,
      balanceAfter,
      reason: "Accepted usable People prospecting contacts",
      metadata,
    });
    await db.insert(usageEvents).values({
      tenantId,
      hubspotUserId,
      actionType: "people_prospecting_accept",
      entityRef: `company:${companyId}`,
      projectedCredits: debitedCredits,
      credits: debitedCredits,
      result: "debited",
      metadata: { ...metadata, balanceAfter },
    });

    await db
      .update(peopleProspectingCandidates)
      .set({ status: "accepted", acceptedAt: new Date() })
      .where(
        and(
          eq(peopleProspectingCandidates.tenantId, tenantId),
          eq(peopleProspectingCandidates.runId, parsed.runId),
          inArray(peopleProspectingCandidates.id, parsed.candidateIds),
        ),
      );
    await db
      .update(peopleProspectingRuns)
      .set({
        status: "accepted",
        debitedCredits,
        completedAt: new Date(),
      })
      .where(
        and(
          eq(peopleProspectingRuns.tenantId, tenantId),
          eq(peopleProspectingRuns.companyId, companyId),
          eq(peopleProspectingRuns.id, parsed.runId),
        ),
      );

    return c.json(
      {
        runId: parsed.runId,
        companyId,
        acceptedCount,
        debitedCredits,
        balanceAfter,
      },
      200,
    );
  });

  return routes;
}
