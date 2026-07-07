import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { accountResearch } from "./account-research.js";
import { buyingGroups } from "./buying-groups.js";
import { companySignalMap } from "./company-signal-map.js";
import { creditLedger } from "./credit-ledger.js";
import { evidence } from "./evidence.js";
import { llmConfig } from "./llm-config.js";
import { notificationSettings } from "./notification-settings.js";
import { outreachConfig } from "./outreach-config.js";
import { outreachDrafts } from "./outreach-drafts.js";
import { people } from "./people.js";
import { providerConfig } from "./provider-config.js";
import { signals } from "./signals.js";
import { signedRequestNonce } from "./signed-request-nonce.js";
import { snapshots } from "./snapshots.js";
import { tenantHubspotOauth } from "./tenant-hubspot-oauth.js";
import { tenantUsers } from "./tenant-users.js";
import { tenants } from "./tenants.js";
import { trigifyMonitors } from "./trigify-monitors.js";
import { usageEvents } from "./usage-events.js";
import { warmIntros } from "./warm-intros.js";

export {
  accountResearch,
  buyingGroups,
  companySignalMap,
  creditLedger,
  evidence,
  llmConfig,
  notificationSettings,
  outreachConfig,
  outreachDrafts,
  people,
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
export type AccountResearch = InferSelectModel<typeof accountResearch>;
export type OutreachDraft = InferSelectModel<typeof outreachDrafts>;
export type OutreachConfig = InferSelectModel<typeof outreachConfig>;
export type BuyingGroup = InferSelectModel<typeof buyingGroups>;
export type NotificationSettings = InferSelectModel<typeof notificationSettings>;
export type TenantUser = InferSelectModel<typeof tenantUsers>;
export type CreditLedgerEntry = InferSelectModel<typeof creditLedger>;
export type UsageEvent = InferSelectModel<typeof usageEvents>;
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
export type NewAccountResearch = InferInsertModel<typeof accountResearch>;
export type NewOutreachDraft = InferInsertModel<typeof outreachDrafts>;
export type NewOutreachConfig = InferInsertModel<typeof outreachConfig>;
export type NewBuyingGroup = InferInsertModel<typeof buyingGroups>;
export type NewNotificationSettings = InferInsertModel<typeof notificationSettings>;
export type NewTenantUser = InferInsertModel<typeof tenantUsers>;
export type NewCreditLedgerEntry = InferInsertModel<typeof creditLedger>;
export type NewUsageEvent = InferInsertModel<typeof usageEvents>;
export type NewWarmIntro = InferInsertModel<typeof warmIntros>;
