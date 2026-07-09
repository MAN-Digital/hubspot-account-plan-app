import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import {
  accountDataGaps,
  accountGenerationLineItems,
  accountGenerationRuns,
  accountResearch,
} from "./account-research.js";
import { buyingGroups } from "./buying-groups.js";
import { companySignalMap } from "./company-signal-map.js";
import { billingTopups, creditLedger, usageEvents } from "./credits.js";
import { evidence } from "./evidence.js";
import { hubspotSignalRules } from "./hubspot-signal-rules.js";
import { llmConfig } from "./llm-config.js";
import {
  outreachAngles,
  outreachCampaignMembers,
  outreachCampaigns,
  outreachConfig,
  outreachDrafts,
} from "./outreach.js";
import { people } from "./people.js";
import { peopleProspectingCandidates, peopleProspectingRuns } from "./people-prospecting.js";
import { providerConfig } from "./provider-config.js";
import { signals } from "./signals.js";
import { signedRequestNonce } from "./signed-request-nonce.js";
import { snapshots } from "./snapshots.js";
import { tenantHubspotOauth } from "./tenant-hubspot-oauth.js";
import { tenantUsers } from "./tenant-users.js";
import { tenants } from "./tenants.js";
import { trigifyMonitors } from "./trigify-monitors.js";
import { warmIntros } from "./warm-intros.js";

export {
  accountDataGaps,
  accountGenerationLineItems,
  accountGenerationRuns,
  accountResearch,
  billingTopups,
  buyingGroups,
  companySignalMap,
  creditLedger,
  evidence,
  hubspotSignalRules,
  llmConfig,
  outreachAngles,
  outreachCampaignMembers,
  outreachCampaigns,
  outreachConfig,
  outreachDrafts,
  people,
  peopleProspectingCandidates,
  peopleProspectingRuns,
  providerConfig,
  signals,
  signedRequestNonce,
  snapshots,
  tenantHubspotOauth,
  tenants,
  tenantUsers,
  trigifyMonitors,
  usageEvents,
  warmIntros,
};

// Select (row) types
export type Tenant = InferSelectModel<typeof tenants>;
export type Snapshot = InferSelectModel<typeof snapshots>;
export type Evidence = InferSelectModel<typeof evidence>;
export type Person = InferSelectModel<typeof people>;
export type ProviderConfig = InferSelectModel<typeof providerConfig>;
export type LlmConfig = InferSelectModel<typeof llmConfig>;
export type TenantHubspotOauth = InferSelectModel<typeof tenantHubspotOauth>;
export type SignedRequestNonce = InferSelectModel<typeof signedRequestNonce>;
export type Signal = InferSelectModel<typeof signals>;
export type CompanySignalMap = InferSelectModel<typeof companySignalMap>;
export type TrigifyMonitor = InferSelectModel<typeof trigifyMonitors>;
export type TenantUser = InferSelectModel<typeof tenantUsers>;
export type UsageEvent = InferSelectModel<typeof usageEvents>;
export type CreditLedgerEntry = InferSelectModel<typeof creditLedger>;
export type BillingTopup = InferSelectModel<typeof billingTopups>;
export type AccountResearch = InferSelectModel<typeof accountResearch>;
export type AccountDataGap = InferSelectModel<typeof accountDataGaps>;
export type AccountGenerationRun = InferSelectModel<typeof accountGenerationRuns>;
export type AccountGenerationLineItem = InferSelectModel<typeof accountGenerationLineItems>;
export type PeopleProspectingRun = InferSelectModel<typeof peopleProspectingRuns>;
export type PeopleProspectingCandidate = InferSelectModel<typeof peopleProspectingCandidates>;
export type OutreachDraft = InferSelectModel<typeof outreachDrafts>;
export type OutreachCampaign = InferSelectModel<typeof outreachCampaigns>;
export type OutreachCampaignMember = InferSelectModel<typeof outreachCampaignMembers>;
export type OutreachConfig = InferSelectModel<typeof outreachConfig>;
export type OutreachAngle = InferSelectModel<typeof outreachAngles>;
export type BuyingGroup = InferSelectModel<typeof buyingGroups>;
export type HubspotSignalRule = InferSelectModel<typeof hubspotSignalRules>;
export type WarmIntro = InferSelectModel<typeof warmIntros>;

// Insert types
export type NewTenant = InferInsertModel<typeof tenants>;
export type NewSnapshot = InferInsertModel<typeof snapshots>;
export type NewEvidence = InferInsertModel<typeof evidence>;
export type NewPerson = InferInsertModel<typeof people>;
export type NewProviderConfig = InferInsertModel<typeof providerConfig>;
export type NewLlmConfig = InferInsertModel<typeof llmConfig>;
export type NewTenantHubspotOauth = InferInsertModel<typeof tenantHubspotOauth>;
export type NewSignedRequestNonce = InferInsertModel<typeof signedRequestNonce>;
export type NewSignal = InferInsertModel<typeof signals>;
export type NewCompanySignalMap = InferInsertModel<typeof companySignalMap>;
export type NewTrigifyMonitor = InferInsertModel<typeof trigifyMonitors>;
export type NewTenantUser = InferInsertModel<typeof tenantUsers>;
export type NewUsageEvent = InferInsertModel<typeof usageEvents>;
export type NewCreditLedgerEntry = InferInsertModel<typeof creditLedger>;
export type NewBillingTopup = InferInsertModel<typeof billingTopups>;
export type NewAccountResearch = InferInsertModel<typeof accountResearch>;
export type NewAccountDataGap = InferInsertModel<typeof accountDataGaps>;
export type NewAccountGenerationRun = InferInsertModel<typeof accountGenerationRuns>;
export type NewAccountGenerationLineItem = InferInsertModel<typeof accountGenerationLineItems>;
export type NewPeopleProspectingRun = InferInsertModel<typeof peopleProspectingRuns>;
export type NewPeopleProspectingCandidate = InferInsertModel<typeof peopleProspectingCandidates>;
export type NewOutreachDraft = InferInsertModel<typeof outreachDrafts>;
export type NewOutreachCampaign = InferInsertModel<typeof outreachCampaigns>;
export type NewOutreachCampaignMember = InferInsertModel<typeof outreachCampaignMembers>;
export type NewOutreachConfig = InferInsertModel<typeof outreachConfig>;
export type NewOutreachAngle = InferInsertModel<typeof outreachAngles>;
export type NewBuyingGroup = InferInsertModel<typeof buyingGroups>;
export type NewHubspotSignalRule = InferInsertModel<typeof hubspotSignalRules>;
export type NewWarmIntro = InferInsertModel<typeof warmIntros>;
