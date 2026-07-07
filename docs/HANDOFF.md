# Engineering Handoff — HubSpot Signal-First Account Workspace

**Written:** 2026-07-07 · **For:** any coding agent/human continuing this work (Codex,
Claude, or other). Read this FIRST, then `PLANNING_INDEX.md`, then the plan file below.

## 1. What this project is

HubSpot `crm.record.tab` app: one credible, evidence-backed reason to contact an account
now + up to 3 people (V1, SHIPPED) — expanding into a signal-first account workspace
with Trigify buying-intent signals, buying groups, and a DRAFT-only outreach engine (V2,
fully specified, build not started except Stage A).

- **Monorepo:** pnpm. `apps/api` (Hono), `apps/hubspot-extension` (React,
  `@hubspot/ui-extensions` ONLY), `packages/{db,config,validators}` (Drizzle/Postgres).
- **Iron rules:** TDD mandatory (failing test first); tenant isolation everywhere
  (tenant_id + RLS via `hap_app` role); BYO keys encrypted per tenant; no silent CRM
  writes; DRAFT-only outreach (nothing ever auto-sends); derived signals NEVER asserted
  in copy; verify before claiming done. See `CLAUDE.md` + `AGENTS.md`.

## 2. Current state (2026-07-07)

### Shipped on main

- **Stage A (Trigify signal substrate) — PR #55, squash `76025af`:** `signals`/
  `company_signal_map`/`trigify_monitors` tables (migration 0011, RLS), TrigifyClient
  (free reads; confirm-guarded subscription create), ranking port (derived-alone = 0),
  normalize + company/person matching, poller + `/admin/trigify-poll` (mounted, live-
  verified 200), TrigifyStoreAdapter composed with Exa (`REAL_SIGNAL_PROVIDERS`),
  `extractDominantSignal` skips `copyAssertable === false`, real HubSpot fetchers
  (fixtures env-gated), spend-gated monitor manager (dry-run default, fail-closed
  budget), settings key entry (`signalProviders.trigify`), extension settings UI +
  8-state verification. Suite ~1191 tests green at ship time.
