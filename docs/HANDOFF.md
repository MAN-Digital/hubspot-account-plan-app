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
(+17a-d, 14b). Seven feedback rounds (2026-07-07) are recorded in the plan + delta +
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
   copy channel (LinkedIn steps: PROFILE_VISIT/CONNECTION_REQUEST/DIRECT_MESSAGE/INMAIL).
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
10. Mintlify docs task 19b (repo `romeoman/mintlify-docs`, `mint` CLI, deploy on push).
11. OpenClaw engine port must track its CURRENT state — commits `177929a` (breakup
    retired, LinkedIn frameworks/steps) + F-series (15-key slot contract, signal_json
    contact identity, constant-time Woodpecker webhook compare).

## 3. External surfaces & registries

- **ChatPRD** (source-of-truth PRDs, project "Account Planning in HubSpot"):
  https://app.chatprd.ai/drive/projects/1775585518010-account-planning-in-hubspot —
  ALL 9 docs synced through round 7 (7 core docs + NEW "Pricing & Packaging"
  `0b2aae63-...` + NEW "Engineering Handoff" `b018a084-...` — the two new docs sit in
  the drive ROOT pending a manual move into the project (+round 6/pricing/handoff docs pending at write
  time). UUID registry in the plan's Notes. MCP: `chatprd` (HTTP, OAuth, flaps across
  restarts — retry once, then ask user to re-auth).
- **Magic Patterns** (canonical clickable UI): editor `xmdzva7bxdn4ubmtrbvs35`, artifact
  `b9bdba8b-9ee3-47e6-bdfc-ac3a9c15c50b`, `v2/*` files. **COMPLETE — published through
  round 7b (2026-07-07):** all 7 workspace tabs, TrackSignalsModal, OutreachTab (angles
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
