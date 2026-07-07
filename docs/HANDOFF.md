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
(+17a-d, 14b). Feedback through round 10 (2026-07-07) is recorded in the plan + delta +
ChatPRD + Magic Patterns, all in lockstep. Key decisions (details in plan/delta):

1. 7-tab UI: Overview / People / Buying Group / Signals / Outreach / Plan / Context.
2. Buying Group = OrgChartHub-style org chart, AI-generated + fully editable (replace-
   person via CRM contact picker in BOTH views, placeholders, edits survive Regenerate);
   sync to HubSpot via associations-v4 labels (opt-in; native = Enterprise-only, no API).
3. Plan tab = pure editable account plan; plan edits VISIBLY rebuild outreach.
4. Outreach tab = AI-ranked targets, per-person cadence, status machine
   Building→Draft→In review→Approved→Exported, approve-gate; REBUILD LOCKOUT (grayed +
   server rejects stale approve/export).
5. THREADING invariant: follow-ups always reply in first email's thread (Woodpecker
   subject:null steps 2+; QA hard-fails new subjects).
6. Exports: HubSpot TASKS = default (one task per touch w/ approved copy; API cannot
   inject copy into sequences — enrollment = {contactId,senderEmail,sequenceId} ONLY);
   sequences = template motions w/ mandatory disclaimer; Woodpecker = THE full-custom-
   copy channel (LinkedIn steps: PROFILE_VISIT/CONNECTION_REQUEST/DIRECT_MESSAGE/INMAIL)
   and is **campaign-reuse-first**: add people to an existing account/angle/signal
   campaign by default; do not create one Woodpecker campaign per person.
7. Angles: campaign-level (Interview/Feedback/Event×3/Direct + prompt-to-angle w/
   research); GOVERNANCE: create/edit in Settings behind superadmin, per-angle
   enabled-for-reps, server-side enforcement; QA hard-fails angle violations.
8. Warm intro: manual mutual connections (min 3; each REQUIRES name + validated
   LinkedIn URL), enrich (HubSpot/Apollo/research), score/rank, editable DM,
   "Open in LinkedIn + copy message" (compose deep link works; BODY PREFILL IMPOSSIBLE
   → clipboard). CTD.ai = optional V2.5 warm-path provider. Warm-paths chips in UI.
9. Credits & tiers (round 6, numbers gated on pricing research): managed-keys vs BYO on
   one credit-metering system (`credit_ledger`); Free trial ~30 credits / Pro from
   $99/mo (we manage keys EXCEPT Woodpecker) / Enterprise (BYO + custom + full-service).
   Apollo PROMOTED to the prospecting/enrichment provider. Open decision: show
   underlying API sources on managed tier (recommend yes).
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
10. Mintlify docs task 19b (repo `romeoman/mintlify-docs`, `mint` CLI, deploy on push).

**App roles & permissions (round 9):** three app roles layered on HubSpot's own perms —
**superadmin** (billing, provider keys, angle governance, roles + per-rep budgets, view
logs), **admin** (settings + logs; no billing/roles), **rep** (workspace use; own usage
visible; no settings). All role/budget/log routes enforce the role SERVER-SIDE, tenant-
scoped by RLS; the HubSpot user roster requires the users-read scope and degrades to an
empty state if not granted. App scopes ≠ installer day-to-day visibility (CLAUDE.md rule). 11. OpenClaw engine port must track its CURRENT state — commits `177929a` (breakup
retired, LinkedIn frameworks/steps) + F-series (15-key slot contract, signal_json
contact identity, constant-time Woodpecker webhook compare).

## 3. External surfaces & registries

- **ChatPRD** (source-of-truth PRDs, project "Account Planning in HubSpot"):
  https://app.chatprd.ai/drive/projects/1775585518010-account-planning-in-hubspot —
  **ROUNDS 8 & 9 SYNCED 2026-07-07** via direct authenticated ChatPRD MCP after the
  Codex `mcp login chatprd` flow. Existing docs were updated with the marker
  `ChatPRD sync addendum — rounds 8 and 9 — 2026-07-07`; Pricing was refreshed from
  `planning/chatprd/PRICING_AND_PACKAGING.md`; the NEW "Credit Economics & Sizing"
  doc was created as `faa0a41d-407b-4fe9-83b9-e7a6845a2a86`. The earlier 2026-07-06
  export-settings/Mintlify pending re-sync was also resolved in Database, Technical
  Design, and Repo Draft & Execution Checklist.
  Remaining ChatPRD cleanup is UI-only: move root-level docs into the project if still
  needed and archive duplicate QA docs (`f704414e`, `7aed1d8b`). MCP: `chatprd` (HTTP,
  OAuth, can flap across restarts — retry once, then re-auth with `codex mcp login
  chatprd` if needed).

