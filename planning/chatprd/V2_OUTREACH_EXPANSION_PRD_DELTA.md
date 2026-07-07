# V2 Expansion PRD Delta — Account Workspace UI + Outreach Engine + Monitoring

**Status:** SYNCED to ChatPRD — authored 2026-07-06, synced 2026-07-06 via the `chatprd` MCP.
**ChatPRD project:** https://app.chatprd.ai/drive/projects/1775585518010-account-planning-in-hubspot
**Sync record (2026-07-06):** every section below has been applied to its target ChatPRD
document. §1/§2/§7 and the feature-plan/repo-checklist/security/QA deltas landed in the
earlier sync pass (~16:37 UTC); §3 (Technical Design, `86ffe0e4-...`), §4 (Database Schema,
`8554b95a-...`), and §2/§5-derived UI+acceptance content (Feature Implementation Spec,
`ca7aa079-...`) were appended as "V2 Expansion (Added 2026-07-06)" sections with V1 text
preserved verbatim. The full doc-UUID registry lives in
`.claude/tasks/trigify-signals-into-account-planning.md` (Notes → "ChatPRD synced").
This file remains the local mirror of the upstream planning update that (per CLAUDE.md)
authorizes scope beyond the V1 wedge; if it and ChatPRD drift, re-sync from here.
**PENDING ChatPRD re-sync (2026-07-06, later session):** two revisions below are NOT yet
in the cloud docs (chatprd MCP was unreachable/needs re-auth): (a) open-decision #2
revised — export channel is now a per-tenant settings choice with tooltips
(hubspot_sequences | woodpecker_email | woodpecker_email_linkedin; Sequences =
enroll-into-existing only, Sales/Service Hub Pro+ seat required); (b) §6 addition —
Mintlify documentation site (repo romeoman/mintlify-docs). Sync targets: Database Schema
doc `8554b95a-...` (outreach_config decision line), Technical Design doc `86ffe0e4-...`
(export adapters bullet), Repo Draft & Execution Checklist doc `d1591ae5-...` (docs
section).

---

## 0. What is changing and why

V1 locked wedge (shipped, slices 1–12): one credible reason to contact this account now,
on `crm.record.tab`, up to 3 people, 8 QA states, tenant-isolated, BYO keys.

V2 expands the same surface into a **signal-first account workspace with an outreach
engine**, porting proven logic from the OpenClaw outreach-engine
(`/home/romeoman/openclaw-infra/outreach-engine` in the OrbStack VM;
`/Users/romeoman/OrbStack/openclaw-vm/home/romeoman/openclaw-infra/...` from macOS):

1. **Trigify buying-intent signals** (already planned — see
   `.claude/tasks/trigify-signals-into-account-planning.md`, tasks 1–12).
