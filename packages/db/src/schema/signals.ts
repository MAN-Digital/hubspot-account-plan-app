import { sql } from "drizzle-orm";
import {
  boolean,
  index,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { tenants } from "./tenants.js";

/**
 * `signals` — the persisted, normalized Trigify signal store.
 *
 * Mirrors OpenClaw's `signal_records` table (see
 * `.../outreach-engine/signal_store.py`). This is the substrate the poller
 * writes to and the `TrigifyStoreAdapter` reads from; it is NOT the wire-level
 * `Evidence` type (see `packages/config/src/domain-types.ts`) — mapping
 * between the two happens in the adapter/normalize layer.
 *
 * Column notes:
 * - `dedupeKey` is UNIQUE PER TENANT (composite unique with `tenantId`, not a
 *   bare unique column) so two tenants monitoring the same public LinkedIn
 *   post do not collide, and the poller can safely upsert-on-conflict.
 * - `signalClass` is `"observable" | "derived"` — the hard fidelity
 *   invariant from `references/signal-types.md`: derived signals are
 *   prioritization-only and must never be asserted in copy.
 * - `tier` is `"A" | "B" | "C"` per the signal-types taxonomy.
 * - `level` is `"person" | "company"` — Trigify signals fire at either level.
 * - `copyAssertable` defaults to `true`; the normalize step (Task 5) sets it
 *   to `false` for every row in the derived set, independent of `tier`.
 * - `confidence` uses `mode: "number"` for the same reason as `evidence.ts`
 *   — without it Drizzle returns a string and downstream comparisons
 *   (`confidence >= minConfidence`) silently coerce.
 * - `allowedClaims` is a jsonb array of structured claims the reason-generator
 *   is permitted to assert for this signal (empty array = no structured
 *   claims beyond the headline).
 * - `raw` is the raw normalized feed item (jsonb) for audit/debugging.
 */
export const signals = pgTable(
  "signals",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    dedupeKey: text("dedupe_key").notNull(),
    source: text("source").notNull(),
    stream: text("stream").notNull(),
    signalType: text("signal_type").notNull(),
    signalClass: text("signal_class").notNull(),
    tier: text("tier").notNull(),
    level: text("level").notNull(),
    targetId: text("target_id").notNull(),
    linkedinUrl: text("linkedin_url"),
    hsContactId: text("hs_contact_id"),
    hsCompanyId: text("hs_company_id"),
    evidenceUrl: text("evidence_url"),
    evidenceDate: timestamp("evidence_date", { withTimezone: true }),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull().defaultNow(),
    allowedClaims: jsonb("allowed_claims").notNull().default(sql`'[]'::jsonb`),
    copyAssertable: boolean("copy_assertable").notNull().default(true),
    headline: text("headline").notNull(),
    detail: text("detail"),
    // mode:"number" — see evidence.ts for why this must be explicit.
    confidence: numeric("confidence", { mode: "number" }).notNull(),
    raw: jsonb("raw").notNull().default(sql`'{}'::jsonb`),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("signals_tenant_dedupe_key_unique").on(table.tenantId, table.dedupeKey),
    index("signals_tenant_company_idx").on(table.tenantId, table.hsCompanyId),
    index("signals_tenant_contact_idx").on(table.tenantId, table.hsContactId),
    index("signals_tenant_observed_idx").on(table.tenantId, table.observedAt),
  ],
);