### ChatPRD sync — RESOLVED (rounds 8 & 9)

**Status:** rounds 8 and 9 are now in the ChatPRD cloud docs. Verification readbacks on
2026-07-07 found the sync marker in each changed document, plus Pricing-specific checks
for "top-up credits never expire" and "Per-contact pricing logic", and Credit Economics
checks for "RECURRING monitor credits".

**ChatPRD project:** https://app.chatprd.ai/drive/projects/1775585518010-account-planning-in-hubspot

**Repo source → ChatPRD target mapping (all paths relative to repo root):**

| Repo source (canonical)                                             | Round | ChatPRD target doc (UUID)                                      |
| ------------------------------------------------------------------- | ----- | -------------------------------------------------------------- |
| `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md` §2d           | 8     | "Specs for the AI prototype" + "Feature Implementation Spec"   |
| `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md` §2e           | 9     | "Security & Permission Gates" + "Technical Design Document"    |
| `planning/chatprd/PRICING_AND_PACKAGING.md` (per-contact + top-ups) | 8/9   | "Pricing & Packaging" (`0b2aae63-a4de-4ebe-bf13-41124843cf2b`) |
| `planning/chatprd/CREDIT_ECONOMICS_AND_SIZING.md` (NEW doc)         | 9     | "Credit Economics & Sizing" (`faa0a41d-407b-4fe9-83b9-e7a6845a2a86`) |
| `tenant_users` + `usage_events` schema (delta §2e / plan task 15c)  | 9     | "Database Schema Design" (`8554b95a-...`)                      |
| `docs/HANDOFF.md` (this file)                                       | 8/9   | "Engineering Handoff" (`b018a084-a75c-4d27-89ae-91db4f4be454`) |

**Other repo paths a syncing agent needs:**

- Execution plan (all rounds, tasks 13–19c incl. 15c RBAC): `.claude/tasks/trigify-signals-into-account-planning.md`
- Round-by-round delta (§2a–§2f, all synced through round 10): `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md`
- Planning index (resolves any moved paths): `PLANNING_INDEX.md`

**Remaining ChatPRD UI-only cleanup:** root-level docs — "Pricing & Packaging"
(`0b2aae63-...`), "Engineering Handoff" (`b018a084-...`), and possibly "Credit Economics
& Sizing" (`faa0a41d-...`) — should be moved into the project if still in the drive root;
duplicate QA docs (`f704414e`, `7aed1d8b`) should be archived/deleted. These are UI
actions in ChatPRD, not MCP calls.

- **Magic Patterns** (canonical clickable UI): editor `xmdzva7bxdn4ubmtrbvs35`, active
  artifact `16a33879-e765-4b23-af0d-f2f249e73c75` (v13, round 10 — Woodpecker
  Modal Reuse-First Flow; built on v11 round-9 Team & access + Usage & logs settings
  tabs, v9/v10 round-8 Overview hub, ranked signals, cross-ref outreach, toggle fix,
  and plain-English notifications) —
  the editor is collaborative, so always call `get_artifact` for the CURRENT active
  artifact instead of trusting a cached ID. `v2/*` files; `v2/AppV2.tsx` switches
  between the workspace view (7 tabs) and the settings view (header settings button →
  `AppSettingsChromeV2`, back link returns). **COMPLETE — published through
  round 7b (2026-07-07), both app AND app settings verified live in v8:** all 7 workspace tabs, TrackSignalsModal, OutreachTab (angles
  picker read-only for reps, warm intro w/ required LinkedIn URLs, rebuild lockout,
  three-way export, thread badges, signal chips), org-chart BuyingGroupTab w/ contact
  picker, and the app-settings page inside accurate Connected-Apps chrome
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
