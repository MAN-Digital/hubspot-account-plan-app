# V2 Expansion PRD Delta — Account Workspace UI + Outreach Engine + Monitoring

**Status:** SYNCED to ChatPRD — authored 2026-07-06; synced through round 13 on
2026-07-07 via the authenticated `chatprd` MCP.
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
**Sync record (2026-07-07):** the later 2026-07-06 revisions (export-channel settings
choice + Mintlify docs checklist) were synced to Database Schema `8554b95a-...`,
Technical Design `86ffe0e4-...`, and Repo Draft & Execution Checklist `d1591ae5-...`.
Round 8 §2d and round 9 §2e were synced to their mapped docs with marker
`ChatPRD sync addendum — rounds 8 and 9 — 2026-07-07`; Pricing & Packaging
`0b2aae63-...` was refreshed from `PRICING_AND_PACKAGING.md`; and the new ChatPRD doc
"Credit Economics & Sizing" was created as `faa0a41d-407b-4fe9-83b9-e7a6845a2a86`.
Round 10 §2f was synced to the mapped docs with marker
`ChatPRD sync addendum — round 10 Woodpecker campaign reuse — 2026-07-07`.
Round 11 §2g was synced to the mapped docs with marker
`ChatPRD sync addendum — round 11 overview/data gaps/ad hoc credits — 2026-07-07`.
The round 11 Overview correction was synced with marker
`ChatPRD sync correction — round 11 single executive summary and This Outreach — 2026-07-07`.
The round 12 Data Gaps property discipline was synced with marker
`ChatPRD sync addendum — round 12 data-gap property discipline — 2026-07-07`.
Round 13 configurable generation, output-based credits, buying-group flexibility, signal
filters, and HubSpot-defined signal rules were synced with marker
`ChatPRD sync addendum — round 13 configurable generation and HubSpot signals — 2026-07-07`.
The round 13 HubSpot intent correction was synced with marker
`ChatPRD sync correction — round 13 HubSpot recent intent property — 2026-07-07`.

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
   `xmdzva7bxdn4ubmtrbvs35`, active artifact `5b159270-7872-46a2-ac4d-9c8cff78ec13`,
   use the **v2/** components)
   becomes the canonical screen-by-screen UI reference: 8 tabs — Overview, People,
   Buying Group, Signals, Outreach, Data Gaps, Plan, Context.
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

> I open a company record → the workspace tab shows the Overview (one executive summary
> at the top, why-now, top signals, This Outreach, blockers/risks, key people). If the
> account is blank or weakly populated, I open **Build this account workspace** and choose
> exactly which modules to run: account research, buying-group mapping, people
> prospecting/enrichment with a max-contact cap and target roles, outreach drafts, and/or
> signal fetching. The app shows an itemized output-based credit preview, my remaining
> monthly rep budget, and the tenant pool before it runs; clicking generate does not debit
> by itself. If there is no open deal, the Overview switches to an account-development
> view instead of showing blank deal metrics. The **Data Gaps** tab lists missing
> CRM/research properties and prospect/signal coverage inputs only, so I can solve them by
> researching, enriching, creating a task, or explicitly marking a gap not needed. If
> Trigify is connected, the **Signals** tab shows past
> signals within my plan's lookback window (30d vs 14d) and monitoring is on; when a new
> signal lands, I get a notification (via a HubSpot workflow triggered on the app's signal
> properties). From **Outreach** I generate/review/export approved DRAFT copy. In HubSpot
> **workflows** I can still add the app's "Generate account snapshot" action, but the
> primary journey is rep-initiated, ad hoc account generation within per-rep credits.

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
- **Tab nav** (`v2/TabNavV2.tsx`): Overview / People / Buying Group / Signals (count) /
  Outreach / Data Gaps / Plan / Context.
- **Overview** (`v2/OverviewTabV2.tsx`):
  - State-aware KPI strip. With an open deal: deal value, stage, active contacts,
    expected close. With no open deal: account fit, last meaningful activity, signals in
    window, buying-group coverage. With no data: show a configurable **Build this account
    workspace** module picker, not a one-size full-plan run. Reps choose account research,
    buying-group mapping, people prospecting/enrichment, outreach drafts, and/or signal
    fetching. People prospecting includes max contacts and target roles/personas. The
    preview is output-based: no debit on click, HubSpot-source reads cost 0 credits, and
    external prospecting/enrichment debits only for usable returned contacts.
  - One **Executive Summary** at the top of the populated Overview — summarizes current
    account state, confidence, key highlights, and what is known without assuming a deal
    exists. Do not duplicate this summary later in the page.
  - Separate **Why Now** callout — maps to `reasonToContact` + evidence bullets.
  - "Top Signals" table with per-source badges (Exa.ai / HubSpot / Trigify) + relative
    time — maps to ranked evidence.
  - **This Outreach** mini-summary directly after Top Signals — selected angle, target
    count, draft/review/export status, warm-path coverage, and a link to Outreach.
  - Replace the weak "Recommended Next Move" card with **Blockers & Risks**: data
    confidence, missing decision process, missing buying roles, no verified signal, no
    open deal, stale CRM activity, missing LinkedIn/domain fields, budget/credit limit,
    or missing provider setup. Each blocker links to the tab/action that resolves it.
  - A concise "Next action" may appear inside Blockers & Risks, but outreach generation
    belongs in the Outreach tab and research/data cleanup belongs in Data Gaps.
  - "Key People" list with role badges (Decision Maker / Champion) — maps to `people`.
- **People** (`v2/PeopleTabV2.tsx`): expanded person cards — name, title, location,
  CRM status (In CRM / External), role badge, reason-to-talk, bio, evidence line,
  per-person signals, LinkedIn link. **Track signals (decided 2026-07-07):** each person
  card carries a "Track signals" action creating a person-profile Trigify monitor from
  the contact's LinkedIn URL (two-step spend confirm); the header/Overview carries
  "Track company" for a company-level monitor. Monitor creation is contextual on the
  card — settings only holds key/budget/defaults/monitor-list admin.
- **Signals** (`v2/SignalsTabV2.tsx`): filterable list by **signal level** (Company /
  Contact), **signal type**, and search. Source is visible in provenance/source badges
  but is not the primary filter. Each signal row shows headline, level, type, source,
  heat, timestamp, linked people + roles, and a prominent **provenance chain** ("Exa.ai
  → Datadog Q3 2026 Earnings Transcript"). CRM engagement summaries are visible in the
  detail panel. Remove the meaningless "Copy link" action from signal rows/details.
  Signals owns observed evidence only; CRM/data gaps move out of this tab into **Data
  Gaps**. Apollo enrichment events such as "two verified contacts returned" are
  system/data events unless paired with a separate observable buying-intent signal.
  HubSpot's built-in company property **Recent Intent Signals**
  (`hs_recent_intent_signals`) is a default zero-credit HubSpot signal source when the
  company is tracked in HubSpot intent. It is a rolling list of unique intent-signal
  types detected for the company in the past 30 days, with each type appearing once based
  on its most recent occurrence. If HubSpot is not tracking intent for that company, show
  a clear tracking-required state instead of treating the empty property as "no intent".
- **Data Gaps** (`v2/DataGapsTabV2.tsx`): a new first-class tab between Outreach and
  Plan/Context. It lists missing or stale CRM/research **properties** and coverage inputs
  that would improve the account plan, context, buying group, or outreach. Valid Data Gaps
  include missing company firmographics, missing company LinkedIn/website/domain fields,
  missing or stale contact title/location/seniority/LinkedIn fields, too few prospected
  people to form the buying group, missing relevant buying roles such as procurement or
  legal when the motion needs them, too few observed signals to ground the plan, and
  account research not yet run or stale. Invalid Data Gaps: business states such as "no
  open deal for Seattle expansion", settings/integration states such as Woodpecker not
  connected, and budget/credit-pool blockers. Those may appear in Overview Blockers &
  Risks or Settings, but not as Data Gaps. Each gap shows the missing property/coverage
  input, impact, suggested resolution, actual HubSpot owner name, projected credits if
  enrichment/research is needed, and actions: Research, Enrich people, Create HubSpot
  task, Update CRM, Mark not needed. HubSpot-source gaps and CRM reads show 0 credits. No
  silent CRM writes.
- **Plan** (`v2/PlanTabV2.tsx`): timeline of account events (deal stage moves, signal
  milestones, resolved data-gap events), "This week" actions, messaging guidance (Lead
  With / Anchor On / Avoid).
- **Context** (`v2/ContextTabV2.tsx`): industry/platform/initiative/relevance grid,
  tracked topics, competitor + our-advantage, data-sources footer. This is where the
  generated **account research** renders. Account research is a low-cost Exa + LLM
  Context output and must not automatically bundle people prospecting or outreach unless
  the rep selected those modules in the first-run builder.

- **Buying Group tab (added 2026-07-07):** AI-generated buying group per company/deal
  (roles: Economic Buyer / Decision Maker / Champion / Technical Evaluator / Blocker),
  grounded in signals + CRM activity with per-person evidence + confidence, coverage
  gaps, fully editable, persisted (`buying_groups` table). The role list and org chart
  must be generated from the same real prospected people shown on the People tab; counts
  must stay synchronized. If People has 3 contacts/prospects, Buying Group cannot display
  7 named role people. Missing role coverage is shown as explicit unfilled roles or as a
  Data Gap such as "not enough prospects for the buying group", not as fabricated people.
  The role builder is flexible: reps can add multiple champions, blockers, influencers,
  decision makers, or budget holders as unfilled slots, then assign a real HubSpot or
  prospected person when available. When no buying group exists, the empty state shows
  available HubSpot contacts, manual role-builder controls, and a prospecting request
  form with target roles and max-contact cap. Explicit "Sync selected roles to HubSpot"
  writes association-v4 labels + buying-role property (opt-in action, logged, reversible;
  works on Pro+). The sync icon/copy must read as a write/sync action, not a navigation
  arrow. Native HubSpot Buying Groups = Enterprise-only, manual, no public API — ours is
  the cross-tier, evidence-backed alternative.
- **IA restructure + org chart (2026-07-07, round 2):** Buying Group tab renders as an
  ORG CHART (OrgChartHub pattern): hierarchy tree, role badges on person cards, optional
  dotted relationship lines, placeholder contacts for coverage gaps; AI-generated,
  editable, no heatmap. Plan tab = pure editable account plan (why-now/value hypothesis,
  focus, blockers, validate-next, outreach coordination) — next-moves + outreach cards
  REMOVED from Plan; "Draft outreach" REMOVED from People. NEW **Outreach tab**:
  AI-ranked recommended targets (buying group + signals + plan alignment), per-person
  cadence + copy with status machine Building → Draft → In review → Approved → Exported
  (approve-gate before export); plan edits regenerate outreach copy/priorities with a
  visible rebuilding state. Woodpecker export opens a channel-choice (Email / LinkedIn /
  both); LinkedIn steps per official API: PROFILE_VISIT, CONNECTION_REQUEST,
  DIRECT_MESSAGE, INMAIL_MESSAGE; campaign DRAFT/EDITED statuses; step versions
  PATCHable with our edited copy. **Woodpecker campaigns are reuse-first, never
  person-per-campaign by default:** adding another person looks for an existing campaign
  for the same account + angle + signal/channel, recommends it, and requires an explicit
  user choice before creating a new campaign.
- **HubSpot execution model + threading (2026-07-07, round 4 — SUPERSEDES the
  "enroll via sequence" primary flow):** follow-up emails are ALWAYS same-thread
  replies (Woodpecker: subject null on steps 2+, verified; QA hard-fails new subjects
  mid-cadence; UI shows "↳ Re: <first subject>"). Sequences API verified: enrollment =
  {contactId, senderEmail, sequenceId} ONLY — templates send as-is, per-enrollee copy
  injection impossible via API (per-contact edits exist only inside HubSpot's UI).
  Corrected exports: (1) DEFAULT HubSpot path = one HubSpot TASK per touch carrying the
  approved thread-aware copy + due date (rep sends manually); (2) sequence enrollment
  kept for TEMPLATE motions only, with explicit "template copy sends, not your
  generated copy" disclaimer + optional deep-link to edit-in-HubSpot; (3) Woodpecker
  labeled THE full-custom-copy channel. Every cadence step shows a signal chip linking
  the grounding signal → evidence.
- **Buying-group editing (2026-07-07, round 4):** replace-person on any card via a
  picker synced to real CRM associated contacts; edit in BOTH org chart and roles
  list; placeholders fillable; manual edits survive Regenerate (AI never clobbers
  rep edits without confirm).
- **Outreach Angles (2026-07-07, round 3):** campaign-level angle chosen at creation,
  shaping the whole sequence (goal/tone/frameworks/templates/QA). Presets: Interview
  (no-pitch thought-leadership series w/ blog + landing page assets; reference
  tsh.io/cto-vs-status-quo), Product/service feedback, Event (webinar invite / physical
  invite / meet-at-shared-event), Direct (current motion). Custom prompt-to-angle: user
  prompt → LLM+Exa research → structured angle definition → review → saved reusable in
  outreach_config.angles[]. Envelope carries campaign.angle; QA enforces angle fidelity
  (pitch inside Interview angle = hard fail). Engine parity: port against OpenClaw
  177929a (breakup retired, signal-led final touch, LinkedIn frameworks/steps).
- **Angle governance + rebuild lockout (2026-07-07, round 5):** (1) on angle change or
  plan-edit regeneration, cadence/copy/export surfaces gray out behind a "Rebuilding
  sequences…" state until done — no review/approve/export of stale sequences; statuses
  revert to Building. (2) Angle creation/editing (incl. presets — adding tenant info,
  adjusting goal/tone/frameworks/QA) moves to SETTINGS behind a **superadmin
  permission**; superadmin enables/disables angles per tenant and controls their
  definitions; reps get a read-only picker of enabled angles only ("managed by your
  admin"); prompt-to-angle lives in the settings angle manager; enforcement is
  server-side (role check on angle-write endpoints; app-level per-tenant role,
  installer = superadmin by default).
- **Warm intro / connecting-the-dots (2026-07-07, round 3):** per buying-group target,
  rep manually enters LinkedIn mutual connections (min 3 enforced, 5 ideal; **each entry requires name + LinkedIn profile URL**, validated — the URL powers enrichment, scoring, and the open-compose deep link) →
  enrich/qualify (Find in HubSpot / research) → score + rank connectors → pre-made
  editable intro-request DM → one-click opens LinkedIn compose to the connector
  (verified deep link: /messaging/compose/?recipient=… + profileUrn/interop form; BODY
  PREFILL IMPOSSIBLE via URL → auto-copy message to clipboard, rep pastes + sends).
  Warm-up state surfaces in Plan coordination + Outreach per-person stage. New
  `warm_intros` storage (mutual_connections + intro_requests jsonb, tenant-scoped).
- **Warm-paths presentation (2026-07-07, CTD.ai reference — screenshot from Romeo):**
  adopt their language + summary metrics in our UI: a per-account "warm paths" summary
  chip on Overview/header (e.g. "12 warm paths · 3 strong · 2 to the buying group"), an
  account-level relationship-strength score chip ("67 · Strong"), and per-target paths
  graded strong/medium rather than a flat connector list. V2 stays MANUAL-first (rep
  enters mutual connections per Romeo's flow); CTD.ai itself exposes an API
  (`GET /v1/paths?company=…`) + MCP — flag **CTD.ai as an optional future warm-path
  PROVIDER behind the existing provider-adapter pattern (V2.5 candidate)**: a tenant
  connecting CTD.ai would auto-populate warm paths instead of manual entry; manual entry
  remains the fallback. Job-change alerts in their design overlap with our Trigify
  role-change signals — no new work needed there.
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

## 2b. Pricing & Packaging (NEW ChatPRD document, round 6 — 2026-07-07)

Create a NEW ChatPRD doc "Pricing & Packaging". Content: two supply models (managed keys
w/ credits vs BYO keys) on one credits system; credit-metered actions (research runs,
buying-group generation, outreach generation per person, Apollo enrichment per contact,
Trigify monitor creates, Exa-heavy research, warm-intro scoring) with config-driven
costs + per-tenant credit_ledger; tiers — Free trial ~30 credits (sized to research 1-2
accounts end to end) / Pro from $99/mo (we manage Exa+Apollo+Trigify+LLM keys, customer
brings ONLY Woodpecker; monthly allowance + top-ups; margins over researched provider
costs; cheapest-good LLM default pending GPT-vs-Gemini cost research) / Enterprise
custom (BYO APIs + custom cards + optional full-service: we run signals+outreach, train
team, set up connections — retainer). Selling point: enterprise-grade buying groups on
any HubSpot tier. Apollo PROMOTED from V2.5 to THE prospecting/enrichment provider
(proven in OpenClaw signals_source.py + apollo-api skill). Open decision: show
underlying API sources on managed tier (recommendation: yes, trust principle). Billing
rails: HubSpot marketplace billing vs Stripe — decide from research. Final numbers gate
on the pricing-research brief.

## 2c. Settings IA (round 7, 2026-07-07)

Settings move to HubSpot's NATIVE app settings page (new-platform React settings
component, `src/app/settings/`, Connected Apps → app → Settings — verified in HubSpot
docs); the standalone hosted settings web app is deprioritized to a fallback. Settings
are superadmin/admin only (rep sees empty state; gear hidden; server-side role checks).
Provider taxonomy by capability: Signals (Trigify) / Account research (Exa) / People
research-prospecting (Apollo AND Harvest — both; Exa-people as a toggle) / Outreach
delivery (Woodpecker, always tenant's key) / AI model. Plan-gated key fields: BYO
inputs only on Enterprise/BYO plans; Trial+Pro render "Managed by app" chips, no key
fields (Woodpecker excepted). Manual "Add monitor by LinkedIn URL" form REMOVED —
monitor creation is card-contextual only; settings keeps the admin list.

### §2c addendum — app-settings wireframe fidelity (round 7b, 2026-07-07)

Verified mechanics from HubSpot docs (create-a-settings-page): navigation = Marketplace
→ Connected apps → My apps → app → Overview page → **Settings tab**; the page is a
React UI-extension (`src/app/settings/*-hsmeta.json` + component, `hubspot.extend`,
`@hubspot/ui-extensions` components ONLY, persistence via `hubspot.fetch`); HubSpot's
own best practice organizes settings content with the SDK's Tabs/Accordion/Panel/Modal.
Wireframe therefore: (a) settings render inside accurate Connected-Apps chrome (global
bar, breadcrumb, app header w/ Installed chip, HubSpot's Overview|Settings tabs);
(b) our settings content is organized in INTERNAL TABS (Plan & Billing | Providers &
integrations | Outreach angles | Notifications) mapping 1:1 to the SDK Tabs component;
(c) the in-record gear deep-links to this Connected-Apps settings page.

## 2d. Round 8 feedback (2026-07-07 — Overview hub, cross-referenced outreach, ranked signals, settings copy)

**ChatPRD sync:** synced 2026-07-07 to Specs for the AI prototype (§2 UI), Feature
Implementation Spec, QA Verification Plan, and the "Pricing & Packaging" doc.

1. **Overview tab = summary hub.** The Overview must summarize EVERYTHING the workspace
   knows, not just the why-now hero: (a) **Tracking** — active signal monitors (people +
   company, source, last poll) with a link to Signals; (b) **Top signals** — ranked
   hottest-first across ALL sources (Trigify, Apollo, Exa, HubSpot, LinkedIn — Apollo was
   missing from the overview/top-signals sources and must appear); (c) **Buying group**
   mini-summary (role coverage + gaps); (d) **Outreach & warm paths** mini-summary
   (per-person status counts + warm-intro availability); (e) **Plan** mini-summary
   (current play + next coordination step). Each mini-summary links to its tab.
2. **Buying Group note removed.** The "HubSpot's native Buying Groups view requires
   Sales Hub Enterprise…" note is deleted from the UI (keep the capability, drop the
   marketing note).
3. **Multi-stakeholder outreach must cross-reference.** When outreaching to multiple
   stakeholders at the same account, later/parallel touches MUST reference the outreach
   already sent to colleagues ("I also reached out to Amanda on your platform team…").
   Requirements: (a) the cadence engine coordinates copy across persons in the same
   campaign — cross-references are generated, tracked per step (which step references
   which person), and kept in order; (b) UI shows a "Cross-ref" indicator on steps whose
   copy references another stakeholder; (c) copy-QA HARD-FAILS a cadence that outreaches
   multiple stakeholders with zero cross-references, and hard-fails references to
   outreach that was never exported/sent (no fabricated "I spoke with X").
4. **Signals ranked + fuller Trigify coverage.** Signals list is sorted hottest-first
   with a visible heat/tier indicator per signal (reuses the A/B/C ranking model —
   derived-alone = 0 stays). Design + docs must show MORE Trigify signal variety (job
   changes, promotions, hiring spikes, funding, competitor-post engagement, tooling-
   migration posts…), since Trigify emits many more types than the early mocks showed.
5. **"Manage by app" contact math needs pricing logic.** Contact-based actions (Apollo
   enrichment etc.) are charged per contact; the per-contact calculation is part of the
   pricing model, not UI guesswork — see Pricing & Packaging update (top-ups included).
6. **Settings copy + toggle fixes:** (a) the toggle component is broken everywhere —
   when ON/green the knob renders outside the pill; fix the component once, reuse it
   (includes the Exa people-research toggle); (b) Notifications tab drops jargon: no
   `hap_*`/underscore property names in UI copy — plain-English label "Add signal
   updates to the company record" + description explaining app-managed company fields;
   (c) REMOVE "View workflow recipes" and the production-build-ish technical items from
   Notifications (these live in docs, not settings); (d) tier threshold worded plainly
   ("Notify for: Hot signals only / Hot + warm / All qualifying").
7. **Pricing confirmed:** Pro = 500 credits/mo PLUS top-up purchases (top-ups never
   expire). Approved by Romeo round 8.

## 2e. Round 9 feedback (2026-07-07 — team RBAC via HubSpot Users API, per-rep budgets, Usage & logs, credit sizing)

**ChatPRD sync:** synced 2026-07-07 to Specs for the AI prototype, Feature
Implementation Spec, Security & Permission Gates, Database Schema, Pricing & Packaging,
and the NEW "Credit Economics & Sizing" doc
(`faa0a41d-407b-4fe9-83b9-e7a6845a2a86`,
`planning/chatprd/CREDIT_ECONOMICS_AND_SIZING.md`).

1. **Team & access — RBAC sourced from HubSpot's Users API.** Superadmins manage who can
   use the app and at what role. The portal's users are FETCHED from HubSpot (Users
   Provisioning API `/settings/v3/users` and/or Owners API `/crm/v3/owners` — exact
   endpoint/scope pinned by the round-9 research task; see plan task 15c). Superadmin
   assigns an **app role** per user (superadmin > admin > rep) and toggles **app access**
   on/off per user (control over who you grant it to — Romeo's point: "you want some
   control over who you give it to"). We do NOT invent identities — the roster is HubSpot's.
2. **Per-rep credit budgets.** Each user can have a monthly credit cap. Enforced
   server-side AT DEBIT TIME: an action proceeds only if (tenant has credits) AND (rep is
   under their personal cap) — fail-closed with a clear "budget exceeded" message. Admins/
   superadmin can be uncapped. Prevents one rep draining the shared pool.
3. **Usage & logs (new settings tab, admin/superadmin only).** (a) Per-rep usage rollup:
   credits used this period, cap, remaining, last active. (b) Activity/audit log: every
   credit-metered and sensitive action with WHO (HubSpot user), WHAT action, TARGET
   (company/contact), CREDITS spent, timestamp, RESULT (incl. "blocked — budget
   exceeded"). Filterable by rep / action / date. This is how we track usage per rep AND
   how we gather the data to right-size the credit allowance.
4. **Permissions model (documented for security):** three app roles on top of HubSpot's
   own permissions — **superadmin** (billing, provider keys, angle governance, roles +
   budgets, view logs), **admin** (settings + view logs, no billing/roles), **rep** (use
   the workspace; no settings; own usage visible). All role/budget/log routes enforce the
   role SERVER-SIDE (never UI-only), tenant-scoped by RLS. App scopes ≠ installer
   day-to-day visibility — reads of the HubSpot user roster require the users-read scope
   and must degrade gracefully if not granted.
5. **Credit sizing re-examined** (Romeo: "is 500 enough… how do we do it"). New doc
   `CREDIT_ECONOMICS_AND_SIZING.md`: margin is safe (80–93% GM at full burn); the binding
   constraint is RECURRING Trigify monitor credits, which accumulate and crowd out real
   work. 500/mo ≈ ~4–6 fully-worked new accounts/mo + light monitoring. Recommendation:
   decouple "tracked accounts" (monitors) from the research/outreach pool, keep 500 as a
   PROVISIONAL launch number, and use the round-9 Usage logs to set the real allowance
   from actual data. Pro = 500/mo + never-expiring top-ups confirmed.

## 2f. Round 10 feedback (2026-07-07 — Woodpecker campaign reuse)

**ChatPRD sync:** synced 2026-07-07 to Specs for the AI prototype, Feature
Implementation Spec, Technical Design Document, Database Schema, QA & Verification Plan,
and Engineering Handoff.

1. **Woodpecker campaign invariant — one campaign per angle/signal motion, not one per
   person.** When a rep exports or adds another stakeholder to Woodpecker, the app must
   NOT create a separate Woodpecker campaign for each person. The default behavior is
   "add this person to an existing campaign" when the account/angle/signal/channel
   context matches. For pitch/direct motions, the suggested grouping can use
   **Angle + Signal** (for example, Direct + "Hiring spike") plus the account/company and
   channel variant.
2. **Export/add-person modal.** On "Push to Woodpecker" or "Add person to campaign", the
   UI queries the tenant's existing Woodpecker campaigns and opens a decision modal:
   `"There is already a Woodpecker campaign for this angle and signal. Add this person
   here, or create a new campaign?"` The primary CTA is **Add to selected campaign**.
   **Create new campaign** is secondary and explicit. The modal shows suggested matching
   campaigns first (account, angle, signal, channel, status, current person count, last
   exported/synced), and includes **View all campaigns** with search/filter so a rep can
   pick any existing campaign if the suggestion is wrong.
3. **Personalization model.** Personalization belongs in Woodpecker snippets/custom
   fields and per-prospect step content, not in separate campaign or sequence creation.
   The export must send person-level variables such as role, signal headline, signal
   evidence URL, warm-path summary, first-line opener, and angle-specific snippet values.
   Existing campaign steps remain the shared structure; snippets/custom fields carry the
   per-person differences.
4. **Backend/export guard.** The Woodpecker adapter lists/searches campaigns before it can
   create one, persists the selected external campaign ID, and logs whether the export
   reused or created a campaign. Creating a new campaign requires explicit user intent
   from the modal and must be auditable. Provider integration stays tenant-keyed and
   tenant-isolated.
5. **Magic Patterns wireframe requirement.** The clickable Outreach tab must show this
   flow in both places it matters: first Woodpecker export and later adding another
   person. The existing interactive standard still applies: channel choice, campaign
   suggestion, View all campaigns, Add to selected, and Create new all open/toggle real
   states rather than dead buttons.

## 2g. Round 11 feedback (2026-07-07 — Overview strength, Data Gaps, no-deal/no-data, ad hoc rep credits)

**ChatPRD sync:** synced 2026-07-07 to Specs for the AI prototype, Product Brief,
Feature Implementation Spec, Technical Design Document, Database Schema, Pricing &
Packaging, Credit Economics & Sizing, QA & Verification Plan, and Engineering Handoff.
Correction synced with marker
`ChatPRD sync correction — round 11 single executive summary and This Outreach — 2026-07-07`.

1. **Overview is an executive workspace summary, not a next-move card.** Keep only one
   **Executive Summary**, at the top of the populated Overview. It states the account
   state, confidence, key highlights, and what is known. Keep **Why Now** as its own
   evidence callout, then show **Top Signals** above a restored **This Outreach**
   mini-summary. Replace the weak standalone "Recommended Next Move" surface with
   **Blockers & Risks**. Examples: missing buying-role owner, no verified recent signal,
   no open deal, missing close date/amount, stale CRM activity, missing LinkedIn URLs,
   missing warm path, low research confidence, missing Woodpecker/provider setup, and rep
   or tenant credit limit. Each blocker links to the exact tab/action that resolves it.
   Blockers complement the Outreach summary; they do not replace it.
2. **No-open-deal variant is mandatory.** Many company records will not have an open deal.
   The Overview must not show blank deal value/stage/close-date cards. It switches to an
   account-development summary: fit/ICP, last meaningful CRM activity, strongest signal in
   window, buying-group coverage, relationship/warm-path status, and recommended account
   setup actions. "Create/open a deal" may be a task, but the plan can still be generated
   without a deal.
3. **Absolute no-data / first-run wireframe is mandatory (revised by round 13).** When a
   rep opens a company with little or no usable data, show a clear empty state: what can
   be generated, why it helps, projected credit range, the rep's remaining monthly
   credits, and the tenant pool status. The current CTA is **Build this account
   workspace**, a module picker where the rep selects account research, buying group,
   people prospecting/enrichment, outreach drafts, and/or signals instead of one bundled
   full-plan run. Before running, the confirm step breaks down expected and output-based
   debits.
   If the rep is over budget or provider setup is missing, show the blocker and route to
   Data Gaps/settings/admin instead of failing silently.
4. **New Data Gaps tab.** Move "CRM Gap" / "Data Quality" out of Signals into a dedicated
   **Data Gaps** tab placed between Outreach and Plan/Context. It is a working task list
   for improving the account plan and context: gap type, impact, source, owner, suggested
   fix, cost if credit-metered, status (Open / In progress / Resolved / Ignored), and
   action buttons. The tab can create HubSpot tasks or launch research/enrichment, but CRM
   updates remain explicit user actions.
5. **Credits are rep-facing at the point of action.** The product should not assume a
   superadmin preselects all target accounts. A rep with app access can generate a plan
   ad hoc on a company record as long as tenant credits and that rep's monthly cap allow
   it. Every credit-metered CTA shows projected cost, remaining personal credits, and
   remaining tenant credits before debit. The debit path logs the acting HubSpot user,
   account/contact target, action type, credits, and result. Settings still let a
   superadmin/admin set caps and view usage, but the workspace itself must make the
   budget state visible to reps.
6. **Journey/status requirements.** The app must represent these states clearly:
   blank/no data → ready to generate → generating research/account plan → data gaps found
   → context/plan ready → outreach building → draft/in review/approved/exported. No-deal
   is an account state, not an error state. Budget/provider blockers are explicit states
   with a resolution path.

## 2h. Round 12 feedback (2026-07-07 — Data Gaps are missing properties, not business/settings states)

**ChatPRD sync:** sync this section to Specs for the AI prototype, Product Brief, Feature
Implementation Spec, Technical Design Document, Database Schema, QA & Verification Plan,
and Engineering Handoff with marker
`ChatPRD sync addendum — round 12 data-gap property discipline — 2026-07-07`.

1. **Data Gaps must be smart property gaps.** Never suggest a gap like "No open deal for
   Seattle expansion." No-open-deal is an account journey state and may appear in Overview
   Blockers & Risks or account-development CTAs, but it is not missing data. Data Gaps only
   covers missing/stale CRM properties, missing enrichment/research outputs, and missing
   coverage inputs that improve the plan context.
2. **Do not mix settings or budget into Data Gaps.** Woodpecker not connected, provider not
   configured, and credit pool/rep budget issues are Settings/Billing blockers. They must
   not be shown as Data Gaps.
3. **Required contact context fields.** For every person used in People, Buying Group, or
   Outreach, evaluate whether these fields exist or are stale: City, Country, Country Code,
   Employment Role, Employment Seniority, Employment Sub Role, First Name, Job Title, Last
   Name, LinkedIn URL, State/Region, State/Region Code. Missing LinkedIn URL and outdated
   title are high-priority gaps because they block signal monitoring, enrichment, buying-role
   confidence, and outreach accuracy.
4. **Required company context fields.** For every account, evaluate whether these fields
   exist or are stale: Annual revenue, City, Company domain name, Company keywords, Company
   name, Country/Region, Country/Region Code, Description, Employee range, Industry,
   LinkedIn company page, Number of employees, Phone number, Revenue range, State/Region,
   State/Region Code, Street Address, Web Technologies, Website URL, Year founded. Optional
   company enrichment fields: Total Money Raised, X account handle. The user-provided
   Google Sheet "Hubspot Company Enrichment Taxonomy" is the taxonomy source for revenue
   ranges, employee ranges, industries, company keywords, and web technologies.
5. **Buying Group and People counts must stay in sync.** The Buying Group role list/org
   chart is derived from the real people in the People tab. If the People tab has three
   prospects, the Buying Group cannot show seven named people. Show unfilled role slots or
   explicit coverage gaps instead. Examples: "Not enough prospects for the buying group" or
   "Missing procurement/legal contact" when relevant to the motion.
6. **Signal coverage is a data/research gap, not a fake signal.** If there are not enough
   observed signals to build the plan context, Data Gaps should ask to fetch/add signals or
   run account research. Signals remains observed evidence only.
7. **HubSpot property source of truth.** The evaluator must retrieve the portal's available
   contact and company properties through HubSpot's Properties API, because HubSpot includes
   default properties and each tenant may have custom or renamed labels. Internally the app
   should use a configurable property manifest that maps display labels to portal property
   names. HubSpot docs confirm contact/company records are property-based, companies can be
   deduped by domain, and contact-company relationships are associations; the app must read
   those primitives rather than inventing plan context.

## 2i. Round 13 feedback (2026-07-07 — Configurable generation, output-based credits, flexible buying groups, and HubSpot signals)

**ChatPRD sync:** synced 2026-07-07 to Specs for the AI prototype, Product Brief,
Feature Implementation Spec, Technical Design Document, Database Schema, Pricing &
Packaging, Credit Economics & Sizing, QA & Verification Plan, and Engineering Handoff
with marker
`ChatPRD sync addendum — round 13 configurable generation and HubSpot signals — 2026-07-07`.

1. **No-data / first-run generation is configurable.** Do not show one bundled
   "Generate full account plan" action as the only path. A blank account opens a
   **Build this account workspace** chooser where the rep selects exactly what to run:
   account research, buying-group mapping/regenerate, people prospecting/enrichment,
   outreach drafts, and/or signal fetching/monitoring. People prospecting includes a
   max-contact cap and target roles/personas such as decision maker, economic buyer,
   champion, procurement, legal, technical evaluator, blocker, or influencer.
2. **Credit debit is output-based.** Clicking generate never debits by itself. The app
   shows an estimate/range, reserves nothing unless we deliberately design a reservation
   state, and records actual credits only for saved outputs or usable returned data.
   HubSpot-source reads and fixes cost 0 credits. Apollo prospecting/enrichment charges
   only for returned usable contacts. Outreach drafts debit only for generated drafts.
   Signal monitoring/fetching stays separate because Trigify is the recurring spend risk.
3. **Account research belongs in Context and should be cheap.** Account research is the
   Exa + LLM Context output. Based on the current Exa pricing model, a normal account
   research run should be a low-credit action (1-2 credits by default, config-driven),
   not a large bundled cost. It can run with or without a deal and does not automatically
   include people prospecting or outreach.
4. **Data Gaps must show named owners and correct credit source.** Owner labels are
   actual HubSpot owners/users such as "Sam Carter" or "Maya Patel", not generic
   "RevOps Admin". If the gap can be resolved from existing HubSpot data or a direct
   HubSpot property update, projected credits are 0. External enrichment/research gaps
   can show a range and must clarify that the debit happens only when useful output is
   returned.
5. **Buying Group no-data state and manual build are first-class.** If no buying group
   exists, show available HubSpot contacts, manual role-slot creation, and a prospecting
   request form for missing roles with max contacts. The rep can build the group without
   AI generation. Missing roles remain empty slots or Data Gaps; they are never named with
   fabricated people.
6. **Buying Group role counts are flexible but people counts stay real.** Reps can add
   multiple champions, blockers, influencers, decision makers, budget holders, etc. The
   invariant from round 12 still applies: named role occupants must come from People-tab
   contacts/prospects or HubSpot associated contacts. Extra role slots can be unfilled.
7. **HubSpot sync is explicit and visually clear.** Replace arrow/navigation-looking
   affordances with a sync/write-style action and copy such as **Sync selected roles to
   HubSpot**. The app never automatically syncs buying-group or contact data to HubSpot.
   A sync writes only selected role/contact data and logs the actor, target, fields, and
   result.
8. **People cards show real contact fields.** Cards/details must display the required
   contact context fields from round 12 where available: city, country, country code,
   state/region, state/region code, job title, employment role, seniority, sub-role, name,
   and LinkedIn URL. Do not use "Remote" as filler unless the source data literally says
   remote. If existing HubSpot contacts are complete enough, show contact-ready/reach-ready
   states.
9. **Signals need real filters, timestamps, and provenance.** Add working filters for
   Company vs Contact signal level and signal type. Source is still visible but should
   not be the primary filter. Every signal has a timestamp/occurred-at value, visible
   provenance, and a detail panel with CRM engagement summaries when relevant. Remove
   "Copy link" from signal actions. No-signal state offers fetch signals, account
   research, or HubSpot signal-rule setup.
10. **Apollo enrichment is usually a data/system event, not a buying signal.** "Two new
    verified contacts returned" can resolve People/Buying Group/Data Gaps, but should not
    be ranked as observed market intent unless there is a separate observable external or
    CRM behavior signal. Store/show it as a data event by default.
11. **Superadmin-defined HubSpot signals are feasible and should be in Settings.** The app
    can let a superadmin create internal HubSpot signal rules from properties, lists,
    object changes, workflow webhooks/custom-code calls, or custom event occurrences.
    Each rule selects object (company/contact/deal), trigger type, property/list/event,
    condition, label/type, signal level, strength, and expiration/lookback (for example
    14 or 30 days). Ingested events render as HubSpot-source signals and cost 0 credits
    because the data already lives in the CRM. Feasibility basis from HubSpot docs:
    Properties API exposes default/custom object properties; Lists API exposes segments
    and memberships; Webhooks supports property-change subscriptions for companies,
    contacts, and deals; Custom Events can target CONTACT, COMPANY, DEAL, TICKET, or
    custom objects; workflows can run custom code or call our webhook to emit an app
    signal.
12. **HubSpot recent intent is a default read path, not only a custom-rule path.** The
    signal tracker should read the company property **Recent Intent Signals**
    (`hs_recent_intent_signals`) by default and render it as HubSpot-source company-level
    signal evidence at 0 credits. This does not require the customer to create a custom
    signal rule. It does require HubSpot intent tracking to be enabled/tracking the
    company; otherwise HubSpot will not populate the property and the UI should explain
    "HubSpot intent tracking is not active for this company" with an admin/user action to
    start tracking in HubSpot where permitted. Keep the custom signal-rule builder as an
    advanced admin extension for properties, lists, object changes, workflows/webhooks,
    and custom events that are not covered by this built-in property.
    Reference: HubSpot KB "Use intent signals" confirms Recent intent signals is
    automatically updated for tracked companies and only considers signals from the last
    30 days: https://knowledge.hubspot.com/reports/use-intent-signals.
13. **Pricing hierarchy must match provider cost shape.** People prospecting/enrichment
    is the primary spend driver. Buying-group mapping/regenerate is very low cost (1
    credit by default, or 0.5 if fractional credits are supported). Account research is
    low cost. Trigify monitor/fetch economics remain separate from account research
    because Trigify has recurring credits and plan lookback limits. All values remain
    config-driven and observable in Usage & logs.

## 3. Technical Design Document

**Apply — new subsystems (all tenant-isolated, config-driven, BYO keys):**

1. **Signal substrate** — as per `.claude/tasks/trigify-signals-into-account-planning.md`
   (signals store, poller, ranking, adapter composition). Unchanged.
2. **Account research / workspace generation orchestrator** — account research remains
   `POST /api/research/:companyId` and renders in Context. First-run/no-data generation
   uses a scope-aware orchestrator (for example `POST /api/account-workspace/:companyId/
   generate`) that accepts selected modules (`research`, `buying_group`, `people`,
   `outreach`, `signals`) plus people prospecting constraints (max contacts, target
   roles/personas). It gathers CRM context + signal store + Exa retrieval only for the
   selected modules, synthesizes via the tenant's LLM into structured research sections
   when requested, and supports no-open-deal/no-data records explicitly. The credit path
   is output-based: preview estimated ranges, then debit only saved/generated outputs or
   returned usable contacts.
3. **Data-gap engine** — evaluates company/contact/research/signal completeness against a
   configurable required-property manifest and writes tenant-scoped `account_data_gaps`:
   object type, property key/label or coverage category, gap type, severity, impact,
   suggested fix, actual owner HubSpot user/name, status, source, projected credits, and
   resolution audit. HubSpot-source gaps are 0-credit. It feeds Overview blockers, Data
   Gaps tab, Plan context, and QA/no-data states. It never writes CRM fields silently;
   Update CRM and task creation are explicit actions. Deal absence, provider setup,
   Woodpecker connection state, and credit blockers are account/settings blockers, not
   Data Gaps.
4. **Outreach pipeline** — TS port of the OpenClaw envelope model:
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
   Woodpecker export is reuse-first: before creating a campaign, the adapter must list or
   search existing tenant campaigns, recommend matches by account + angle + signal/channel
   (Angle + Signal for pitch/direct motions), and add the person to the selected existing
   campaign unless the user explicitly chooses to create a new one.
5. **Notification propagation** — poller, on NEW qualifying signal: (opt-in per tenant)
   writes app-namespaced company properties (`hap_latest_signal_type`,
   `hap_latest_signal_headline`, `hap_latest_signal_at`, `hap_signal_strength`,
   `hap_signal_evidence_url`). Customers build native HubSpot workflows on property
   change → in-app/email/Slack notification. Ship 2–3 documented workflow recipes.
   (Timeline/app events on the new developer platform require HubSpot approval — tracked
   as a later enhancement, not V2-blocking.)
6. **Custom workflow action** — registered via Automation API v4
   (`POST /automation/actions/2026-03/{appId}`), `objectTypes: ["COMPANY"]`, actionUrl →
   our API; action "Generate Account Snapshot/Research" with input fields (depth,
   regenerate?) and output fields (state, strength, reason headline) usable in later
   workflow steps. actionUrl endpoint verifies HubSpot signature; async completion
   supported for long research runs.
7. **HubSpot-defined signal rules** — settings/admin subsystem for superadmins to define
   CRM-native signals from HubSpot data. Baseline ingestion should first read HubSpot's
   built-in company property **Recent Intent Signals** (`hs_recent_intent_signals`) for
   tracked companies and normalize its 30-day rolling unique intent-signal types into
   HubSpot-source company-level signal rows with provenance and zero credit debit. Empty
   values are ambiguous until the app knows whether HubSpot is tracking that company; show
   a tracking-required/setup state when tracking is off. The advanced rule builder then
   covers additional properties, lists, object changes, workflow webhooks or custom-code
   calls, and custom event occurrences. Rules are tenant-scoped and include object type,
   trigger source, condition, mapped signal type, level (company/contact), strength,
   expiration/lookback, enabled state, and audit metadata. Ingestion writes timestamped
   HubSpot-source signal rows with provenance and zero credit debit.
8. **Two UI surfaces** — (a) `crm.record.tab` extension (HubSpot components);
   (b) hosted settings web app (our stack) for install-time and ongoing configuration:
   providers/keys, Trigify monitors (spend-gated), outreach config (positioning,
   vocabulary, frameworks, sender identity), notification toggles + recipes, plan/usage.

## 4. Data Schema Design

**Apply — new tables (all with `tenant_id` FK + RLS for `hap_app`):**

- `signals`, `company_signal_map`, `trigify_monitors` — per the Trigify plan (tasks 1–12).
- `account_research` — id, tenant_id, company_id, status, sections (jsonb), sources
  (jsonb, provenance), generated_by (llm provider/model), created_at; latest-per-company
  view; regenerate keeps history.
- `account_data_gaps` — id, tenant_id, company_id, contact_id?, object_type
  (company/contact/research/signal_coverage/buying_group_coverage), property_key?,
  property_label?, gap_type, severity, impact, suggested_fix, owner_hubspot_user_id?,
  owner_display_name, source, projected_credits, credit_policy
  (hubspot_zero_credit/output_based/fixed), status (open/in_progress/resolved/ignored),
  resolution_ref, created_at, updated_at. Feeds Overview blockers and the Data Gaps tab;
  no silent CRM writes. Do not store account business states such as no-open-deal,
  settings states such as Woodpecker not connected, or budget blockers as data-gap rows.
- `account_generation_runs` — id, tenant_id, company_id, requested_by_hubspot_user_id,
  trigger (workspace/workflow), requested_scope_items (jsonb array: research,
  buying_group, people, outreach, signals), people_constraints (jsonb: max contacts,
  target roles/personas), projected_credit_min, projected_credit_max, debited_credits,
  returned_output_counts (jsonb), status, blockers (jsonb), created_at, completed_at.
  Lets the configurable no-data generation journey be audited and resumed while preserving
  output-based debit semantics.
- `generation_run_items` — id, tenant_id, generation_run_id, item_type, status,
  projected_credit_min, projected_credit_max, debited_credits, output_ref, output_count,
  provider_ref, created_at, completed_at. This is the line-item ledger explaining why the
  final debit can be lower than the estimate.
- `outreach_drafts` — id, tenant_id, company_id, snapshot_id?, envelope (jsonb), cadence
  (jsonb), copy (jsonb), qa (jsonb), status (draft/qa_passed/approved/exported/rejected),
  approved_by, created_at, updated_at.
- `outreach_campaigns` — tenant-local mapping for external outreach campaigns:
  tenant_id, company_id, provider (`woodpecker` initially), external_campaign_id,
  angle_id/angle_key, primary_signal_key/headline, channel_variant, name, status,
  last_synced_at, created_by, created_at, updated_at. Unique enough to prevent accidental
  duplicate campaigns for the same account + angle + signal/channel while still allowing
  explicit user-created exceptions.
- `outreach_campaign_members` — tenant_id, campaign_id, contact_id/person_key, draft_id?,
  external_prospect_id, snippets/custom_fields (jsonb), export_status, added_by,
  added_at. This is the join that lets one Woodpecker campaign hold many personalized
  prospects without creating person-per-campaign duplicates.
- `outreach_config` — id, tenant_id, positioning (jsonb), vocabulary (jsonb), frameworks
  (jsonb), export_provider (nullable), settings (jsonb). **DECIDED 2026-07-06 (Romeo):
  own explicit table** — not `provider_config` rows.
- `buying_groups` — id, tenant_id, company_id, deal_id?, role_slots (jsonb: role,
  person/contact ref nullable, evidence, confidence, source: ai|rep, slot status),
  edits (jsonb, rep-edit history), synced_at?, created_at, updated_at. Multiple slots per
  role are allowed, but any named occupant must reference a real People-tab or HubSpot
  contact/prospect.
- `hubspot_signal_rules` — id, tenant_id, name, object_type (company/contact/deal),
  trigger_type (property_change/list_membership/object_change/custom_event/workflow),
  trigger_ref, condition (jsonb), signal_type, signal_level, strength, expires_after_days,
  enabled, created_by_hubspot_user_id, created_at, updated_at.
- `hubspot_recent_intent_state` (or equivalent account-signal metadata) — tenant_id,
  company_id, hubspot_property_key (`hs_recent_intent_signals`), tracking_status
  (tracked/not_tracked/unknown/no_scope), last_read_at, raw_property_value, normalized_types
  (jsonb), source_updated_at?, error. This separates "HubSpot is not tracking this company"
  from "tracked but no recent intent types returned".
- `hubspot_signal_events` — id, tenant_id, rule_id, object_type, object_id, occurred_at,
  expires_at, title, summary, provenance (jsonb), status, created_at. For
  `hs_recent_intent_signals`, `rule_id` may be null and provenance should identify the
  HubSpot property read. Feeds `signals` as HubSpot-source, zero-credit observed/internal
  signals.
- `notification_settings` — tenant_id, enabled (bool), property_writes_enabled (bool),
  min_tier (A/B/C), updated_at. (May fold into tenant settings jsonb.)

## 5. Feature Implementation Plan

**Apply — phase map:**

- **Phase A (in flight):** Trigify signal substrate — tasks 1–12 of
  `.claude/tasks/trigify-signals-into-account-planning.md`.
- **Phase B:** Account workspace UI (8-tab translation to HubSpot components) + hosted
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
  portal; Signals tab filters/provenance; Data Gaps renders actionable gaps; Context
  renders research with sources.
- Research: generate → persisted → regenerate keeps history; degraded provider → explicit
  degraded state, never fabricated content. No-deal and no-data company records must
  render useful generation states with projected credit cost and personal remaining
  credits.
- Outreach: golden-envelope contract test (each step receives the WHOLE envelope — port
  of OpenClaw `test_envelope_contract.py`); QA gate blocks fabricated stats/links; a
  derived signal in the envelope never surfaces in copy; DRAFT-only invariant test — no
  network call to any send provider without approved status + user action. Woodpecker
  export tests must prove campaign reuse is the default: matching campaigns are suggested,
  adding a second person reuses the selected campaign, snippets/custom fields differ per
  prospect, and campaign creation only happens after an explicit "Create new campaign"
  action from the modal.
- Notifications: property writes only when enabled; workflow recipe fires end-to-end on
  the test portal.
- Workflow action: definition registers on app install; execution generates
  snapshot/research and returns output fields; signature-invalid requests rejected.
- Credits/journey: rep-initiated **Build this account workspace** flow lets the rep choose
  modules, set people prospecting max contacts/roles, and see output-based projected
  ranges before running. Clicking generate does not debit by itself; final debit matches
  saved outputs/usable returned contacts. HubSpot-source reads/fixes debit 0 credits.
- HubSpot recent intent: fixture a company with `hs_recent_intent_signals` populated and
  assert the Signals tab renders HubSpot-source company-level signal types at 0 credits.
  Fixture a tracked company with an empty value and a not-tracked company with an empty
  value; only the latter may show the tracking-required state. Do not require a custom
  signal rule for the built-in property path.
  Runs block cleanly when tenant credits, rep monthly cap, or provider setup are
  insufficient; writes usage/audit events for success and blocked attempts.
- HubSpot signal rules: superadmin can create a property/list/custom-event/workflow rule;
  matching events render as HubSpot-source company/contact signals with timestamps,
  visible provenance, expiration behavior, and 0-credit usage events. Disabled or expired
  rules do not create active signals.
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
