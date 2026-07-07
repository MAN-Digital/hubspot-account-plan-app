# Planning Document Index — HubSpot Account Plan App

Local destination: `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App`

## Current status

This index is the top-level map for the planning bundle that is actually
present in this repository today.

Use it to find:

- the repo-local planning files that exist now
- the execution-facing task, preflight, and security docs
- the current slice plans under `.claude/tasks/`
- the most important upstream ChatPRD source links

Transcript work remains deferred.

---

## 1. Present local planning files

Currently present under `planning/`:

- `planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
- `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md` — the V2 expansion authorization
  (Trigify signals, 8-tab workspace UI including Data Gaps, account research, outreach
  engine, no-deal/no-data generation journeys, notifications, workflow action). Synced
  into the ChatPRD cloud docs through round 13 on 2026-07-07; local mirror kept for
  re-sync. Round 12 locks Data Gaps to missing/stale CRM properties, enrichment/research
  outputs, and coverage inputs only; round 13 adds configurable first-run generation,
  output-based credits, flexible buying-group roles, real signal filters, and
  HubSpot Recent Intent Signals (`hs_recent_intent_signals`) as the default zero-credit
  company-intent read path for tracked companies, plus superadmin-defined HubSpot signal
  rules as an advanced extension.
- `planning/chatprd/PRICING_AND_PACKAGING.md` — Pricing & Packaging ChatPRD mirror
  refreshed into ChatPRD on 2026-07-07.
- `planning/chatprd/CREDIT_ECONOMICS_AND_SIZING.md` — Credit Economics & Sizing ChatPRD
  mirror created in ChatPRD on 2026-07-07.
- `planning/local/AI_CODING_RULES_AND_STANDARDS.md`
- `planning/local/TASKMASTER_EXECUTION_PRD.md`
- `planning/local/STACK_HOSTING_AND_TEST_ENV_NOTES.md`

Important:

- older versions of this index referenced additional ChatPRD mirror files that
  are not currently present at those exact local paths
- that is a path-maintenance issue, not a product-direction issue
- use the upstream ChatPRD links below for those source documents

---

## 2. Active execution artifacts in-repo

- `CLAUDE.md`
- `AGENTS.md`
- `.taskmaster/docs/prd.md`
- `docs/security/SECURITY.md`
- `docs/slice-3-preflight-notes.md`
- `docs/slice-4-preflight-notes.md`
- `docs/phase-5-doc-alignment.md`
- `docs/phase-6-doc-alignment.md`
- `docs/slice-5-preflight-notes.md`
- `docs/slice-6-preflight-notes.md`
- `docs/slice-11-preflight-notes.md`
- `docs/runbooks/tenant-offboarding.md`
- `docs/runbooks/lifecycle-subscription-bootstrap.md`
- `docs/security/slice-5-audit.md`
- `docs/security/slice-6-audit.md`
- `docs/security/slice-11-audit.md`
- `.claude/tasks/2026-04-16-slice-3-phase-3-rls-card-bundling.md`
- `.claude/tasks/2026-04-16-slice-4-settings-configuration.md`
- `.claude/tasks/2026-04-17-slice-5-production-marketplace-readiness.md`
- `.claude/tasks/2026-04-17-slice-6-install-lifecycle-offboarding.md`
- `.claude/tasks/2026-04-17-slice-7-lifecycle-journal-ingestion.md`
- `.claude/tasks/2026-04-17-slice-10-upload-profile-wiring.md`
- `.claude/tasks/2026-04-18-slice-11-lifecycle-subscription-bootstrap.md`
- `.claude/tasks/2026-04-19-slice-11-dev-operationalization.md`
- `.claude/tasks/trigify-signals-into-account-planning.md` — ACTIVE plan: Stage A
  (Trigify signal substrate, tasks 1–11) + Stage B (V2 expansion, tasks 13–19, gated on
  the ChatPRD sync — satisfied through round 13 on 2026-07-07). Contains the ChatPRD
  doc-UUID registry in its Notes section.
- `docs/runbooks/slice-11-dev-quickstart.md`
- `docs/superpowers/plans/2026-04-14-slice-1-core-domain.md`
- `docs/superpowers/plans/2026-04-15-slice-2-live-integrations.md`
- `docs/superpowers/plans/2026-04-15-slice-3-oauth-public-app.md`

---

## 3. Taskmaster execution inputs

- `.taskmaster/docs/prd.md`
- `planning/local/TASKMASTER_EXECUTION_PRD.md`

Purpose:

- `.taskmaster/docs/prd.md` is the execution-facing PRD for Taskmaster
- the local planning copy stays useful for repo-native execution context

---

## 4. Recommended reading order

If someone is joining active implementation now, read in this order:

1. `.claude/tasks/<current-slice>.md`
2. `CLAUDE.md`
3. `AGENTS.md`
4. `docs/security/SECURITY.md`
5. `.taskmaster/docs/prd.md`
6. `planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md`
7. `planning/local/TASKMASTER_EXECUTION_PRD.md`

---

## 5. Best current source documents in ChatPRD

### Implementation Plan

https://app.chatprd.ai/chat/9a823a82-230a-4d69-99f2-8f8ab0ad85bf?doc=7321e14b-ada3-4265-a4e9-d1cda84dfe55&vers=e4f12945-0e88-4975-bd8f-faa2edc0ce54

### AI Coding Rules & Standards

https://app.chatprd.ai/chat/8f94764f-40d2-4ec7-af32-6acddc224c80?doc=7d454b45-7ac2-4c28-83d6-76570c9b245e

### Product Brief for AI Development

https://app.chatprd.ai/chat/a6cc6c7f-f81a-44cd-a58f-d0a103a62ae8?doc=b39ce5e7-480e-44f1-9fe8-88bc591308f4

### Repo Draft & Execution Checklist

https://app.chatprd.ai/chat/b3484579-353d-439d-9126-da35d7955fde?doc=d1591ae5-b3cd-4595-8238-a6005502d785&vers=464aa340-0564-4bf8-a397-7ac60b838948

### Security / Permission Gate

https://app.chatprd.ai/chat/fec5394b-cfd7-48ba-96e9-2356656ef0d0?doc=ed0efb92-7e4e-4716-8674-f9013e8f01e8&vers=327f5454-212c-46c7-8c05-d27dc2100ab7

### Spec for AI Prototyping

https://app.chatprd.ai/chat/2cdfb7f1-cd53-4fc1-8b99-383cbd2a06c4?doc=deacf6b3-ef2f-4930-a4fa-0d48019cb2d4&vers=0fef3cf0-b259-4d87-a733-5bbacfc1e1cb

### QA & Verification Plan

https://app.chatprd.ai/chat/a2f0a41d-35d7-46f9-91e7-161f0e8817ac?doc=041bbd8a-57bb-4e87-85bd-4c490dead022

(Canonical copy — carries the 2026-07-06 V2 update. Two older duplicates exist in
ChatPRD: docs `7aed1d8b-...` and `f704414e-...`; ignore or delete them.)

### Technical Design Document

https://app.chatprd.ai/chat/ea452928-c142-415c-9012-871d72d550ae?doc=86ffe0e4-63d1-43a1-a96a-28e92dcdf533

### Database Schema Design

https://app.chatprd.ai/chat/74f66593-e087-4903-8352-02d2c76adbdc?doc=8554b95a-8da2-428c-9a24-d3dd92d4904e

### Feature Implementation Spec (Workspace Snapshot, Summary, Signals)

https://app.chatprd.ai/chat/fa28a503-d968-44a6-97f9-4cb5f8a428d3?doc=ca7aa079-e1a7-45c9-b719-7552d51c275e

### Pricing & Packaging

https://app.chatprd.ai/chat/ca8b9d34-24fa-432a-9ed2-fada6592bb40?doc=0b2aae63-a4de-4ebe-bf13-41124843cf2b

### Credit Economics & Sizing

https://app.chatprd.ai/chat?doc=faa0a41d-407b-4fe9-83b9-e7a6845a2a86

### Engineering Handoff

https://app.chatprd.ai/chat/643c3e89-701c-405e-b859-6ad5545dfa99?doc=b018a084-a75c-4d27-89ae-91db4f4be454

All ChatPRD documents above carry the V2 expansion delta through round 13 as of
2026-07-07 (source: `planning/chatprd/V2_OUTREACH_EXPANSION_PRD_DELTA.md`). Programmatic
access: the `chatprd` MCP (`get_document` with the `doc=` UUID from each link).

---

## 6. Important notes

- The planning direction is still sound.
- The main maintenance issue has been stale local path references, not missing product intent.
- `CLAUDE.md`, `AGENTS.md`, `docs/security/SECURITY.md`, and the active
  `.claude/tasks/` slice plan are the most reliable repo-local execution guides.
- The Taskmaster execution PRD is intentionally thinner than the full planning
  stack and should not replace upstream planning documents.
- If any conflict appears between repo-local mirrors and ChatPRD, use the
  precedence rules from the AI Coding Rules & Standards.

---

## 7. Maintenance rule

Treat this index as a maintained map, not a historical dump.

Update it whenever:

- a new binding slice plan is added
- a repo-local planning mirror is added or removed
- a current execution document changes location