- Security audit PASSED (report-only; 3 LOW/INFO advisories). Live smoke: SHIP-WITH-NOTES.
- **Supabase advisor fix (PR #72, migration `0012_tenants_rls_and_rest_revoke`):** the
  `tenants` bootstrap table had no RLS (deliberate 0007 exclusion) and Supabase's default
  `anon`/`authenticated` PostgREST grants made it publicly readable/writable. 0012
  enables RLS on `tenants` (never FORCE — owner runs migrations/lifecycle) with
  `tenants_read_all` (SELECT, any granted role — tenant resolution, nonce sweeps, and
  uninstall flows read tenants BEFORE tenant context exists) + `tenants_app_role_write`
  (ALL, `hap_app` only), and revokes ALL `anon`/`authenticated` grants on every public
  table/sequence incl. default privileges. **Applied to production 2026-07-07 and
  verified live:** grants = 0 rows (was 77 each), anon-key REST probe → 401 "permission
  denied". Contract tests: `packages/db/src/schema/__tests__/tenants-rls.test.ts`;
  the RLS write-path suite grants `hap_app` membership to its test login role (models
  production posture). Suite 126 files / 1199 tests green.
- **PROD MIGRATION GOTCHA:** `packages/db/drizzle.config.ts` loads `.env.test.local`
  with `override: true`, so `DATABASE_URL=<prod> pnpm db:migrate` silently migrates the
  LOCAL docker DB and still prints success. To migrate prod: `mv .env.test.local /tmp/`,
  run the migrate, move it back, then VERIFY on prod (`drizzle.__drizzle_migrations`
  row count must grow).
- **Test infra:** local test DB required — `pnpm test:db:up` (docker compose postgres
  :5433 + migrations + `.env.test.local` scaffold); vitest globalSetup fail-fast
  preflight. NEVER weaken the `ALLOW_TEST_AUTH` guard in `packages/config/src/env.ts`.
- **Deploy:** Vercel project `hap-signal-workspace-staging` (the only one; serves
  https://hap.mandigital.dev), **Hobby plan** → daily Vercel cron + 6-hourly GitHub
  Actions `trigify-poll.yml` (repo secret `CRON_SECRET` is SET, workflow verified live).
- **main is push-protected** — every change lands via PR (docs changes included).

### Open items from Stage A

- ONE authorized live Trigify monitor subscribe (1 credit) still UNUSED — do it via the
  settings UI with a LinkedIn **person** profile (person-level signal types; a company
  page 400s). Test portal: **147062576**. Budget is fail-closed: set
  `provider_config.settings.creditBudget` first.
- Extension not yet uploaded to the portal (`hs project upload`).
- Duplicate ChatPRD QA docs (`f704414e`, `7aed1d8b`) — user deletes manually.

### V2: fully specified, not built

Plan: `.claude/tasks/trigify-signals-into-account-planning.md` — Stage B tasks 13–19c
(+17a-d, 14b, 14c, 15d). Feedback through round 13 plus the HubSpot recent-intent
correction (2026-07-07) is recorded in the plan + delta + ChatPRD + Magic Patterns, all
in lockstep. Key decisions (details in plan/delta):

1. 8-tab UI: Overview / People / Buying Group / Signals / Outreach / Data Gaps / Plan /
   Context.
2. Buying Group = OrgChartHub-style org chart, AI-generated + fully editable (replace-
   person via CRM contact picker in BOTH views, placeholders, edits survive Regenerate);
   sync to HubSpot via associations-v4 labels (opt-in; native = Enterprise-only, no API).
   The role list/org chart must use the same real people count as the People tab; if
   People has 3 prospects, Buying Group cannot show 7 named role occupants.
3. Overview = one top executive summary + separate Why Now + Top Signals + **This
   Outreach** + Key People + **Blockers & Risks**. Top Signals stays above This Outreach;
   blockers complement the outreach summary instead of replacing it. No-open-deal records
   show account-development metrics instead of blank deal cards. No-data records show a
   configurable **Build this account workspace** state where the rep selects modules and
   sees output-based credit ranges before running.
4. Data Gaps tab = working queue for missing/stale CRM properties, enrichment/research
   outputs, and coverage inputs only. It replaces CRM Gap/Data Quality callouts in
   Signals. Do **not** show account/business states ("no open deal"), Woodpecker/provider
   setup, or credit-pool/rep-budget issues as Data Gaps; those are Overview/Settings
   blockers. Valid examples: missing LinkedIn URL, outdated title, too few prospected
   people, missing relevant procurement/legal contact, too few observed signals, missing
   company firmographics/domain/website/LinkedIn/industry. Actions can research, enrich,
   create HubSpot tasks, update CRM explicitly, or mark not needed. No silent CRM writes.
5. Plan tab = pure editable account plan; plan edits VISIBLY rebuild outreach.
6. Outreach tab = AI-ranked targets, per-person cadence, status machine
   Building→Draft→In review→Approved→Exported, approve-gate; REBUILD LOCKOUT (grayed +
   server rejects stale approve/export).
7. THREADING invariant: follow-ups always reply in first email's thread (Woodpecker
   subject:null steps 2+; QA hard-fails new subjects).
8. Exports: HubSpot TASKS = default (one task per touch w/ approved copy; API cannot
   inject copy into sequences — enrollment = {contactId,senderEmail,sequenceId} ONLY);
   sequences = template motions w/ mandatory disclaimer; Woodpecker = THE full-custom-
   copy channel (LinkedIn steps: PROFILE_VISIT/CONNECTION_REQUEST/DIRECT_MESSAGE/INMAIL)
   and is **campaign-reuse-first**: add people to an existing account/angle/signal
   campaign by default; do not create one Woodpecker campaign per person.
9. Angles: campaign-level (Interview/Feedback/Event×3/Direct + prompt-to-angle w/
   research); GOVERNANCE: create/edit in Settings behind superadmin, per-angle
   enabled-for-reps, server-side enforcement; QA hard-fails angle violations.
10. Warm intro: manual mutual connections (min 3; each REQUIRES name + validated
   LinkedIn URL), enrich (HubSpot/Apollo/research), score/rank, editable DM,
   "Open in LinkedIn + copy message" (compose deep link works; BODY PREFILL IMPOSSIBLE
   → clipboard). CTD.ai = optional V2.5 warm-path provider. Warm-paths chips in UI.
11. Credits & tiers (round 6, numbers gated on pricing research): managed-keys vs BYO on
   one credit-metering system (`credit_ledger`); Free trial ~30 credits / Pro from
   $99/mo (we manage keys EXCEPT Woodpecker) / Enterprise (BYO + custom + full-service).
   Apollo PROMOTED to the prospecting/enrichment provider. Reps can generate full account
   workspace outputs ad hoc from a company record if tenant credits and their personal
   monthly cap allow it; every credit CTA shows projected range + rep remaining + tenant
   remaining. Clicking generate does not debit; debits happen only for saved outputs or
   usable returned data. HubSpot-source reads/fixes cost 0 credits.
   Open decision: show underlying API sources on managed tier (recommend yes).
   9b. Settings IA (round 7): native HubSpot app settings page (new-platform settings
   component) replaces the hosted settings app (now fallback); superadmin/admin-only
   w/ server-side role checks; provider taxonomy Signals/Research/People(Apollo+
   Harvest)/Delivery(Woodpecker BYO always)/AI; BYO key fields only on Enterprise
   plans; no manual monitor form (card-contextual only).
   9c. Round 8 (2026-07-07): Overview tab =
   summary hub (Tracking/monitors, ranked Top signals across ALL sources incl. Apollo,
   buying-group coverage, outreach+warm-paths status, plan one-liner — all deep-linked);
   signals ranked hottest-first w/ heat/tier indicator + broader Trigify signal variety;
   Sales-Hub-Enterprise note DELETED from Buying Group; **multi-stakeholder outreach
   must cross-reference colleagues' outreach** (engine coordinates roster-wide,
   "Cross-ref" chips per step, QA hard-fails missing/fabricated/out-of-order
   references); settings: shared Toggle component fixed (knob escaped pill when ON),
   Notifications in plain English (no `hap_*` jargon in UI; "Add signal updates to the
   company record"), workflow-recipes/technical items removed from settings; pricing
   CONFIRMED Pro 500 credits/mo + never-expiring top-ups, per-contact pricing logic in
   `planning/chatprd/PRICING_AND_PACKAGING.md`. Delta §2d is the canonical record.
   9d. Round 9 (2026-07-07): **Team & access RBAC** — the portal's users are fetched from
   HubSpot's user endpoints (Owners API `/crm/v3/owners` and/or User Provisioning
   `/settings/v3/users`; docs-check + scope pinned by the round-9 research, see plan
   task 15c); superadmin assigns app role (superadmin>admin>rep) + toggles app access
   per user + sets a **per-rep monthly credit budget** (enforced at debit time,
   fail-closed). New **Usage & logs** settings tab (admin-only): per-rep usage rollup +
   filterable activity/audit log (who/action/target/credits/result). New tables
   `tenant_users` + `usage_events` (tenant-scoped RLS). **Credit sizing re-examined**
   (`planning/chatprd/CREDIT_ECONOMICS_AND_SIZING.md`): 500/mo margin is safe, but the
   real constraint is recurring monitor credits; 500 stays PROVISIONAL pending
   real-usage data from the logs; open decision = decouple monitors from the credit
   pool. Delta §2e is canonical. Permissions model = §"App roles & permissions" below.
   9e. Round 10 (2026-07-07): **Woodpecker campaign reuse** — the Outreach UI/Magic
   Patterns wireframe must prompt before creating campaigns. On Woodpecker export/add
   person, suggest existing campaigns by account + angle + signal/channel (pitch/direct
   can use Angle + Signal); primary CTA = Add to selected campaign, secondary =
   Create new campaign, with View all campaigns search/filter. Personalization happens
   through snippets/custom fields and per-prospect copy, not separate campaigns/sequences.
   9f. Round 11 (2026-07-07): **Overview/Data Gaps/first-run credits** — Overview has one
   top executive summary, a separate Why Now callout, Top Signals above This Outreach,
   and Blockers & Risks without deleting the outreach mini-summary; Data Gaps is a new
   tab between Outreach and Plan/Context; no-deal and no-data company records have
   explicit wireframes; reps can generate a full account plan ad hoc with projected
   credits and remaining monthly cap shown before debit. Delta §2g is canonical.
   9g. Round 12 (2026-07-07): **Data Gap property discipline** — Data Gaps must only
   suggest missing/stale properties or coverage inputs that improve plan context.
   Required contact fields: City, Country, Country Code, Employment Role, Employment
   Seniority, Employment Sub Role, First Name, Job Title, Last Name, LinkedIn URL,
   State/Region, State/Region Code. Required company fields: Annual revenue, City,
   Company domain name, Company keywords, Company name, Country/Region, Country/Region
   Code, Description, Employee range, Industry, LinkedIn company page, Number of
   employees, Phone number, Revenue range, State/Region, State/Region Code, Street
   Address, Web Technologies, Website URL, Year founded. Optional company fields: Total
   Money Raised, X account handle. Use the "Hubspot Company Enrichment Taxonomy" Google
   Sheet for revenue ranges, employee ranges, industries, keywords, and web technologies.
   9h. Round 13 (2026-07-07): **Configurable generation + HubSpot signals** — no-data
   first run is a module picker, not one full-plan bundle. Account research lives in
   Context and is low-cost; buying-group regenerate is low-cost; people
   prospecting/enrichment is the main output-based spend. Buying Group supports empty/
   manual build states and multiple flexible role slots while preserving the real-people
   count invariant. Sync to HubSpot is explicit only and uses sync/write copy/icons.
   People cards show required contact fields. Signals filter by company/contact level and
   type, show timestamps/provenance/CRM engagement summaries, remove Copy Link, and treat
   Apollo enrichment as a data event unless paired with observable buying intent.
   HubSpot's built-in company property **Recent Intent Signals** (`hs_recent_intent_signals`)
   is the default zero-credit HubSpot intent read path for companies that HubSpot is
   tracking; if HubSpot is not tracking the company, show a tracking-required state instead
   of interpreting the empty property as no intent. Settings still adds superadmin custom
   HubSpot signal rules from properties, lists, object changes, workflows/webhooks, and
   custom events; these render as HubSpot-source 0-credit signals with expiration/lookback.
