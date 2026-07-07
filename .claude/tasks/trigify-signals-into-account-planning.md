# Plan: Add Trigify buying-intent signals into the HubSpot Signal-First Account Workspace

## Task Description

Integrate Trigify.io social buying-intent signals (and, as an optional later phase, the
Albacross web-visitor "context API") into the HubSpot Account Plan App so the
`crm.record.tab` on a company record can surface **one credible, evidence-backed reason to
contact this account now**, sourced from real LinkedIn/social signals rather than only
Exa/News search.

The logic already exists and is battle-tested in the **OpenClaw outreach-engine** (Python,
running inside an OrbStack Linux VM). The user wants that signal layer ported into the
HubSpot app — which is TypeScript/Hono/Drizzle/Postgres — so they can **install and start
using it** on live HubSpot company records. We are NOT porting OpenClaw's frontend or its
outreach/campaign machinery — only the signal ingestion, normalization, ranking, and
company-matching logic.

**Source locations (verified on this machine, inside the OrbStack VM):**

- Trigify skill: `/Users/romeoman/OrbStack/openclaw-vm/home/romeoman/openclaw-infra/runtime-workspace/live/skills/trigify/` (`SKILL.md`, `references/signal-types.md`, `trigify_client.py`)
- Outreach engine: `/Users/romeoman/OrbStack/openclaw-vm/home/romeoman/openclaw-infra/outreach-engine/` (signal pipeline)
- Ranking config: `/Users/romeoman/OrbStack/openclaw-vm/home/romeoman/openclaw-infra/config/trigify_signal_ranking.yaml`

> The user referenced these as `/home/romeoman/...` — that is the path **inside** the VM.
> From macOS they resolve under `/Users/romeoman/OrbStack/openclaw-vm/home/romeoman/...`.

**Session Type**: Development (feature) + partial Repo Port (the V2 expansion ports the
OpenClaw outreach pipeline and translates a Magic Patterns UI, so the Source UI/UX
Reference section below applies to the V2 workstreams).

