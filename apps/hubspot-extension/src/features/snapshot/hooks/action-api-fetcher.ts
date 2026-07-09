import { hubspot } from "@hubspot/ui-extensions";
import { DEFAULT_FETCH_TIMEOUT_MS, resolveApiBaseUrl } from "./api-fetcher";

type JsonBody = Record<string, unknown>;

export type PeopleProspectingPreviewRequest = {
  sourceMode: "apollo_harvest" | "apollo_only" | "harvest_only" | "hubspot_first";
  maxContacts: number;
  filters?: {
    titles?: string[];
    seniorities?: string[];
    personLocations?: string[];
    organizationLocations?: string[];
    organizationDomains?: string[];
  };
};

export type PeopleProspectingCandidate = {
  id: string;
  provider: string;
  firstName?: string | null;
  lastName?: string | null;
  title?: string | null;
  company?: string | null;
  location?: string | null;
  linkedinUrl?: string | null;
  emailStatus?: string | null;
};

export type PeopleProspectingPreviewResponse = {
  runId: string;
  companyId: string;
  projectedCredits: { min: number; max: number };
  blockers: Record<string, unknown>;
  candidates: PeopleProspectingCandidate[];
};

export type PeopleProspectingAcceptResponse = {
  runId: string;
  companyId: string;
  acceptedCount: number;
  debitedCredits: number;
  balanceAfter: number;
};

export type WoodpeckerCampaignSuggestionRequest = {
  angleKey?: string;
  signalKey?: string;
  signalHeadline?: string;
  channelVariant?: string;
};

export type WoodpeckerCampaignSuggestion = {
  id: string;
  externalCampaignId?: string | null;
  name: string;
  status: string;
  angleKey?: string | null;
  signalKey?: string | null;
  signalHeadline?: string | null;
  channelVariant: string;
  matchReason: string;
  score: number;
};

export type WoodpeckerCampaignSuggestionsResponse = {
  companyId: string;
  recommendedCampaignId: string | null;
  campaigns: WoodpeckerCampaignSuggestion[];
  allCampaigns: WoodpeckerCampaignSuggestion[];
  defaultAction: string;
};

export type WoodpeckerCampaignMemberRequest = {
  campaignId?: string;
  createNewCampaign?: boolean;
  personKey: string;
  contactId?: string;
  draftId?: string;
  snippets?: Record<string, unknown>;
  customFields?: Record<string, unknown>;
};

export type WoodpeckerCampaignMemberResponse = {
  campaignId: string;
  memberId?: string;
  reusedExistingCampaign: boolean;
  createdCampaign: boolean;
  exportStatus: string;
};

export type AccountActionApi = {
  previewPeople(
    companyId: string,
    body: PeopleProspectingPreviewRequest,
  ): Promise<PeopleProspectingPreviewResponse>;
  acceptPeople(
    companyId: string,
    body: { runId: string; candidateIds: string[] },
  ): Promise<PeopleProspectingAcceptResponse>;
  suggestWoodpeckerCampaigns(
    companyId: string,
    body: WoodpeckerCampaignSuggestionRequest,
  ): Promise<WoodpeckerCampaignSuggestionsResponse>;
  addWoodpeckerCampaignMember(
    companyId: string,
    body: WoodpeckerCampaignMemberRequest,
  ): Promise<WoodpeckerCampaignMemberResponse>;
};

export type AccountActionApiDeps = {
  baseUrl?: string;
  timeoutMs?: number;
};

export class AccountActionApiError extends Error {
  public readonly status: number;
  public readonly statusText: string;

  constructor(status: number, statusText: string) {
    super(`account-action-fetch-failed: ${status} ${statusText}`);
    this.name = "AccountActionApiError";
    this.status = status;
    this.statusText = statusText;
  }
}

async function postJson<T>(url: string, body: JsonBody, timeoutMs: number): Promise<T> {
  const response = await hubspot.fetch(url, {
    method: "POST",
    body,
    timeout: timeoutMs,
  });
  if (!response.ok) {
    throw new AccountActionApiError(response.status, response.statusText);
  }
  return (await response.json()) as T;
}

export function createAccountActionApi(deps: AccountActionApiDeps = {}): AccountActionApi {
  const baseUrl = deps.baseUrl ?? resolveApiBaseUrl();
  const timeoutMs = deps.timeoutMs ?? DEFAULT_FETCH_TIMEOUT_MS;

  return {
    previewPeople(companyId, body) {
      return postJson<PeopleProspectingPreviewResponse>(
        `${baseUrl}/api/people/${companyId}/prospect/preview`,
        body,
        timeoutMs,
      );
    },
    acceptPeople(companyId, body) {
      return postJson<PeopleProspectingAcceptResponse>(
        `${baseUrl}/api/people/${companyId}/prospect/accept`,
        body,
        timeoutMs,
      );
    },
    suggestWoodpeckerCampaigns(companyId, body) {
      return postJson<WoodpeckerCampaignSuggestionsResponse>(
        `${baseUrl}/api/outreach/${companyId}/woodpecker/campaigns/suggestions`,
        body,
        timeoutMs,
      );
    },
    addWoodpeckerCampaignMember(companyId, body) {
      return postJson<WoodpeckerCampaignMemberResponse>(
        `${baseUrl}/api/outreach/${companyId}/woodpecker/campaign-members`,
        body,
        timeoutMs,
      );
    },
  };
}