12. Mintlify docs task 19b (repo `romeoman/mintlify-docs`, `mint` CLI, deploy on push).

**App roles & permissions (round 9):** three app roles layered on HubSpot's own perms —
**superadmin** (billing, provider keys, angle governance, roles + per-rep budgets, view
logs), **admin** (settings + logs; no billing/roles), **rep** (workspace use; own usage
visible; no settings). All role/budget/log routes enforce the role SERVER-SIDE, tenant-
scoped by RLS; the HubSpot user roster requires the users-read scope and degrades to an
empty state if not granted. App scopes ≠ installer day-to-day visibility (CLAUDE.md rule).

**OpenClaw engine port:** track its CURRENT state — commits `177929a` (breakup retired,
LinkedIn frameworks/steps) + F-series (15-key slot contract, signal_json contact
identity, constant-time Woodpecker webhook compare).

## 3. External surfaces & registries

- **ChatPRD** (source-of-truth PRDs, project "Account Planning in HubSpot"):
  https://app.chatprd.ai/drive/projects/1775585518010-account-planning-in-hubspot —
  **ROUNDS 8-13 SYNCED 2026-07-07** via direct authenticated ChatPRD MCP after the
  Codex `mcp login chatprd` flow. Existing docs were updated with round markers including
  `ChatPRD sync addendum — round 11 overview/data gaps/ad hoc credits — 2026-07-07`
  `ChatPRD sync correction — round 11 single executive summary and This Outreach — 2026-07-07`,
  `ChatPRD sync addendum — round 12 data-gap property discipline — 2026-07-07`,
  `ChatPRD sync addendum — round 13 configurable generation and HubSpot signals — 2026-07-07`,
  and `ChatPRD sync correction — round 13 HubSpot recent intent property — 2026-07-07`;
  Pricing was refreshed from
  `planning/chatprd/PRICING_AND_PACKAGING.md`; the NEW "Credit Economics & Sizing"
  doc was created as `faa0a41d-407b-4fe9-83b9-e7a6845a2a86`. The earlier 2026-07-06
  export-settings/Mintlify pending re-sync was also resolved in Database, Technical
  Design, and Repo Draft & Execution Checklist.
  Remaining ChatPRD cleanup is UI-only: move root-level docs into the project if still
  needed and archive duplicate QA docs (`f704414e`, `7aed1d8b`). MCP: `chatprd` (HTTP,
  OAuth, can flap across restarts — retry once, then re-auth with `codex mcp login
  chatprd` if needed).