2. **Account workspace UI** — the Magic Patterns design
   (https://www.magicpatterns.com/c/xmdzva7bxdn4ubmtrbvs35, editor id
   `xmdzva7bxdn4ubmtrbvs35`, active artifact `b9bdba8b-...`, use the **v2/** components)
   becomes the canonical screen-by-screen UI reference: 5 tabs — Overview, People,
   Signals, Plan, Context.
3. **On-demand account research** — a "Generate account research" button per company,
   running on the tenant's own provider keys (Exa for retrieval + the tenant's chosen LLM
   — e.g. GPT-5.5, Claude, Gemini, or any configured provider — for synthesis).
4. **Outreach engine** — port of the OpenClaw pipeline (cadence-strategist → copywriter →
   copy-qa over a campaign envelope) as config-driven, DRAFT-only email/LinkedIn copy
   generation triggered from "Draft Outreach". Nothing ever auto-sends.
5. **Signal monitoring + notifications** — continuous Trigify monitoring with plan-aware
   lookback (e.g. 30d vs 14d depending on the tenant's Trigify plan, read from
   `GET /v1/social-signals/limits`), and opt-in notification propagation into HubSpot.
6. **Workflows integration** — the app registers a **custom workflow action** (HubSpot
   Automation API v4) so customers can generate account snapshots/reports from native
   HubSpot workflows.

**User journey (canonical):**

> I open a company record → the workspace tab shows the Overview (Why-Now summary, top
> signals, next move, key people). I can click **Generate account research** to build the
> research on demand with my own API keys. If Trigify is connected, the **Signals** tab
> shows past signals within my plan's lookback window (30d vs 14d) and monitoring is on;
> when a new signal lands, I get a notification (via a HubSpot workflow triggered on the
> app's signal properties). From the **Next Move** card I click **Draft Outreach** — the
> engine drafts a signal-led cadence + copy with my own LLM, QA-gates it, and shows it to
> me as a DRAFT for approval/export. In HubSpot **workflows** I can add the app's
> "Generate account snapshot" action to automate report generation for target accounts.

---

## 1. Product Brief (ChatPRD: "Product Brief / AI development")

**Apply:**

- Reframe product scope: V1 wedge (unchanged, shipped) + V2 "Signal-first Account
  Workspace with Outreach Engine". Keep the anti-goals: no transcript logic, no fake
  scoring, no generic dashboards beyond the 5 specified tabs.
- Add the canonical user journey (§0 above) as the primary user story.
- Add plan-tier concept: features gate on (a) which providers the tenant configured
  (Trigify / Exa / LLM / outreach delivery), (b) the tenant's Trigify plan limits
  (lookback window, cadence caps — discovered at runtime via the limits API, never
  hardcoded).
- Add success metrics: time-to-first-credible-reason, % accounts with observable signal
  in window, drafts approved without edits, workflow-action executions.

## 2. AI Prototype Specs (ChatPRD: "Specs for the AI prototype")

**Apply — the Magic Patterns design is the canonical UI reference.**
Link + template id above. Screen-by-screen (v2 components):

- **Header** (`v2/HeaderV2.tsx`): company name, industry/location chips, domain link,
  stage chip, health chip, "Last synced" + Refresh.
- **Tab nav** (`v2/TabNavV2.tsx`): Overview / People / Signals (count) / Plan / Context.
- **Overview** (`v2/OverviewTabV2.tsx`):
  - 4-stat strip (deal value, stage, active contacts, expected close) — CRM-derived.
  - "Executive Summary: Why Now" callout — maps to `reasonToContact` + evidence bullets.
  - "Top Signals" table with per-source badges (Exa.ai / HubSpot / Trigify) + relative
    time — maps to ranked evidence.
  - "Recommended Next Move" card with **Draft Outreach** button — maps to `nextMove` and
    triggers the outreach pipeline.
  - "Key People" list with role badges (Decision Maker / Champion) — maps to `people`.
- **People** (`v2/PeopleTabV2.tsx`): expanded person cards — name, title, location,
  CRM status (In CRM / External), role badge, reason-to-talk, bio, evidence line,
  per-person signals, LinkedIn link. **Track signals (decided 2026-07-07):** each person
  card carries a "Track signals" action creating a person-profile Trigify monitor from
  the contact's LinkedIn URL (two-step spend confirm); the header/Overview carries
  "Track company" for a company-level monitor. Monitor creation is contextual on the
  card — settings only holds key/budget/defaults/monitor-list admin.
- **Signals** (`v2/SignalsTabV2.tsx`): filterable list (All / External Only / CRM Only;
  type filter; search), each signal row: source badge, headline, category, relative time,
  linked people + roles, **provenance chain** ("Exa.ai → Datadog Q3 2026 Earnings
  Transcript"), detail panel with snippet; CRM Gap + Data Quality callouts.
- **Plan** (`v2/PlanTabV2.tsx`): timeline of account events (deal stage moves, signal
  milestones, CRM gaps), "This week" actions, messaging guidance (Lead With / Anchor On /
  Avoid).
- **Context** (`v2/ContextTabV2.tsx`): industry/platform/initiative/relevance grid,
  tracked topics, competitor + our-advantage, data-sources footer. This is where the
  generated **account research** renders.

- **Buying Group tab (added 2026-07-07):** AI-generated buying group per company/deal
  (roles: Economic Buyer / Decision Maker / Champion / Technical Evaluator / Blocker),
  grounded in signals + CRM activity with per-person evidence + confidence, coverage
  gaps, fully editable, persisted (`buying_groups` table). Explicit "Sync roles to
  HubSpot" writes association-v4 labels + buying-role property (opt-in action, logged,
  reversible; works on Pro+). Native HubSpot Buying Groups = Enterprise-only, manual,
  no public API — ours is the cross-tier, evidence-backed alternative.
- **Trust requirements (2026-07-07):** Trigify appears as a first-class source (badges,
  filters, data-sources footer) beside Exa/HubSpot; EVERY displayed fact/signal carries
  a clickable verify-source link (evidence URL); Plan tab is AI-generated but
  rep-editable (edit/reorder/add steps, persisted); outreach sequence UI shows
  per-step Email/LinkedIn channels with export to HubSpot Sequences or Woodpecker
  (email + LinkedIn).

**Constraint (must be stated in the spec):** the in-CRM tab is a HubSpot UI extension —
it renders **HubSpot `@hubspot/ui-extensions` components only** (no Tailwind, no lucide,
no arbitrary HTML). The Magic Patterns code is the visual/IA reference to TRANSLATE
(Tile/Table/Tag/StatusTag/Flex/Heading/Statistics/etc.), not code to copy. Component
availability (e.g. tabs pattern) must be verified against current HubSpot docs at build
time. The **hosted settings app** (see §4) is a normal React web app and MAY reuse the
Magic Patterns styling (Tailwind, HubSpot-like palette) directly.

## 3. Technical Design Document

**Apply — new subsystems (all tenant-isolated, config-driven, BYO keys):**

1. **Signal substrate** — as per `.claude/tasks/trigify-signals-into-account-planning.md`
   (signals store, poller, ranking, adapter composition). Unchanged.
2. **Account research generator** — `POST /api/research/:companyId` (UI button + workflow
   action both call it): gathers CRM context + signal store + Exa retrieval, synthesizes
   via the tenant's LLM into a structured research doc (sections match the Context tab).
   Persisted per (tenant, company) with regenerate semantics + staleness display.
3. **Outreach pipeline** — TS port of the OpenClaw envelope model:
   `outreach_envelope` (company + people + signals + positioning + vocabulary) →
   `cadence` step (strategist prompt: fit-grade contacts, one funnel stage, 5+ signal-led
   touches ~12 days, framework + angle per touch) → `copy` step (per-touch, per-contact
   openers built on that contact's REAL captured signal, honest cold fallback, every
   factual claim traced to envelope proof) → `qa` step (deterministic linter + LLM judge:
   signal reality, framework fidelity, personalization depth, fabricated stats, links,
   channel style, deliverability; any hard failure blocks). Each step runs on the
   tenant's LLM (config-driven; GPT-5.5 / Claude / Gemini / OpenRouter / custom). Output
   status machine: `draft → qa_passed → approved → exported`. **Nothing sends from this
   app.** Optional export adapters (behind the provider-adapter pattern): copy-to-
   clipboard / HubSpot draft email engagement / Woodpecker campaign (tenant's key).
4. **Notification propagation** — poller, on NEW qualifying signal: (opt-in per tenant)
   writes app-namespaced company properties (`hap_latest_signal_type`,
   `hap_latest_signal_headline`, `hap_latest_signal_at`, `hap_signal_strength`,
   `hap_signal_evidence_url`). Customers build native HubSpot workflows on property
   change → in-app/email/Slack notification. Ship 2–3 documented workflow recipes.
   (Timeline/app events on the new developer platform require HubSpot approval — tracked
   as a later enhancement, not V2-blocking.)
5. **Custom workflow action** — registered via Automation API v4
   (`POST /automation/actions/2026-03/{appId}`), `objectTypes: ["COMPANY"]`, actionUrl →
   our API; action "Generate Account Snapshot/Research" with input fields (depth,
   regenerate?) and output fields (state, strength, reason headline) usable in later
   workflow steps. actionUrl endpoint verifies HubSpot signature; async completion
   supported for long research runs.
6. **Two UI surfaces** — (a) `crm.record.tab` extension (HubSpot components);
   (b) hosted settings web app (our stack) for install-time and ongoing configuration:
   providers/keys, Trigify monitors (spend-gated), outreach config (positioning,
   vocabulary, frameworks, sender identity), notification toggles + recipes, plan/usage.

## 4. Data Schema Design

**Apply — new tables (all with `tenant_id` FK + RLS for `hap_app`):**

- `signals`, `company_signal_map`, `trigify_monitors` — per the Trigify plan (tasks 1–12).
- `account_research` — id, tenant_id, company_id, status, sections (jsonb), sources
  (jsonb, provenance), generated_by (llm provider/model), created_at; latest-per-company
  view; regenerate keeps history.
- `outreach_drafts` — id, tenant_id, company_id, snapshot_id?, envelope (jsonb), cadence
  (jsonb), copy (jsonb), qa (jsonb), status (draft/qa_passed/approved/exported/rejected),
  approved_by, created_at, updated_at.
- `outreach_config` — id, tenant_id, positioning (jsonb), vocabulary (jsonb), frameworks
  (jsonb), export_provider (nullable), settings (jsonb). **DECIDED 2026-07-06 (Romeo):
  own explicit table** — not `provider_config` rows.
- `buying_groups` — id, tenant_id, company_id, deal_id?, roles (jsonb: person→role,
  evidence, confidence, source: ai|rep), edits (jsonb, rep-edit history), synced_at?,
  created_at, updated_at. (Added 2026-07-07.)
- `notification_settings` — tenant_id, enabled (bool), property_writes_enabled (bool),
  min_tier (A/B/C), updated_at. (May fold into tenant settings jsonb.)

## 5. Feature Implementation Plan

**Apply — phase map:**

- **Phase A (in flight):** Trigify signal substrate — tasks 1–12 of
  `.claude/tasks/trigify-signals-into-account-planning.md`.
- **Phase B:** Account workspace UI (5-tab translation to HubSpot components) + hosted
  settings app shell.
- **Phase C:** Account research generator (+ Context tab rendering) and outreach engine
  (envelope/cadence/copy/qa + Draft Outreach + approval + export adapters).
- **Phase D:** Notifications (property propagation + recipes) + custom workflow action.
- Dependencies: B needs A's states; C needs A (signals in envelope) + B (surfaces);
  D needs A (poller) and C (research for the workflow action's report variant).

## 6. Repo Draft & Execution Checklist

**Apply — additions:** `apps/api/src/services/research/`, `apps/api/src/services/outreach/`
(envelope.ts, cadence.ts, copywriter.ts, copy-qa.ts, pipeline.ts), `apps/api/src/routes/
{research,outreach,workflow-action}.ts`, `apps/settings-web/` (hosted settings app),
extension tab components per Magic Patterns IA, new schema files per §4, HubSpot app
manifest changes (scopes: `automation`, sequences scope for enrollment, company property
write scope; workflow action definition), Vercel project for settings app.

**Documentation (added 2026-07-06):** customer-facing docs on **Mintlify** in the
separate repo `https://github.com/romeoman/mintlify-docs` (Mintlify GitHub app deploys
on push to main; local preview: `npm i -g mint && mint dev`). Pages: getting started /
install, providers & BYO keys, Trigify signals (observable vs derived, credit model),
account research, outreach drafts (DRAFT-only, export channels incl. the Sequences seat
requirement), notifications recipes, workflow action, security & tenant isolation,
troubleshooting. Every claim must match shipped behavior.

## 7. AI Coding Rules & Standards

**Apply — additions (rules, not restatements):**

- In-CRM UI uses `@hubspot/ui-extensions` components exclusively; hosted settings app may
  use Tailwind. Never ship raw HTML/CSS into the extension bundle.
- Outreach engine: DRAFT-only invariant is enforced in code and tests — no code path may
  transmit copy to a third-party send system without an explicit approved status AND an
  explicit user action. Every factual claim in generated copy must carry an evidence ref
  (envelope proof) — same observable/derived rule as signals; derived signals never
  appear in copy.
- CRM property writes: ONLY the documented `hap_*` namespace, ONLY when
  `notification_settings.property_writes_enabled`, and every write logged. This is the
  narrowly-scoped exception to "no CRM writes" — silent writes remain forbidden.
- All new provider calls (Exa research, LLM steps, Woodpecker export) go through the
  existing guard wrapper (rate limit + observability) and per-tenant keys.

## 8. Security & Permission Gates

**Apply:**

- Workflow action endpoint: HubSpot request-signature verification + replay-nonce (reuse
  existing middleware), tenant resolved from portalId, 429-safe.
- Outreach drafts contain prospect PII → same encryption-at-rest posture as evidence;
  restricted-evidence zero-leak rule extends to envelopes and generated copy (a
  restricted source can never appear in copy or research).
- Spend gates: Trigify subscribe (existing), Woodpecker export (explicit confirm),
  research generation (per-tenant rate limit + optional monthly cap in settings).
- Notification property writes are opt-in, namespaced, and reversible (documented
  uninstall/cleanup path).
- Scopes added to the app: automation (workflow actions), company property read/write —
  document in the permission matrix; installer consent copy updated.

## 9. QA Verification Plan

**Apply — new verifications:**

- UI: all 8 V1 states + new surfaces render in the tab (component-translated) on the test
  portal; Signals tab filters/provenance; Context renders research with sources.
- Research: generate → persisted → regenerate keeps history; degraded provider → explicit
  degraded state, never fabricated content.
- Outreach: golden-envelope contract test (each step receives the WHOLE envelope — port
  of OpenClaw `test_envelope_contract.py`); QA gate blocks fabricated stats/links; a
  derived signal in the envelope never surfaces in copy; DRAFT-only invariant test — no
  network call to any send provider without approved status + user action.
- Notifications: property writes only when enabled; workflow recipe fires end-to-end on
  the test portal.
- Workflow action: definition registers on app install; execution generates
  snapshot/research and returns output fields; signature-invalid requests rejected.
- Plan-aware lookback: limits API mocked at 14d and 30d → feed/query windows clamp
  accordingly; UI states the active window.

---

## Open decisions (status as of 2026-07-06)

1. Tabs pattern availability in `@hubspot/ui-extensions` — OPEN (build-time check);
   fallback is a segmented ToggleGroup/StepIndicator navigation.
2. Export adapter set for V2 — **REVISED (Romeo, 2026-07-06, after verifying the
   Sequences API):** a per-tenant **settings choice with tooltips** between
   `hubspot_sequences` | `woodpecker_email` | `woodpecker_email_linkedin` (clipboard
   always included). Sequences API verified live
   (https://developers.hubspot.com/docs/api-reference/latest/automation/sequences/guide):
   `/automation/sequences/2026-03/` supports list/fetch/enroll-contact/enrollment-status
   only — **no sequence create/edit** — and requires the acting user to hold a Sales Hub
   or Service Hub Professional/Enterprise seat. So the HubSpot option = enroll the
   draft's contacts into an EXISTING sequence (drafted copy saved as draft email
   engagements); the tooltip must state the seat requirement and enroll-only limitation,
   and the confirm dialog must state that enrollment authorizes HubSpot to send.
3. Timeline/app events (new dev platform, needs HubSpot approval) — OPEN; ship
   property-based notifications first, revisit after V2.
4. `outreach_config` — **DECIDED (Romeo, 2026-07-06): its own table** (see §4).
5. Prospecting providers (Apollo / HarvestAPI / Icypeas) — DECIDED: deferred to V2.5;
   V2 keeps people sourced from CRM + Trigify person-signals only (scope control).
