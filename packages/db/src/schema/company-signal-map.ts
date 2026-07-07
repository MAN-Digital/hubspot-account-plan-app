import { index, numeric, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * `company_signal_map` — LinkedIn company URL / domain → HubSpot company_id.
 *
 * Mirrors OpenClaw's `company_aliases` table
 * (`.../outreach-engine/signal_store.py`). This is the entity-resolution-lite
 * mapping `services/trigify/company-match.ts` (Task 5) reads and writes:
 * signals arrive keyed by LinkedIn URL/domain, but the crm.record.tab reads
 * by HubSpot `hs_company_id`, so a persisted alias avoids re-resolving via
 * the HubSpot search API on every poll.
 *
 * `confidence` (0..1) reflects how the match was made (e.g. exact domain
 * match vs fuzzy company-name search) so `company-match.ts` can decide
 * whether to trust an existing row or re-resolve. No fabricated matches —
 * unresolved signals simply have no row here.
 */
export const companySignalMap = pgTable(
  "company_signal_map",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    linkedinUrl: text("linkedin_url"),
    domain: text("domain"),
    hsCompanyId: text("hs_company_id").notNull(),
    // mode:"number" — see evidence.ts for why this must be explicit.
    confidence: numeric("confidence", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("company_signal_map_tenant_linkedin_idx").on(table.tenantId, table.linkedinUrl),
    index("company_signal_map_tenant_domain_idx").on(table.tenantId, table.domain),
    index("company_signal_map_tenant_company_idx").on(table.tenantId, table.hsCompanyId),
  ],
);
