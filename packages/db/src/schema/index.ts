import type { InferInsertModel, InferSelectModel } from "drizzle-orm";
import { companySignalMap } from "./company-signal-map.js";
import { evidence } from "./evidence.js";
import { llmConfig } from "./llm-config.js";
import { people } from "./people.js";
import { providerConfig } from "./provider-config.js";
import { signals } from "./signals.js";
import { signedRequestNonce } from "./signed-request-nonce.js";
import { snapshots } from "./snapshots.js";
import { tenantHubspotOauth } from "./tenant-hubspot-oauth.js";
import { tenants } from "./tenants.js";
import { trigifyMonitors } from "./trigify-monitors.js";

export {
  companySignalMap,
  evidence,
  llmConfig,
  people,
  providerConfig,
  signals,
  signedRequestNonce,
  snapshots,
  tenantHubspotOauth,
  tenants,
  trigifyMonitors,
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