### ChatPRD sync — RESOLVED (rounds 8-13)

**Status:** rounds 8-13 are now in the ChatPRD cloud docs. Verification readbacks on
2026-07-07 found the sync markers in each changed document, plus Pricing-specific checks
for output-based account generation, and Credit Economics checks for the round 13
output-based workspace builder update.

**ChatPRD project:** https://app.chatprd.ai/drive/projects/1775585518010-account-planning-in-hubspot

**Repo source → ChatPRD target mapping (all paths relative to repo root):**

| Repo source (canonical)                                             | Round | ChatPRD target doc (UUID)                                      |
| ------------------------------------------------------------------- | ----- | -------------------------------------------------------------- |
| `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md` §2d           | 8     | "Specs for the AI prototype" + "Feature Implementation Spec"   |
| `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md` §2e           | 9     | "Security & Permission Gates" + "Technical Design Document"    |
| `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md` §2f           | 10    | Prototype/feature/technical/database/QA/handoff docs            |
| `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md` §2g           | 11    | Prototype/product/feature/technical/database/pricing/QA/handoff |
| `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md` §2h           | 12    | Prototype/product/feature/technical/database/QA/handoff         |
| `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md` §2i           | 13    | Prototype/product/feature/technical/database/pricing/credit/QA/handoff |
| `planning/chatprd/PRICING_AND_PACKAGING.md` (per-contact + top-ups) | 8/9   | "Pricing & Packaging" (`0b2aae63-a4de-4ebe-bf13-41124843cf2b`) |
| `planning/chatprd/CREDIT_ECONOMICS_AND_SIZING.md` (NEW doc)         | 9     | "Credit Economics & Sizing" (`faa0a41d-407b-4fe9-83b9-e7a6845a2a86`) |
| `tenant_users` + `usage_events` schema (delta §2e / plan task 15c)  | 9     | "Database Schema Design" (`8554b95a-...`)                      |
| `account_data_gaps` + `account_generation_runs` schema (delta §2g/§2h) | 11-12 | "Database Schema Design" (`8554b95a-...`)                      |
| `docs/HANDOFF.md` (this file)                                       | 8-13  | "Engineering Handoff" (`b018a084-a75c-4d27-89ae-91db4f4be454`) |