**Scope update (2026-07-06):** the plan now covers TWO stages. **Stage A (tasks 1–11)**:
the Trigify signal substrate — unchanged. **Stage B (tasks 13–19, shared final
validation in task 20)**: the V2 expansion —
account workspace UI (Magic Patterns), on-demand account research, the ported outreach
engine (cadence → copy → QA, DRAFT-only), signal monitoring notifications, and a HubSpot
custom workflow action. Stage B is authorized by the upstream planning update at
`planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md`, which was **synced into the
ChatPRD cloud project on 2026-07-06** (project: "Account Planning in HubSpot",
https://app.chatprd.ai/drive/projects/1775585518010-account-planning-in-hubspot — see
the ChatPRD doc registry in the Notes section). The Stage B gate ("no build without
ChatPRD synced") is satisfied.

## Objective

When this plan is complete, a HubSpot user viewing a company record whose portal is
configured with a Trigify API key will see, in the `crm.record.tab`:

- the strongest **observable** buying-intent signal for that company/its people, rendered
  as the "reason to contact now" with a clickable **evidence URL + date**;
- up to 3 people tied to that reason (never fabricated);
- the correct QA state (eligible-strong / fewer-contacts / empty / stale / degraded /
  low-confidence / ineligible / restricted) driven by the ported tiered-ranking model;
- **never** a derived signal (buying-window / influence / expansion) asserted as a fact —
  derived signals only boost prioritization, exactly as in OpenClaw.

Operators can subscribe LinkedIn profiles/companies to monitor (a credit-spending action,
gated behind explicit confirmation) from a per-tenant settings surface, and a scheduled
poller keeps the signal store fresh from Trigify's free REST feed.

## Problem Statement

The HubSpot app's current signal sources are **Exa** and **News** — generic web search
that answers "what's been published about this company." That is weak evidence for
_timing_: it does not know a decision-maker just changed roles, started hiring, or posted
about a relevant problem. Trigify provides exactly that person-level, timestamped,
buying-intent signal across LinkedIn + 10 other channels, with a clean observable-vs-derived
contract that maps directly onto the app's existing evidence/trust/eligibility model.

Two structural mismatches must be solved:

1. **Pull model mismatch.** Exa/News are synchronous per-company pulls (`fetchSignals`
   queries the provider live for one company). Trigify is **feed/subscription-based**: you
   subscribe LinkedIn URLs, signals accrue over ~30 days, and you pull the _whole feed_
   for free. A live per-company Trigify call is neither how the API works nor free at
   monitor-creation time. So Trigify needs a **background poller + a persisted signal
   store**, and the adapter reads from that store. This is precisely OpenClaw's design
   (`trigify_poller.py` → `signal_store.py` → ranking reads the store).

2. **Signal metadata gap.** The app's `Evidence` type is flat
   (`source, timestamp, confidence, content, isRestricted`) and has no notion of
   `signal_type` / `signal_class` (observable vs derived) / `tier` / `copy_assertable`.
   Those are load-bearing: the whole point of Trigify's contract is that a derived signal
   may **never** be asserted in outbound copy and may never be the sole reason a target
   clears the send threshold. That invariant must survive the port. Concretely:
   `extractDominantSignal` (`apps/api/src/services/reason-generator.ts:32`) today selects
   purely by `confidence` + freshness — it has no concept of assertability, so without an
   explicit guard a derived signal with a high mapped confidence **would** become the
   reason-to-contact. The guard must be added there, not only in the adapter.

3. **Route wiring is single-provider.** `resolveSignalAdapter` in
   `apps/api/src/routes/snapshot.ts` probes `REAL_SIGNAL_PROVIDERS = ["exa"]` and takes the
   **first enabled match** — adding a `case "trigify"` to the factory is not enough; the
   probe list must include `"trigify"` AND the resolution must **compose** Trigify with
   Exa/News when both are enabled (the `composeSignalAdapters` helper for parallel fan-out
   - flatten already exists in that file). Otherwise a tenant with Exa enabled would never
     see a Trigify signal, or vice versa.

4. **The snapshot route still runs on fixtures.** `routes/snapshot.ts` injects
   `fixtureContactFetcher` (three hardcoded fake contacts) and picks the eligibility
   property fetcher from a `?eligibility=` query param instead of reading real CRM data —
   even though `HubSpotClient` already has `getCompanyProperties` (incl.
   `hs_is_target_account`), contact search (`/crm/v3/objects/contacts/search`), and
   company↔contact association endpoints. For the user's goal ("install and start using
   it"), wiring real fetchers is a prerequisite and is in scope as its own task.

## Solution Approach

Port OpenClaw's signal layer into the HubSpot app's **existing adapter + evidence +
snapshot pipeline**, reusing every seam that already exists and adding only what Trigify's
feed model structurally requires.

**Reuse (no new pattern invented):**

- `provider_config` already stores a per-tenant encrypted API key + `thresholds` +
  `settings` + `allowList`/`blockList`. A `provider_name = 'trigify'` row fits with zero
  schema change. (`packages/db/src/schema/provider-config.ts`)
- `ProviderAdapter { fetchSignals(tenantId, company) → Evidence[] }` and the
  `createSignalAdapter` factory switch are the exact plug-in point. A `TrigifyStoreAdapter`
  is a new `case "trigify"`. (`apps/api/src/adapters/signal/factory.ts`,
  `adapters/provider-adapter.ts`, template: `adapters/signal/exa.ts`)
- The snapshot assembler already runs fetch → dedup → staleness → trust/suppression →
  dominant-signal → reason → people. Trigify evidence flows through the same pipeline;
  the only assembler-adjacent change is the assertability guard in dominant-signal
  selection (see mismatch #2). (`apps/api/src/services/snapshot-assembler.ts`)
- Multi-provider composition already exists: `composeSignalAdapters` in
  `routes/snapshot.ts` fans out N wrapped adapters in parallel and flattens their
  evidence (it's how Exa + News run together today). Trigify joins that composition
  rather than replacing it.
- Vercel cron already exists with a `Bearer CRON_SECRET` auth pattern
  (`/admin/keep-alive`). The Trigify poller is a sibling cron endpoint.
  (`apps/api/vercel.json`, `apps/api/src/routes/admin/keep-alive.ts`)
- Per-tenant config resolution + AES-256-GCM key encryption + SSRF hardening + RLS via the
  `hap_app` role already exist and are reused verbatim.

**Add (only what Trigify's model requires):**

- A **`signals` table** (tenant-scoped) that is the persisted normalized signal store,
  mirroring OpenClaw `signal_records`: `dedupe_key`, `signal_type`, `signal_class`
  (observable/derived), `tier`, `level` (person/company), `target_linkedin_url`,
  `evidence_url`, `evidence_date`, `observed_at`, `copy_assertable`, `hs_company_id`,
  `headline`, `detail`, `confidence`, `raw`.
- A **`company_signal_map` table** mapping Trigify LinkedIn URL / domain → HubSpot
  `company_id` (mirrors OpenClaw `company_aliases`), so poller-ingested signals can be
  matched to the company record the tab is viewing.
- A **`trigify_monitors` table** tracking per-tenant subscriptions (the credit-spend
  ledger + dedup source), mirroring OpenClaw `monitors`.
- A **`TrigifyClient`** (TS port of `trigify_client.py`): Bearer auth, FREE reads
  (feed / subscriptions / usage / limits), and **guarded** writes (subscription create =
  credit spend, requires explicit `confirm`), routed through the app's SSRF-safe fetch.
- A **`TrigifyPoller`** (Vercel cron `/admin/trigify-poll`): for each tenant with an
  enabled Trigify provider row, pull the free feed, normalize each item to a signal record,
  match to a company, upsert into `signals` with dedup. Reads only → zero credit spend.
- A **signal-ranking service** (TS port of `signal_ranking.py` + the YAML): config-driven
  tier weights (A=1.00, B=0.65, C=0.30), send_threshold (default 0.60), recency/topic
  factors, why-you/why-me/why-now reasoning, and the **hard rule** that a derived signal
  alone never crosses the threshold. Wired into the existing `trust.ts` / dominant-signal
  selection so the ranking outcome drives the eligibility state.
- A **monitor-management surface** (gated subscribe/pause/delete) in settings, honoring the
  same spend gate discipline OpenClaw enforces (dry-run by default, explicit confirm,
  duplicate detection, budget ceiling).

**Config placement (verified against the code):** `ThresholdConfig` is exactly
`{ freshnessMaxDays, minConfidence }` (`packages/config/src/domain-types.ts:112`) and the
route validates a provider row's `thresholds` against that shape (`isValidThresholds`).
The Trigify ranking config (tier weights, `send_threshold`, reasoning weights, topic map,
derived set) therefore lives in the trigify row's **`settings`** JSONB — NOT in
`thresholds`. The trigify row's `thresholds` keeps the standard two-field shape (e.g.
`freshnessMaxDays: 30` to match the Trigify in-window semantics) so the existing
staleness/confidence machinery keeps working unmodified.

**Confidence mapping:** the assembler's dominant-signal pick and trust gates run on
`Evidence.confidence` (0..1). The `TrigifyStoreAdapter` maps each **observable** signal's
ranking contribution/strength into `confidence` so tier-A fresh signals naturally win the
dominance contest against Exa's flat 0.7 default; **derived** rows are emitted with
`copyAssertable: false` and a low confidence so they can inform trust/boost but can never
be selected (belt-and-braces with the `extractDominantSignal` guard).

**Fidelity requirements carried from the source (non-negotiable):**

- Observable signals may be asserted with `evidence_url + evidence_date`; derived
  (`T_Buying_Window`, `T_Influence`, `T_Expansion`, `T_Company_Jobs_Up`) are
  prioritization-only, `copy_assertable = false`, never the dominant signal.
- Reads are free; the ONLY credit-spend paths (subscription create) are gated behind
  explicit confirm + budget + dedup + audit log — never a silent spend.
- Tenant isolation at every layer: Trigify API keys, monitors, signals, and company maps
  are all `tenant_id`-scoped and RLS-protected. Never a cross-tenant read.
- API keys are per-tenant, encrypted at rest, decrypted only at point of use, never logged.

## Source UI/UX Reference

> Canonical UI for the V2 workspace: Magic Patterns design
> https://www.magicpatterns.com/c/xmdzva7bxdn4ubmtrbvs35 (editor id
> `xmdzva7bxdn4ubmtrbvs35`; use the **`v2/*` components** — v1 files are an earlier
> iteration). Read via the Magic Patterns MCP (`get_artifact` → `read_artifact_files`).

### Layout Patterns

- Single-column workspace, max-width ~1140px, HubSpot palette (#33475b text, #0091ae
  accents, #ff7a59 CTA orange, #cbd6e2 borders, #f5f8fa canvas).
- **Header bar**: company name + industry/location chips + domain link | stage chip +
  health chip | "Last synced" + Refresh button.
- **Tab nav**: Overview / People / Signals (count badge) / Plan / Context, active-tab
  underline.
- **Overview**: 4-stat strip (Deal Value, Stage, Active Contacts, Expected Close) →
  full-width "Why Now" callout (left-border accent, bulleted evidence) → 2-column grid:
  left = "Top Signals" table, right = "Recommended Next Move" card (orange left border,
  **Draft Outreach** button) + "Key People" list.

### Interaction Flows

- Clicking a signal row (Overview or Signals tab) opens its detail (headline, snippet,
  provenance chain, linked people with roles).
- Signals tab: source filter (All / External Only / CRM Only), type filter, free-text
  search; "CRM Gap" and "Data Quality" callouts surface hygiene findings.
- **Draft Outreach** on the Next Move card kicks off the outreach pipeline and lands the
  user on the generated DRAFT for review/approval.
- Refresh re-runs the snapshot; "Generate account research" (Context tab) runs the
  on-demand research and renders it with sources.

### Component Patterns

- Source badges on every signal (Exa.ai teal / HubSpot orange / Trigify) + relative time.
- Provenance chains as literal text: "Exa.ai → LinkedIn Jobs API → Datadog Careers Page".
- Person cards: role badge (Decision Maker / Champion / Technical Evaluator), CRM status
  (In CRM / External), reason-to-talk, bio, evidence line, per-person signals, LinkedIn
  link.
- Plan tab: event timeline (deal moves, signal milestones, CRM gaps) + "This week"
  actions + messaging guidance (Lead With / Anchor On / Avoid).
- Context tab: industry/platform/initiative/relevance grid, tracked topics, competitor +
  our-advantage, data-sources footer.

### Source Files to Read

- `v2/AppV2.tsx` → tab shell + state. `v2/HeaderV2.tsx` → header IA.
- `v2/TabNavV2.tsx` → nav + counts. `v2/OverviewTabV2.tsx` → stat strip, Why-Now, Top
  Signals table, Next Move card, Key People.
- `v2/SignalsTabV2.tsx` → filters, search, provenance, detail panel.
- `v2/PeopleTabV2.tsx` → person card anatomy. `v2/PlanTabV2.tsx` → timeline + messaging
  guidance. `v2/ContextTabV2.tsx` → research layout.

**Hard constraint:** the in-CRM tab renders `@hubspot/ui-extensions` components ONLY (no
Tailwind/lucide/raw HTML). The Magic Patterns code is the IA/visual reference to
TRANSLATE (Tile, Table, Tag, StatusTag, Statistics, Flex, Heading, Button, etc.); verify
a tabs-like component exists in the current SDK (fallback: ToggleGroup-driven sections).
The **hosted settings app** is a normal React app and may reuse the Magic Patterns
styling directly.

## Relevant Files

### Source reference (OpenClaw — read-only, for porting logic; do NOT modify)

- `.../runtime-workspace/live/skills/trigify/SKILL.md` — Trigify REST contract, endpoints, credit model, cadence/backfill facts.
- `.../runtime-workspace/live/skills/trigify/references/signal-types.md` — the canonical 16-signal → `trigger_code` map with observable/derived class + tier (A/B/C). **This is the source of truth for the signal taxonomy port.**
- `.../outreach-engine/trigify_client.py` — REST client to port to TS (auth, endpoints, write-guard).
- `.../outreach-engine/trigify_poller.py` — feed-pull loop + normalization to port to the poller.
- `.../outreach-engine/signal_processor.py` — raw-feed-item → normalized-signal transformation + enum-name → trigger_code mapping.
- `.../outreach-engine/signal_ranking.py` — the tiered strength/decision model to port to `signal-ranking.ts`.
- `.../outreach-engine/signal_store.py` — SQLite schema (`signal_records`, `rankings`, `suppressions`, `company_aliases`, `monitors`, `visits`, `web_visitors`); source for the Drizzle table shapes.
- `.../outreach-engine/trigify_monitors.py` — the credit-spend gate (dry-run, confirm, budget, dedup) to port to monitor management.
- `.../config/trigify_signal_ranking.yaml` — tier weights, send_threshold, reasoning weights, signal→tier map. Becomes the app's default Trigify threshold config.
- (Phase 8, optional) `.../outreach-engine/albacross_receiver.py`, `web_visitor_qualify.py`, `entity_resolution.py`, `guardrails.py` — the web-visitor "context API".

**Stage B source (OpenClaw skills at `.../runtime-workspace/live/skills/` — read-only):**

- `outreach-command/SKILL.md` — the pipeline orchestration contract: contacts → signal sourcing → cadence strategist → copywriter → copy QA → gated staging; **nothing ever sends**.
- `outreach-cadence-strategist/SKILL.md` — fit-grade contacts, ONE funnel stage, 5+ signal-led touches over ~12 days, framework + angle per touch (contract C2).
- `outreach-copywriter/SKILL.md` — per-touch copy honoring assigned framework/angle, per-contact openers on that contact's REAL signal, honest cold fallback, every claim traced to envelope proof (contract C3).
- `outreach-copy-qa/SKILL.md` — deterministic linter + judged dimensions: signal reality, framework fidelity, personalization depth, fabricated stats, links, channel style, deliverability; hard failure blocks (contract C4).
- `.../outreach-engine/outreach_envelope.py` + `envelope_runner.py` + `tests/test_envelope_contract.py` — the envelope shape (7 scalars + 10 JSON sections) and the whole-envelope-per-step proof to port as a contract test.
- `.../outreach-engine/positioning.py` + `content_library.py` — positioning/vocabulary loading (becomes tenant `outreach_config`).
- Reference-only (V2.5 candidates, NOT in scope): `apollo-api`, `harvestapi`, `woodpecker`, `icypeas`, `emailable` skills — prospecting/delivery providers.

### Target app — files to read before building

- `packages/db/src/schema/{snapshots,evidence,people,provider-config,tenants}.ts` — existing domain schema the signals attach to.
- `packages/config/src/domain-types.ts` — the `Evidence` / `Person` / `Snapshot` / `StateFlags` types (line 51+ for `Evidence`).
- `apps/api/src/adapters/provider-adapter.ts` — the `ProviderAdapter` interface Trigify must implement.
- `apps/api/src/adapters/signal/factory.ts` — `createSignalAdapter` switch + `wrapSignalWithGuards` (rate-limit + observability).
- `apps/api/src/adapters/signal/exa.ts` — the template adapter (error handling, tenant stamping, cassette-testability, no key in logs).
- `apps/api/src/services/snapshot-assembler.ts` — the assembly pipeline the signals flow through.
- `apps/api/src/services/{trust,eligibility,reason-generator,people-selector}.ts`, `services/hygiene/{dedup,staleness-sweeper}.ts` — where ranking/observable-only assertion must be honored.
- `apps/api/src/lib/config-resolver.ts` — `getProviderConfig` + `DEFAULT_THRESHOLDS`; how a `trigify` row is resolved & cached.
- `apps/api/src/routes/snapshot.ts` — how the snapshot route wires the adapter per request.
- `apps/api/src/routes/admin/keep-alive.ts` + `apps/api/vercel.json` — the cron auth pattern + crons array to extend.
- `apps/api/src/lib/{encryption,kek,hubspot-client}.ts` — key encryption + HubSpot CRM client (for company matching + people).
- `apps/api/src/routes/settings.ts` + `apps/hubspot-extension/src/` — settings backend + the tab UI states.

### New Files

- `packages/db/src/schema/signals.ts` — `signals` table (normalized Trigify signal store).
- `packages/db/src/schema/company-signal-map.ts` — LinkedIn/domain → HubSpot company mapping.
- `packages/db/src/schema/trigify-monitors.ts` — per-tenant subscription/monitor ledger.
- `packages/db/drizzle/<timestamp>_trigify_signals.sql` — generated migration incl. RLS policies for the `hap_app` role on the three new tables.
- `apps/api/src/adapters/signal/trigify-client.ts` — TS port of `trigify_client.py`.
- `apps/api/src/adapters/signal/trigify.ts` — `TrigifyStoreAdapter implements ProviderAdapter` (reads persisted signals → `Evidence[]`).
- `apps/api/src/services/trigify/normalize.ts` — raw feed item → signal record (enum → trigger_code, observable/derived, tier).
- `apps/api/src/services/trigify/signal-ranking.ts` — TS port of the ranking model + YAML defaults.
- `apps/api/src/services/trigify/poller.ts` — per-tenant feed pull + company match + upsert.
- `apps/api/src/services/trigify/company-match.ts` — LinkedIn/domain → HubSpot company resolution (entity-resolution-lite).
- `apps/api/src/services/trigify/monitor-manager.ts` — gated subscribe/pause/delete with dry-run/confirm/budget/dedup.
- `apps/api/src/routes/admin/trigify-poll.ts` — Vercel cron endpoint (Bearer CRON_SECRET).
- `apps/api/src/routes/settings-trigify.ts` — monitor CRUD + connection test for the settings surface.
- `packages/config/src/trigify-signal-types.ts` — the signal taxonomy constants (trigger codes, tiers, derived set).
- Tests colocated in `__tests__/` beside each new file (Vitest), with cassettes for the client.

**Stage B new files (summary — full list in PRD delta §6):**

- `packages/db/src/schema/{account-research,outreach-drafts,outreach-config,notification-settings}.ts` + migration.
- `apps/api/src/services/research/*`, `apps/api/src/services/outreach/{envelope,cadence,copywriter,copy-qa,pipeline}.ts`.
- `apps/api/src/routes/{research,outreach,workflow-action}.ts`.
- `apps/settings-web/*` — hosted settings app (own Vercel project).
- `apps/hubspot-extension/src/` tab components per the Source UI/UX Reference.
- `docs/notifications/*.md` — native-workflow notification recipes.

## Implementation Phases

### Phase 1: Foundation

Data model + config + the signal taxonomy constant. This stabilizes the state semantics
before any live provider call (per CLAUDE.md: fixture-backed first).

- Add the three Drizzle tables + migration + RLS policies for the `hap_app` role.
- Extend the `Evidence` domain type (or add a parallel `SignalEvidence` projection) with
  optional `signalType`, `signalClass`, `tier`, `copyAssertable`, `evidenceUrl`,
  `evidenceDate` so the observable/derived contract survives into the assembler.
- Port the signal-types taxonomy (`references/signal-types.md`) into a typed constant module.
- Define the Trigify ranking-config Zod schema (in `@hap/validators`) + in-code defaults
  seeded from `trigify_signal_ranking.yaml`; it is stored in the trigify
  `provider_config.settings` JSONB (the `thresholds` column keeps its locked
  `{freshnessMaxDays, minConfidence}` shape).

### Phase 2: Core Implementation

The client, ingestion, ranking, and adapter — all TDD, fixture/cassette-first.

- `TrigifyClient` (port `trigify_client.py`): FREE reads + guarded writes + SSRF-safe fetch.
- `normalize.ts`: feed item → signal record (enum-name → trigger_code, class, tier, evidence).
- `company-match.ts`: LinkedIn/domain → HubSpot company via `company_signal_map` + HubSpot search.
- `poller.ts` + `/admin/trigify-poll` cron: pull feed → normalize → match → upsert `signals`.
- `signal-ranking.ts` (port `signal_ranking.py` + YAML): tier weights, send_threshold,
  recency/topic, why-you/why-me/why-now, hard derived-alone rule.
- `TrigifyStoreAdapter`: read persisted signals for a company → `Evidence[]`, derived rows
  flagged non-assertable; register `case "trigify"` in `createSignalAdapter` AND add
  `"trigify"` to `REAL_SIGNAL_PROVIDERS` + compose with Exa/News via
  `composeSignalAdapters` in `resolveSignalAdapter`.
- Guard `extractDominantSignal` to skip `copyAssertable === false` evidence, and wire
  ranking so a derived-only company scores 0 and stays empty/monitor-only while an
  observable ≥ threshold yields eligible-strong.
- Replace the snapshot route's fixture property/contact fetchers with real
  HubSpot-backed fetchers (client methods already exist).

### Phase 3: Integration & Polish

Monitor management, settings, frontend, end-to-end validation on a real test portal.

- `monitor-manager.ts` + `settings-trigify.ts`: gated subscribe/pause/delete (dry-run
  default, confirm, budget ceiling, duplicate detection, audit log) + connection test.
- Settings UI: enter Trigify key, subscribe LinkedIn profiles/companies, choose cadence/topics.
- `crm.record.tab`: confirm the reason card renders the Trigify observable signal with
  evidence URL + date and that all 8 states render correctly from ranking outcomes.
- Populate a HubSpot test portal (per CLAUDE.md test-environment rule) with companies that
  exercise strong-evidence, fewer-than-3-contacts, empty, stale, degraded, low-confidence,
  ineligible, and restricted states, then validate end to end.

### Phase 5 (Stage B): Account workspace UI + hosted settings app

- Translate the Magic Patterns 5-tab design (see Source UI/UX Reference) into
  `@hubspot/ui-extensions` components on `crm.record.tab`; wire Overview/People/Signals
  to real snapshot + signal-store data; Plan/Context render explicit empty states until
  their data sources exist.
- Stand up `apps/settings-web` (hosted React settings app, Magic Patterns styling):
  provider keys (LLM/Exa/Trigify), Trigify monitors (spend-gated UI), outreach config
  (positioning/vocabulary/frameworks), notification toggles, plan/usage. The
  install-time experience routes here.

### Phase 6 (Stage B): Account research + outreach engine

- On-demand **account research**: `POST /api/research/:companyId` (button in Context
  tab) — CRM context + signal store + tenant-Exa retrieval synthesized by the tenant's
  LLM (GPT-5.5 / Claude / Gemini / OpenRouter / custom via existing `llm_config`) into
  structured sections with source provenance; persisted in `account_research`.
- **Outreach pipeline** port (envelope → cadence-strategist → copywriter → copy-qa) as
  LLM prompt-chain services on the tenant's LLM; `outreach_drafts` status machine
  (`draft → qa_passed → approved → exported`); **DRAFT-only invariant** — no send path
  exists; Draft Outreach button surfaces the QA-gated draft for human approval; export
  adapters (clipboard always; settings-chosen channel: HubSpot Sequences enrollment
  or Woodpecker email / email+LinkedIn — revised 2026-07-06, each behind explicit
  confirm; sequence enrollment confirm must state it authorizes HubSpot to send).

### Phase 7 (Stage B): Monitoring, notifications, workflows

- Poller emits **opt-in** `hap_*` company-property writes on new qualifying signals
  (namespaced, logged, toggleable) → customers trigger native HubSpot workflow
  notifications; ship 2–3 documented workflow recipes.
- Plan-aware lookback: read `GET /v1/social-signals/limits` per tenant; clamp feed
  queries + UI window (e.g. 30d vs 14d) to the tenant's Trigify plan; display the
  active window in the Signals tab.
- **Custom workflow action** (Automation API v4, `POST /automation/actions/2026-03/{appId}`,
  `objectTypes: ["COMPANY"]`): "Generate Account Snapshot/Research" with signature-verified
  actionUrl endpoint, input fields, and output fields usable in later workflow steps.

### Phase 8 (optional, separately scoped): Albacross web-visitor "context API"

The user's "API that brings more context and more signals" is OpenClaw's Albacross
web-visitor de-anonymization (`albacross_receiver.py` → `web_visitor_qualify.py` →
`entity_resolution.py` → `guardrails.py`). It is a **different ingestion model** (inbound
webhook + entity resolution + ICP verdict), not a Trigify feed pull. Recommend scoping it
as a follow-up plan once Trigify is live, since it adds a webhook receiver, PII-redaction
policy, and an ICP-fit engine that are outside the current locked wedge. Flagged here so it
is not silently dropped; a webhook-receiver + `web_visitors`/`visits`/`company_aliases`
port would slot into the same `signals`/`company_signal_map` substrate.

## Team Orchestration

- You operate as the team lead and orchestrate specialists; you never edit the codebase directly.
- Sequence: DB foundation → (client + ranking in parallel) → poller + adapter → monitor mgmt + settings → frontend → validation.
- Every spawn MUST pass `mode: "bypassPermissions"` (per user global rule).

### Team Members

- Specialist
  - Name: `db-foundation`
  - Role: Drizzle schema (signals, company_signal_map, trigify_monitors), migration, RLS policies for `hap_app`, and the `Evidence`/domain-type extension.
  - Agent Type: supabase-specialist
  - Resume: true
  - Spawn Description: `supabase-specialist - Trigify signal data model and migrations`
- Specialist
  - Name: `signal-backend`
  - Role: TrigifyClient port, normalization, ranking service, poller + cron, TrigifyStoreAdapter + factory registration, config-resolver wiring.
  - Agent Type: backend-engineer
  - Resume: true
  - Spawn Description: `backend-engineer - Trigify client, ingestion, ranking, and adapter`
- Specialist
  - Name: `monitor-and-settings`
  - Role: Gated monitor manager (spend gate), settings-trigify routes, connection test, and replacing the snapshot route's fixture property/contact fetchers with real HubSpot-backed ones.
  - Agent Type: backend-engineer
  - Resume: true
  - Spawn Description: `backend-engineer - Trigify monitor management and settings API`
- Specialist
  - Name: `tab-frontend`
  - Role: Settings UI for Trigify key + monitors; verify reason card + 8 states render Trigify signals with evidence URL/date.
  - Agent Type: frontend-specialist
  - Resume: true
  - Spawn Description: `frontend-specialist - Trigify settings UI and signal card verification`
- Specialist
  - Name: `security-review`
  - Role: Audit credit-spend gate, tenant isolation/RLS on new tables, SSRF on Trigify fetch, key encryption + no-key-in-logs, no silent CRM writes.
  - Agent Type: security-auditor
  - Resume: false
  - Spawn Description: `security-auditor - Trigify integration tenant-isolation and spend-gate audit`
- Specialist
  - Name: `docs-writer`
  - Role: Customer-facing Mintlify documentation in the separate `romeoman/mintlify-docs` repo (task 19b) — verified against shipped behavior, never aspirational.
  - Agent Type: content-writer
  - Resume: true
  - Spawn Description: `content-writer - Mintlify product documentation`
- Quality Engineer (Validator)
  - Name: `validator`
  - Role: Validate completed work against acceptance criteria (read-only inspection mode).
  - Agent Type: quality-engineer
  - Resume: false

## Step by Step Tasks

### 1. Data model + migrations + RLS

- **Task ID**: `db-signals-schema`
- **Depends On**: none
- **Assigned To**: `db-foundation`
- **Agent Type**: supabase-specialist
- **Parallel**: false
- TDD: write schema/migration tests first (mirror `packages/db/src/schema/__tests__/slice*-migration.test.ts`).
- Add `signals`, `company_signal_map`, `trigify_monitors` tables, all `tenant_id`-scoped with FK to `tenants` and the OpenClaw-equivalent columns (`dedupe_key UNIQUE`, `signal_class`, `tier`, `copy_assertable`, `evidence_url`, `evidence_date`, `observed_at`, `hs_company_id`, `raw`).
- Generate the Drizzle migration and add RLS policies granting the least-privilege `hap_app` role tenant-scoped access on all three tables (match the pattern from PR #52).
- Verify `pnpm --filter @hap/db test` and migration apply pass.

### 2. Extend Evidence domain type + signal taxonomy constants

- **Task ID**: `domain-signal-metadata`
- **Depends On**: `db-signals-schema`
- **Assigned To**: `db-foundation`
- **Agent Type**: supabase-specialist
- **Parallel**: false
- TDD first. Extend `packages/config/src/domain-types.ts` `Evidence` with optional `signalType`, `signalClass` (`"observable" | "derived"`), `tier` (`"A"|"B"|"C"`), `copyAssertable`, `evidenceUrl`, `evidenceDate`; keep existing fields unchanged (additive, so Exa/News keep working).
- Create `packages/config/src/trigify-signal-types.ts` porting the 16-signal → trigger_code + class + tier map and the derived set from `references/signal-types.md`.
- Verify `pnpm --filter @hap/config test` + typecheck across `packages/*`.

### 3. Port TrigifyClient (REST)

- **Task ID**: `trigify-client`
- **Depends On**: `domain-signal-metadata`
- **Assigned To**: `signal-backend`
- **Agent Type**: backend-engineer
- **Parallel**: true (with Task 4)
- TDD with replay cassettes (follow `adapters/signal/__tests__/cassettes/exa-search.json`). Port `trigify_client.py`: Bearer auth, FREE reads (`getSocialSignalsFeed`, `listSubscriptions`, `getUsage`, `getLimits`), guarded writes (`createSubscription` requires `confirm=true`, throws a `TrigifyWriteGuardError` equivalent otherwise). Use the app's SSRF-safe fetch. Never interpolate the key into errors/logs.

### 4. Port the signal-ranking model

- **Task ID**: `signal-ranking`
- **Depends On**: `domain-signal-metadata`
- **Assigned To**: `signal-backend`
- **Agent Type**: backend-engineer
- **Parallel**: true (with Task 3)
- TDD first, porting `signal_ranking.py` test cases. Implement `services/trigify/signal-ranking.ts`: config-driven tier weights (A=1.00/B=0.65/C=0.30), `send_threshold` default 0.60, recency + topic factors, person/company multiplier, why-you/why-me/why-now reasoning gates, and the **hard rule**: a derived signal contributes only `derived_boost` (cap 0.25) and only when ≥1 in-window observable exists — derived-alone scores 0. Seed defaults from `trigify_signal_ranking.yaml`.
- Config placement: the ranking config is read from the trigify `provider_config.settings` JSONB (validated with a Zod schema in `@hap/validators`), with sane in-code defaults — NOT from `thresholds`, whose shape is locked to `{freshnessMaxDays, minConfidence}` by `isValidThresholds` in `routes/snapshot.ts`.
- Include the strength → `Evidence.confidence` mapping function (observable contribution → 0..1) that the adapter (Task 7) will consume.

### 5. Normalization + company matching

- **Task ID**: `normalize-and-match`
- **Depends On**: `trigify-client`
- **Assigned To**: `signal-backend`
- **Agent Type**: backend-engineer
- **Parallel**: false
- TDD. `services/trigify/normalize.ts`: feed item → signal record (Trigify internal enum names → trigger_code, observable/derived class, tier, evidence_url/date, dedupe_key). `services/trigify/company-match.ts`: resolve LinkedIn URL/domain → HubSpot company_id via `company_signal_map` then HubSpot search fallback; write the alias back with a confidence. No fabricated matches.
- Person-level signals: also attempt person → HubSpot contact resolution (the `HubSpotClient` contact-search endpoint exists) and store `hs_contact_id` on the signal record (OpenClaw `signal_records` carries the same column). Unresolved is fine — leave null, never fabricate. This is what lets the people-selector rank the signal's actual person first (Task 8).

### 6. Poller + cron endpoint

- **Task ID**: `trigify-poller`
- **Depends On**: `normalize-and-match`, `signal-ranking`
- **Assigned To**: `signal-backend`
- **Agent Type**: backend-engineer
- **Parallel**: false
- TDD. `services/trigify/poller.ts`: for each tenant with an enabled `trigify` provider row, pull the free feed, normalize, match, upsert `signals` (idempotent on `dedupe_key`). `routes/admin/trigify-poll.ts`: Vercel cron with `Bearer CRON_SECRET` (copy `keep-alive.ts` auth exactly); add the cron entry to `apps/api/vercel.json`. Reads only → assert zero credit-spend in tests.

### 7. TrigifyStoreAdapter + assembler wiring

- **Task ID**: `trigify-adapter`
- **Depends On**: `trigify-poller`
- **Assigned To**: `signal-backend`
- **Agent Type**: backend-engineer
- **Parallel**: false
- TDD. `adapters/signal/trigify.ts` implements `ProviderAdapter.fetchSignals(tenantId, company)` by reading persisted `signals` for the company, running the ranking service, and projecting to `Evidence[]` (observables: strength-mapped `confidence`, `evidenceUrl`/`evidenceDate` populated; derived: `copyAssertable=false`, low confidence). Register `case "trigify"` in `createSignalAdapter`.
- Route wiring (`routes/snapshot.ts`): add `"trigify"` to `REAL_SIGNAL_PROVIDERS` and change `resolveSignalAdapter` from first-match-wins to **collect all enabled providers and compose them** with the existing `composeSignalAdapters` (each sub-adapter individually wrapped with `wrapSignalWithGuards`, mirroring the Exa+News fan-out). Define thresholds precedence when multiple rows are enabled: first enabled row with valid `thresholds` wins (document it in code).
- Dominant-signal guard: extend `extractDominantSignal` (`services/reason-generator.ts`) to skip evidence with `copyAssertable === false`. This is the assembly-level enforcement of the derived-never-asserted invariant and protects every current and future adapter, not just Trigify.
- Extend `config-resolver` cache invalidation for the `trigify` provider. Verify Exa-only tenants and Trigify-only tenants both resolve correctly (regression tests).

### 8. Real HubSpot fetchers in the snapshot route

- **Task ID**: `real-hubspot-fetchers`
- **Depends On**: `domain-signal-metadata`
- **Assigned To**: `monitor-and-settings`
- **Agent Type**: backend-engineer
- **Parallel**: true (independent of Tasks 3–7; required before Task 10)
- Today `routes/snapshot.ts` injects `fixtureContactFetcher` (3 hardcoded contacts) and picks the eligibility property fetcher from a `?eligibility=` query param. Real usage needs real data.
- TDD. Implement a real `CompanyPropertyFetcher` reading the configured eligibility property (default `hs_is_target_account`, per `services/eligibility.ts`) via `HubSpotClient.getCompanyProperties`, and a real `ContactFetcher` reading company-associated contacts via the existing v4 associations + contacts endpoints on `HubSpotClient`.
- Wire both into the snapshot route; keep the `?eligibility=` fixture override available ONLY in test/dev (env-gated), never in production paths.
- People-selector enhancement: when the dominant signal carries an `hs_contact_id` (person-level Trigify signal), that contact ranks first in `rankContacts` — the person who fired the signal IS the person to talk to. 0..3 people, never fabricated.

### 9. Monitor management + settings API

- **Task ID**: `monitor-management`
- **Depends On**: `trigify-client`
- **Assigned To**: `monitor-and-settings`
- **Agent Type**: backend-engineer
- **Parallel**: true (after Task 3; can run alongside 5–8)
- TDD. Port `trigify_monitors.py` spend gate: `services/trigify/monitor-manager.ts` (dry-run preview by default, explicit confirm to spend, per-tenant credit budget ceiling, duplicate-monitor detection, audit-log every confirmed spend). `routes/settings-trigify.ts`: list/subscribe/pause/delete monitors + a connection test (free `getUsage`). Never a silent credit spend.
- Plan-aware lookback: read `GET /v1/social-signals/limits` per tenant, cache it, and clamp subscription `lookbackWindowMs` + feed/query windows to the tenant's Trigify plan (e.g. 30d vs 14d). Config-driven, never hardcoded; expose the active window so the UI can display it.

### 10. Settings UI + tab state verification

- **Task ID**: `frontend-trigify`
- **Depends On**: `monitor-management`, `trigify-adapter`, `real-hubspot-fetchers`
- **Assigned To**: `tab-frontend`
- **Agent Type**: frontend-specialist
- **Parallel**: false
- TDD with `createRenderer('crm.record.tab')`. Add a Trigify section to settings (key entry, monitor list, subscribe form with an explicit "this spends credits" confirm). Verify the reason card renders the observable Trigify signal with clickable evidence URL + date, and that eligible-strong / fewer-contacts / empty / stale / degraded / low-confidence / ineligible / restricted all render from real ranking outcomes.

### 11. Security audit

- **Task ID**: `security-audit`
- **Depends On**: `frontend-trigify`
- **Assigned To**: `security-review`
- **Agent Type**: security-auditor
- **Parallel**: false
- Audit (report-only): RLS tenant isolation on the 3 new tables (attempt cross-tenant read), the credit-spend gate (no unconfirmed spend path), SSRF on the Trigify fetch, key encryption + no key/PII in logs or error messages, no silent HubSpot CRM writes, and that derived signals can never be asserted as a reason.

---

> **Stage B (V2 expansion) tasks.** Tab-touching tasks gate on Stage A's
> `frontend-trigify` + `security-audit`; Stage B schema can start right after
> `db-signals-schema`. Authorized by
> `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md`, synced into ChatPRD 2026-07-06
> (Stage B gate satisfied). Recommend running Stage A through its tasks first, merging,
> then executing Stage B as its own build.

### 13. Stage B data model

- **Task ID**: `v2-schema`
- **Depends On**: `db-signals-schema`
- **Assigned To**: `db-foundation`
- **Agent Type**: supabase-specialist
- **Parallel**: true
- TDD. Add `account_research`, `outreach_drafts`, `outreach_config`, `notification_settings` tables (per PRD delta §4), tenant-scoped, RLS for `hap_app`, migrations + tests.

### 14. Workspace tab UI (Magic Patterns translation)

- **Task ID**: `v2-workspace-ui`
- **Depends On**: `frontend-trigify`
- **Assigned To**: `tab-frontend`
- **Agent Type**: frontend-specialist
- **Parallel**: true (with 15–17)
- Docs-check FIRST: verify current `@hubspot/ui-extensions` component set (tabs pattern availability; fallback ToggleGroup sections).
- **Track-signals-from-card (Romeo, 2026-07-07):** monitor subscription is a CONTEXTUAL action on the company card, not a settings chore. On the People tab, each associated contact (LinkedIn URL from CRM) gets a **"Track signals"** action (creates a person-profile monitor for that contact — the "I chose to outreach this person" moment); the header/Overview gets **"Track company"** (company-level monitor). Both reuse the existing two-step plan→"This spends 1 Trigify credit" confirm flow and the same spend-gated backend routes. The Settings surface keeps: API key, credit budget, default topic keywords, and the full monitor list (pause/delete) — Stage A's manual URL subscribe form remains as the admin fallback. ALSO: expose `creditBudget` entry in settings UI — budget is fail-closed, so card-based tracking is dead until a budget is settable without SQL.
- **UI feedback round (Romeo, 2026-07-07 — reflected in the published Magic Patterns v2 design):**
  (a) **Trigify is a first-class signal source** everywhere Exa appears: source badges, a source filter (All/Trigify/Exa/HubSpot) on the Signals tab, and Trigify entries in the Context data-sources footer.
  (b) **Every signal/fact carries a clickable "Verify source" link** (evidence URL) — signals people can't verify aren't trusted; this applies to Signals rows, per-person Recent Activity rows, person evidence lines, and Context initiative rows. Backend already stores evidenceUrl; the UI must surface it everywhere.
  (c) **Plan tab is rep-editable**: AI generates the plan, reps can edit/reorder steps and add their own ("Add your own step"); edits persist per (tenant, company) — plan storage needs a rep-edits layer (extend snapshots or a plan_edits jsonb).
  (d) Track-signals modal copy: the 30-day lookback BACKFILLS history on the next poll (not "wait days"); company monitors capture the real taxonomy (initiative posts tier A, hiring tier B + derived boosts prioritization-only).
- **UI feedback round 2 (Romeo, 2026-07-07, from OrgChartHub screenshots + design review):**
  (e) **Buying Group = ORG CHART layout** (OrgChartHub pattern — HubSpot acquired them): hierarchical tree of person cards with reporting lines, colored role badges ON the cards (Decision Maker / Budget Holder / Champion / Blocker / Influencer / Super User), optional dotted relationship lines between people, and **placeholder contacts** for known-but-unidentified roles (e.g. a "? Procurement" card = explicit coverage gap). AI auto-generates hierarchy + role suggestions from signals/CRM activity; everything editable; roles list view as a secondary sub-view. Keep it simple — no activity heatmap.
  (f) **IA restructure — Plan vs Outreach split** (validated vs best practice: plan = stakeholders + value hypothesis + outreach coordination; execution is a separate connected surface):
    • **Plan tab** = pure editable account plan: why-now/value hypothesis, current focus, blockers, validate-next, and outreach COORDINATION (who covers whom) — REMOVE "Recommended Next Moves" and the outreach sequence card from Plan.
    • **People tab** = prospecting/info only — REMOVE the "Draft outreach" button.
    • **NEW Outreach tab**: AI-recommended outreach targets, ranked by relevance (grounded in buying group + signals + plan alignment), user selects who; per-person outreach detail (like People's master-detail pattern): per-person cadence, per-step copy, channel badges. **Status machine per person: Building → Draft → In review → Approved → Exported** — copy is editable during review; ONLY an approved outreach can be exported; while the engine generates, show an explicit "building outreach plan…" state.
    • **Plan↔Outreach dependency**: editing the account plan invalidates/regenerates affected outreach copy + priorities (visible "rebuilding" state, never silent).
  (g) **Export channel logic**: HubSpot Sequence = enroll-into-existing (unchanged). Woodpecker button opens a **channel-choice step: Email only / LinkedIn only / Email + LinkedIn**. Woodpecker LinkedIn step types verified from the official API docs (developers.woodpecker.co): PROFILE_VISIT, CONNECTION_REQUEST (optional message), DIRECT_MESSAGE, INMAIL_MESSAGE — mixable with EMAIL steps in one campaign; campaign statuses DRAFT/EDITED; step versions updatable via PATCH (so our edited copy pushes cleanly).
  (h) Design must be INTERACTIVE in Magic Patterns: Edit plan actually toggles editing, Review copy opens a copy editor, exports open their modals — no dead buttons.
- TDD with `createRenderer('crm.record.tab')`. Translate the v2 Magic Patterns components (see Source UI/UX Reference) into HubSpot components: header, tab nav, Overview (stat strip, Why-Now, Top Signals, Next Move + Draft Outreach button, Key People), Signals (filters, search, provenance, detail), People (person cards). Plan/Context tabs render explicit empty states until 15/16 land. All 8 V1 states must keep rendering.

### 14b. Buying Group tab (AI-generated, editable)

- **Task ID**: `v2-buying-group`
- **Depends On**: `v2-workspace-ui`, `v2-schema`
- **Assigned To**: `tab-frontend` (+ `signal-backend` for generation/sync API)
- **Agent Type**: frontend-specialist
- **Parallel**: true
- Requested by Romeo 2026-07-07; layout REVISED same day to the OrgChartHub-style ORG CHART (see task 14 feedback round 2, item e). Verified facts: HubSpot's native Buying Groups is **Sales Hub Enterprise only**, list-based, manual, with NO public dedicated API. The underlying primitives ARE public: **associations v4 custom labels** (contact↔deal/company, `POST /crm/associations/2026-03/{from}/{to}/labels`, Pro+ tiers, 10 labels/pairing) + the `hs_buying_role` contact property.
- Build OUR buying-group surface (works on all tiers, differentiator vs native): new "Buying Group" tab — AI-suggested role assignment (Economic Buyer / Decision Maker / Champion / Technical Evaluator / Blocker) grounded in signals + CRM activity with per-person evidence + AI-confidence, role-coverage bar with explicit gaps, EDITABLE from day one (add person, change role, regenerate; drag-between-roles may ship later), persisted per (tenant, company) — add `buying_groups` table (jsonb) to v2-schema.
- **Sync roles to HubSpot** = explicit user action (never automatic): writes association labels + buying-role property; logged, reversible, documented — same opt-in discipline as hap_* writes.

### 15. Hosted settings app

- **Task ID**: `v2-settings-app`
- **Depends On**: `v2-schema`, `monitor-management`
- **Assigned To**: `tab-frontend`
- **Agent Type**: frontend-specialist
- **Parallel**: true
- Stand up `apps/settings-web` (React + Tailwind, Magic Patterns styling, own Vercel project) against existing settings routes + new outreach/notification routes: provider keys, Trigify monitors (spend-gated flows with explicit "this spends credits" confirm), outreach config (positioning/vocabulary/frameworks), notification toggles, plan/usage. Auth: reuse the app's OAuth/session model for the install-time flow.
- **Outreach export channel picker (decided 2026-07-06):** a per-tenant setting choosing how approved drafts export — `hubspot_sequences` | `woodpecker_email` | `woodpecker_email_linkedin` (clipboard always available regardless). Each option gets a **tooltip**:
  - *HubSpot Sequences* — "Enrolls the selected contacts into one of your existing HubSpot sequences. Requires a Sales Hub or Service Hub Professional/Enterprise seat for the sending user. Note: HubSpot's API cannot create sequences, so your drafted copy is saved as draft email engagements — the sequence itself must already exist in HubSpot."
  - *Woodpecker (email)* — "Pushes the approved cadence and copy into a Woodpecker campaign (email steps only) using your own Woodpecker API key."
  - *Woodpecker (email + LinkedIn)* — "Same as email, plus LinkedIn touches as Woodpecker manual/LinkedIn tasks."
  Stored in `outreach_config.export_provider` (+ variant in `settings` jsonb). Selection is config only — every actual export still requires explicit per-draft confirm.

### 16. Account research generator

- **Task ID**: `v2-account-research`
- **Depends On**: `v2-schema`, `trigify-adapter`
- **Assigned To**: `signal-backend`
- **Agent Type**: backend-engineer
- **Parallel**: true
- TDD. `services/research/` + `POST /api/research/:companyId`: gather CRM context + signal store + tenant-Exa retrieval → tenant-LLM synthesis into structured sections with per-section source provenance → persist to `account_research` (history kept). Degraded providers → explicit degraded/empty sections, never fabricated content. Rate-limited per tenant. Render in the Context tab (with `tab-frontend`).

### 17. Outreach engine port

- **Task ID**: `v2-outreach-pipeline`
- **Depends On**: `v2-schema`, `trigify-adapter`
- **Assigned To**: `monitor-and-settings`
- **Agent Type**: backend-engineer
- **Parallel**: true
- **Re-audit the CURRENT engine first (2026-07-07):** OpenClaw outreach-engine received F-series changes after this plan was written — 15-key slot contract (campaign_reuse, F5/schema), contact identity populated in signal_json (F4), MC-server-augmented trigify fields in the parity test (F5b), constant-time Woodpecker webhook token compare (F13), PII evidence-log permissions (F6). Port against the engine's CURRENT state, not this plan's earlier snapshot; the golden-envelope test must match the live contract.
- **Entry points:** Draft Outreach from the Next Move card AND a per-person "Draft outreach" action on People-tab cards (reps outreach individuals outside the plan). Output UI = the Outreach Sequence card (see Magic Patterns `v2/OutreachSequenceCard.tsx`): day-by-day cadence with per-step channel badges (Email / LinkedIn), "Review copy" per step, QA-gated DRAFT banner, and export actions — "Enroll via HubSpot Sequence" (enroll-into-existing, Pro+ seat, email steps; copy saved as drafts) and "Push to Woodpecker (email + LinkedIn)" (LinkedIn touches ride as Woodpecker LinkedIn/manual tasks).
- TDD, porting the OpenClaw contracts (C2/C3/C4) and the golden-envelope test (`test_envelope_contract.py`): `services/outreach/{envelope,cadence,copywriter,copy-qa,pipeline}.ts`, each step an LLM prompt-chain on the tenant's configured LLM receiving the WHOLE envelope; deterministic linter before the LLM judge in QA; any hard failure blocks.
- `outreach_drafts` status machine (`draft → qa_passed → approved → exported`); routes for run/approve/reject/export; **DRAFT-only invariant enforced by tests** (no code path transmits copy without approved status + explicit user action); derived signals and restricted evidence can never appear in envelopes or copy (zero-leak test).
- Wire the Draft Outreach button (Next Move card) end to end. Export adapters (REVISED 2026-07-06 after Sequences API verification): clipboard always; plus the tenant's configured channel from settings (task 15):
  - **HubSpot Sequences adapter** — docs-check FIRST against https://developers.hubspot.com/docs/api-reference/latest/automation/sequences/guide. Verified facts (2026-07-06): API base `/automation/sequences/2026-03/`; supports LIST sequences, FETCH sequence, ENROLL contact, and enrollment status — it CANNOT create or edit sequences. Export = user picks an existing sequence (list endpoint) + we enroll the draft's contacts (`userId` of a seat-holding sender required; Sales/Service Hub Pro or Enterprise seat). Drafted copy is additionally saved as HubSpot DRAFT email engagements (never sent) since the API can't inject our copy into a sequence.
  - **Woodpecker adapter** — campaign push with tenant key; `email` or `email+linkedin` variant per settings.
  All behind the provider-adapter pattern + explicit confirm per export; nothing ever auto-sends from our app (a sequence enrollment IS a send-authorizing action in HubSpot — the confirm dialog must say so explicitly).

### 17b. Outreach Angles (campaign-level)

- **Task ID**: `v2-outreach-angles`
- **Depends On**: `v2-outreach-pipeline`
- **Assigned To**: `monitor-and-settings` (backend) + `tab-frontend` (UI)
- **Agent Type**: backend-engineer
- **Parallel**: true
- Requested by Romeo 2026-07-07. A campaign-level **Angle** is chosen when creating an outreach campaign and shapes the ENTIRE sequence: goal, tone, frameworks, per-touch templates, and QA criteria. Today's default ("sell our services") becomes just one angle.
- **Preset angles:**
  1. **Interview** — thought-leadership interview series aimed at a persona (e.g. CEOs only). NO product pitch anywhere in the sequence — the ask is the interview. Assets referenced: each interview publishes on the blog + a series landing page hosts them all (client reference: https://tsh.io/blog/managing-software-architecture + https://tsh.io/cto-vs-status-quo). Interviewees become warm relationships for later campaigns.
  2. **Product / service feedback** — ask people (ideally interview alumni or existing relationships) for feedback on a new service/framework/HubSpot app. Combinable with Interview follow-up.
  3. **Event** — three sub-variants: (a) webinar invite, (b) physical event invite, (c) meet-at-shared-event ("we're both attending X — coffee?"), driven by an event they attend/attended.
  4. **Direct** — the current signal-led sell motion (existing behavior, now an explicit angle).
- **Custom angles (prompt-to-angle):** the user prompts a new angle → the pipeline runs RESEARCH on the tenant's LLM+Exa (what email/LinkedIn frameworks & best practices fit this angle) → generates a structured angle definition (goal, tone, allowed claims, frameworks, per-touch template skeletons, QA additions) → user reviews → saved to tenant config, reusable like presets.
- **Architecture:** angle definitions live in `outreach_config.angles[]` (jsonb); the campaign envelope carries `campaign.angle`; cadence-strategist + copywriter + copy-QA all consume it; **QA enforces angle fidelity as a hard failure** (e.g. any pitch inside an Interview-angle sequence blocks). Maps onto the engine's config-driven `messaging_vocabulary` (frameworks {id,label,era}, angle families) — the campaign angle filters/extends the vocabulary. Author preset templates/frameworks at build time (research round per preset).
- **Engine re-audit (2026-07-07):** OpenClaw engine landed 177929a — 'The Breakup' retired in favor of a signal-led final touch, LinkedIn frameworks/steps added — and campaign-angle work is in progress there; port against the engine's CURRENT state and mirror its angle model where it exists.

### 17c. Warm intro / connecting-the-dots

- **Task ID**: `v2-warm-intro`
- **Depends On**: `v2-buying-group`, `v2-outreach-pipeline`
- **Assigned To**: `signal-backend` (enrich/score) + `tab-frontend` (UI)
- **Agent Type**: backend-engineer
- **Parallel**: true
- Requested by Romeo 2026-07-07. Warm up a buying-group person BEFORE outreach using the rep's own relationship graph:
  1. Rep checks the target on LinkedIn/Sales Navigator manually and enters the **mutual connections** into the app (per target person). UI ENFORCES a minimum of 3 mutual connections (5 recommended) before scoring runs.
  2. **Enrich/qualify** each mutual connection via buttons: "Find in HubSpot" (are they in our CRM? relationship strength from deals/activities), "Find with research" (Exa/Harvest: role, relevance, overlap with target).
  3. **Score & rank**: intro-likelihood ranking (our relationship strength × their closeness/relevance to the target × seniority) → "ask THIS person first" priority list.
  4. **Pre-made intro-request DM** per ranked connector (LinkedIn-style, short: working this account / saw you know <target> / can you put us in touch) — editable.
  5. **One-click open (feasibility VERIFIED 2026-07-07):** LinkedIn compose-to-person deep link WORKS: `https://www.linkedin.com/messaging/compose/?recipient=<publicId|URN>` (robust form adds `profileUrn=urn:li:fsd_profile:<URN>&screenContext=NON_SELF_PROFILE_VIEW&interop=msgOverlay`, which opens the real composer even for new connections). **Message-body prefill via URL is NOT possible** (no such parameter exists) → UX: the button opens LinkedIn compose to the connector AND auto-copies the message to the clipboard; the rep pastes + sends manually. Nothing is ever auto-sent.
  6. Warm-up state reflects into the Plan (coordination) and the Outreach tab (per-person pre-cadence stage, e.g. "Warming up via M. Kowalski").
- **Storage:** `warm_intros` per (tenant, company, target person): mutual_connections[] {name, linkedinUrl, source: manual, enrichment jsonb, score}, intro_requests[] {connector, message, status}.

### 18. Notifications + plan-aware monitoring

- **Task ID**: `v2-notifications`
- **Depends On**: `trigify-poller`, `v2-schema`
- **Assigned To**: `signal-backend`
- **Agent Type**: backend-engineer
- **Parallel**: true
- TDD. Poller emits opt-in `hap_*` company-property writes on new qualifying signals (gated on `notification_settings.property_writes_enabled` + min-tier; every write logged; documented uninstall cleanup). Author 2–3 native-workflow notification recipes in `docs/`. Verify the recipe end to end on the test portal.

### 19. Custom workflow action

- **Task ID**: `v2-workflow-action`
- **Depends On**: `v2-account-research`
- **Assigned To**: `monitor-and-settings`
- **Agent Type**: backend-engineer
- **Parallel**: false
- Docs-check FIRST (Automation API v4 / `POST /automation/actions/2026-03/{appId}`; scopes). TDD. Register the "Generate Account Snapshot/Research" action (`objectTypes: ["COMPANY"]`, input fields, output fields incl. eligibility state + strength + reason headline); implement the signature-verified `actionUrl` endpoint (reuse hubspot-signature + nonce middleware; async completion for long research runs); registration on app install/update.

### 19b. Documentation site (Mintlify)

- **Task ID**: `v2-docs-mintlify`
- **Depends On**: `v2-workspace-ui`, `v2-settings-app`, `v2-outreach-pipeline`, `v2-notifications`, `v2-workflow-action`
- **Assigned To**: `docs-writer`
- **Agent Type**: content-writer
- **Parallel**: false
- Customer-facing product documentation on **Mintlify** (Romeo has a free account). The docs live in a SEPARATE repo: `https://github.com/romeoman/mintlify-docs` (already created via Mintlify's GitHub integration). Local workflow: `git clone https://github.com/romeoman/mintlify-docs && npm i -g mint && cd mintlify-docs && mint dev` (preview at localhost:3000); pushing to main deploys via the Mintlify GitHub app.
- Docs-check FIRST: read https://mintlify.com/docs (docs.json navigation schema, MDX components, mint CLI) — do not guess the config format.
- Author (MDX pages, organized in docs.json navigation): Getting started / install guide (HubSpot marketplace → OAuth → settings app), Providers & API keys (Exa, Trigify, LLM providers — BYO keys), Trigify signals (signal types, observable vs derived, lookback windows, credit model + spend confirmations), Account research, Outreach drafts (pipeline, QA gates, DRAFT-only guarantee, export channels incl. the Sequences seat requirement), Notifications (hap_* properties + the 2-3 workflow recipes), Workflow action, Security & tenant isolation, Troubleshooting/FAQ.
- Accuracy rule: every documented behavior must match the shipped implementation — verify claims against the repo before writing; no aspirational features.
- Verify: `mint dev` renders locally without errors; navigation complete; screenshots from the test portal where useful.

### 20. Final validation

- **Task ID**: validate-all
- **Depends On**: `db-signals-schema`, `domain-signal-metadata`, `trigify-client`, `signal-ranking`, `normalize-and-match`, `trigify-poller`, `trigify-adapter`, `real-hubspot-fetchers`, `monitor-management`, `frontend-trigify`, `security-audit`, `v2-schema`, `v2-workspace-ui`, `v2-settings-app`, `v2-account-research`, `v2-outreach-pipeline`, `v2-notifications`, `v2-workflow-action`, `v2-docs-mintlify`
- **Assigned To**: `validator`
- **Agent Type**: quality-engineer
- **Parallel**: false
- Run all validation commands; verify acceptance criteria; confirm the test portal exercises all 8 states end to end. Operate in validation mode: inspect and report only, do not modify files.
- Stage B additions: re-dispatch `security-review` for the V2 surfaces (workflow-action endpoint auth, outreach draft PII, DRAFT-only invariant, notification write gating, settings-app auth) before sign-off; verify the golden-envelope contract test, the notification recipe end to end, and the workflow action executing on the test portal.

## Quality Gates

| Gate                | Validation                                                                              |
| ------------------- | --------------------------------------------------------------------------------------- |
| **Implementation**  | Each package builds; new adapter/poller/ranking unit-tested with cassettes/fixtures     |
| **Integration**     | `createSignalAdapter("trigify")` resolves; assembler produces correct states end-to-end |
| **Quality**         | Vitest suites green; derived-alone-never-asserted property test passes                  |
| **User Acceptance** | Operator can add a key, subscribe a monitor (with confirm), and see a live reason       |
| **Verification**    | Evidence before claims — run commands, show output; validate on a real test portal      |

## Acceptance Criteria

- A `provider_config` row with `provider_name = 'trigify'` (encrypted key) makes the tab
  surface a Trigify observable signal as the reason-to-contact, with a clickable evidence
  URL + date.
- Derived signals (`T_Buying_Window`/`T_Influence`/`T_Expansion`/`T_Company_Jobs_Up`) are
  never the dominant signal and never asserted in copy; a derived-only company renders
  `empty` (monitor-only). Enforced by a passing property test.
- The poller pulls the feed on the cron schedule, matches signals to HubSpot companies,
  upserts idempotently (replays collapse on `dedupe_key`), and spends **zero** credits.
- Subscribing a monitor is dry-run by default and only spends credits on explicit confirm,
  refuses duplicates and over-budget creates, and writes an audit line — never a silent spend.
- Tenant isolation holds: a cross-tenant read of `signals`/`company_signal_map`/
  `trigify_monitors` is impossible under the `hap_app` role (RLS test passes).
- All 8 QA states render correctly from real ranking outcomes on the test portal.
- Trigify API keys never appear in logs, error messages, or the browser bundle.
- Existing Exa/News/hubspot-enrichment behavior is unchanged (additive `Evidence` fields);
  a tenant with BOTH Exa and Trigify enabled gets composed evidence from both (via
  `composeSignalAdapters`), and an Exa-only tenant is unaffected (regression tests).
- `extractDominantSignal` never selects evidence with `copyAssertable === false`
  (unit-tested at the reason-generator level, independent of any adapter).
- The snapshot route uses real HubSpot property + contact fetchers in production
  (`hs_is_target_account` eligibility from CRM data; people from company-associated
  contacts); fixture fetchers remain only behind an env-gated test hook. When the dominant
  signal is person-level with a resolved `hs_contact_id`, that person ranks first.

**Stage B acceptance criteria:**

- The tab renders the Magic Patterns IA (5 tabs) using only `@hubspot/ui-extensions`
  components; Overview/Signals/People are live-data; all V1 states still render.
- "Generate account research" produces a persisted, source-attributed research doc using
  ONLY the tenant's own keys; degraded providers yield explicit degraded sections.
- Draft Outreach produces a QA-gated DRAFT (cadence + per-touch copy) on the tenant's
  LLM; the golden-envelope contract test passes; a fabricated stat, a derived signal, or
  restricted evidence in copy fails QA/tests; **no code path can send** without approved
  status + explicit user action.
- Notifications: `hap_*` property writes occur ONLY when the tenant enabled them, are
  logged, and a documented workflow recipe fires on the test portal.
- The custom workflow action registers on install, executes with signature verification,
  and returns usable output fields in a company-based workflow.
- Signals tab displays the plan-clamped lookback window (30d vs 14d verified with mocked
  limits).
- Settings app covers install-time setup end to end (keys → monitors → outreach config →
  notifications) with spend-gated confirms, including the outreach export-channel picker
  (HubSpot Sequences / Woodpecker email / Woodpecker email+LinkedIn) with tooltips; the
  Sequences option surfaces the Pro/Enterprise-seat requirement and enroll-only
  limitation.
- Exporting to HubSpot Sequences enrolls the draft's contacts into the user-chosen
  existing sequence (verified on the test portal with a seat-holding user) and never
  fires without the explicit confirm that states enrollment authorizes HubSpot sends.
- The Mintlify docs site builds (`mint dev`) and documents install, providers, signals,
  outreach (incl. export channels + seat requirement), notifications, workflow action,
  and security — all claims matching shipped behavior.

## Validation Commands

- `pnpm install --frozen-lockfile` — workspace installs clean.
- `pnpm build` — root script: `tsc -b packages/config packages/db packages/validators apps/api` + extension build.
- `pnpm test` — root Vitest run across the workspace (workspace packages are `@hap/api`, `@hap/db`, `@hap/config`, `@hap/validators`, `@hap/hubspot-extension`; use `pnpm --filter @hap/<pkg> test` for targeted runs).
- `pnpm lint` — root Biome gate (`biome check .`).
- `pnpm typecheck` — full `tsc --build`.
- `pnpm vitest run <new test paths>` — targeted proof of: the derived-alone-never-asserted property, the `extractDominantSignal` copy-assertable guard, the zero-credit-spend poller invariant, and the Exa+Trigify composition regression.
- `pnpm db:generate` / `pnpm db:migrate` — migration generation + apply for the three new tables.
- Manual: on the test portal, add a Trigify key, subscribe a monitor, run the poll cron, and confirm the reason card + evidence link on a company record.

## Notes

- **Scope discipline (CLAUDE.md wedge):** Stage A stays inside the V1 wedge. Stage B
  deliberately expands beyond it — that expansion is authorized by the upstream planning
  update `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md` (per the CLAUDE.md rule
  that scope changes require an updated upstream planning document). Still excluded:
  transcript logic, fake scoring widgets, dashboards beyond the 5 specified tabs, and
  prospecting providers (Apollo/HarvestAPI/Icypeas → V2.5).
- **ChatPRD synced (2026-07-06) — Stage B gate satisfied.** The ChatPRD MCP (`chatprd`,
  user scope, OAuth'd as romeo@man.digital) is connected and all project documents now
  carry the V2 delta from `V2_OUTREACH_EXPANSION_PRD_DELTA.md`. ChatPRD doc registry
  (project https://app.chatprd.ai/drive/projects/1775585518010-account-planning-in-hubspot;
  fetch via `get_document(documentUuid)`):
  - Product Brief for AI Development — `b39ce5e7-480e-44f1-9fe8-88bc591308f4`
  - Spec for AI Prototyping — `deacf6b3-ef2f-4930-a4fa-0d48019cb2d4`
  - AI Coding Rules & Standards — `7d454b45-7ac2-4c28-83d6-76570c9b245e`
  - Technical Design Document — `86ffe0e4-63d1-43a1-a96a-28e92dcdf533`
  - Database Schema Design — `8554b95a-8da2-428c-9a24-d3dd92d4904e`
  - Feature Implementation Spec (Workspace Snapshot, Summary, Signals) — `ca7aa079-e1a7-45c9-b719-7552d51c275e`
  - Implementation Plan — `7321e14b-ada3-4265-a4e9-d1cda84dfe55`
  - Repo Draft & Execution Checklist — `d1591ae5-b3cd-4595-8238-a6005502d785`
  - Security / Permission Gate — `ed0efb92-7e4e-4716-8674-f9013e8f01e8`
  - QA & Verification Plan — `041bbd8a-57bb-4e87-85bd-4c490dead022` (canonical; two older
    duplicates `f704414e-...` and `7aed1d8b-...` exist in ChatPRD — ignore/delete them)

  MCP quirk: `list_projects` returns no project IDs — locate docs via `search_documents`
  or `list_documents` and match `createdInThread.assistant.name = "Account Planning in
HubSpot"`. If a ChatPRD doc and this plan ever conflict, the precedence in
  `planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md` governs.

- **Outreach is DRAFT-only:** ported from OpenClaw's contract — the pipeline generates
  and QA-gates copy; humans approve; export is explicit. No auto-send exists anywhere.
- **HubSpot platform facts verified 2026-07-06:** custom workflow actions are current
  (Automation v4, `POST /automation/actions/2026-03/{appId}`, actionUrl webhook,
  input/output fields, COMPANY object type). Legacy timeline events v1/v3 are closed to
  new apps; the new-platform "app events" need HubSpot approval → notifications ship via
  opt-in `hap_*` property writes + native workflow recipes, app events as a later
  enhancement. **Sequences API verified 2026-07-06** (fetched live):
  `/automation/sequences/2026-03/` — list/fetch sequences, enroll contact, enrollment
  status; NO sequence create/edit; requires the acting user to hold a Sales Hub or
  Service Hub Professional/Enterprise seat (userId passed on every call). Hence export =
  enroll-into-existing-sequence; drafted copy travels as draft email engagements.
- **Config-driven, no hardcoding:** every threshold, tier weight, cadence, and budget comes
  from provider `thresholds`/`settings` or env, seeded from `trigify_signal_ranking.yaml` —
  never hardcoded in adapter/UI code.
- **Docs-check rule:** before implementing the client, verify the current Trigify REST
  contract (the `SKILL.md` + the live OpenAPI referenced in `trigify_client.py` note the
  v1 subscription body shape `{subscriptions:[{linkedin_url, config:{...}}]}` — confirm it
  hasn't drifted). Verify Hono route + Vercel cron patterns against current docs.
- **Why not call Trigify live per company:** the API is feed-based and monitor-creation is
  the only credit spend; a live per-company call would be wrong and costly. The poller +
  store is the correct model and matches the proven OpenClaw design.
- **Not workflow-worthy:** this is a dependency-ordered build (schema → client/ranking →
  poller/adapter → settings/UI → validation), not a massively-parallel/adversarial/
  unknown-size task. Route to `/team-build`, not `/workflow-build`.
- **Albacross (Phase 4)** is deliberately deferred to its own plan — different ingestion
  model, PII-redaction policy, and ICP engine.