**Other repo paths a syncing agent needs:**

- Execution plan (all rounds, tasks 13–19c incl. 15c RBAC): `.claude/tasks/trigify-signals-into-account-planning.md`
- Round-by-round delta (§2a–§2i, all synced through round 13): `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md`
- Planning index (resolves any moved paths): `PLANNING_INDEX.md`

**Remaining ChatPRD UI-only cleanup:** root-level docs — "Pricing & Packaging"
(`0b2aae63-...`), "Engineering Handoff" (`b018a084-...`), and possibly "Credit Economics
& Sizing" (`faa0a41d-...`) — should be moved into the project if still in the drive root;
duplicate QA docs (`f704414e`, `7aed1d8b`) should be archived/deleted. These are UI
actions in ChatPRD, not MCP calls.

- **Magic Patterns** (canonical clickable UI): editor `xmdzva7bxdn4ubmtrbvs35`, active
  artifact `5b159270-7872-46a2-ac4d-9c8cff78ec13` (round 13 configurable generation,
  output-based credits, flexible buying-group roles, real signal filters, and HubSpot
  recent-intent/default signal-rule settings; built on v17 round-12 property-only Data Gaps, v16 round-11
  Overview layout fix, v15 blocked-budget toggle, v14
  Data Gaps/no-data empty state, v13 Woodpecker reuse-first modal, v11 round-9 Team
  & access + Usage & logs settings tabs, and v9/v10 round-8 Overview hub/ranked
  signals/cross-ref outreach/toggle/plain-English notifications) —
  the editor is collaborative, so always call `get_artifact` for the CURRENT active
  artifact instead of trusting a cached ID. `v2/*` files; `v2/AppV2.tsx` switches
  between the workspace view (8 tabs) and the settings view (header settings button →
  `AppSettingsChromeV2`, back link returns). **COMPLETE — published through round 13
  (2026-07-07):** all 8 workspace tabs incl. Data Gaps; Overview has one top Executive
  Summary, separate Why Now, Top Signals above This Outreach, Blockers & Risks,
  no-deal/no-data/full-account-plan credit preview states, and account/settings/budget
  blockers kept out of Data Gaps; DataGapsTab now only shows missing/stale CRM
  properties, enrichment/research outputs, signal coverage, or prospect coverage;
  BuyingGroupTab uses the same 3 real People-tab contacts and shows unfilled roles as
  gaps instead of inventing extra people; OutreachTab keeps angle picker read-only for
  reps, warm intro w/ required LinkedIn URLs, rebuild lockout, three-way export, thread
  badges, signal chips, and Woodpecker reuse-first campaign selection; and the
  app-settings page inside accurate Connected-Apps chrome
  (AppSettingsChromeV2) with internal tabs Plan & Billing | Providers & integrations |
  Outreach angles | Notifications. In-CRM surfaces TRANSLATE to
  `@hubspot/ui-extensions`; the settings page is a native app settings component
  (src/app/settings/), NOT a hosted web app (that's fallback only).
- **OpenClaw sources** (read-only reference, OrbStack VM): user says
  `/home/romeoman/openclaw-infra/...` = macOS
  `/Users/romeoman/OrbStack/openclaw-vm/home/romeoman/openclaw-infra/...`.
  Key: `outreach-engine/` (envelope pipeline, signal ranking, trigify client/monitors,
  Apollo in `signals_source.py`), `runtime-workspace/live/skills/` (outreach-command /
  cadence-strategist / copywriter / copy-qa / apollo-api / woodpecker / trigify).
- **Trigify account:** MAX tier, 30-day lookback, key in the VM's `openclaw-infra/.env`
  (`TRIGIFY_API_KEY`) — reads free, ONLY subscription-create spends (confirm-gated).

## 4. The working loop (user's standing rule)

EVERY decision syncs to ALL THREE surfaces in the same session: ChatPRD docs + Magic
Patterns design + repo plan/delta (via small squash-merged PRs — main is protected).
If a surface is unreachable, record a PENDING block in the delta header and clear it
when back. History of this loop: PRs #57–#65.

## 5. Where to resume

1. Finish any in-flight design/ChatPRD syncs (check delta header for PENDING blocks).
2. Pricing research → finalize the "Pricing & Packaging" ChatPRD doc numbers.
3. Stage B build: run `/team-build .claude/tasks/trigify-signals-into-account-planning.md`
   equivalent — dependency order in the plan (Stage B: 13 → 14/14b/15 → 16/17/17a-d →
   18/19/19b → validate). TDD per task, worktree `.worktrees/`, PR per stage.
4. Live smoke leftovers from §2 above.

## 6. Secrets & env inventory (NAMES only — never commit values)

`CRON_SECRET` (Vercel project env + GitHub Actions repo secret — both set),
`DATABASE_URL` (Supabase pooler prod / local :5433 test via `.env.test.local`),
`HUBSPOT_CLIENT_SECRET`, `ROOT_KEK` (repo-root `.env`), tenant provider keys live
encrypted in `provider_config` (AES-256-GCM, decrypt at point of use only),
`TRIGIFY_API_KEY` (VM `.env`, user's own account), `HUBSPOT_TEST_PORTAL_ID=147062576`.
