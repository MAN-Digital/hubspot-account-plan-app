# Plan: MVP Deployment Readiness

Date: 2026-05-10
Branch base: `main` (clean as of `2995e08`)
Worktree: `.claude/worktrees/amazing-kepler-6f062b` (current branch `claude/amazing-kepler-6f062b`)
Status: planning only — implementation follows in `/team-build` or `/build` against this file

## Task Description

All 11 Taskmaster tasks (75 subtasks) and slices 1–11 are merged into `main`. The MVP feature set is feature-complete on paper. Four issues remain open and one observability gap blocks meaningful end-to-end testing of the install/uninstall flow:

- **#19 (bug)** — APP_LIFECYCLE_EVENT deliveries appear missing after install/uninstall. Root-cause investigation (this session, 2026-05-10) traced this to an **observability gap, not a delivery bug**: the receiver returns `200 {applied:1}` to live signed probes, but emits zero success-path log lines, while the runbook tells operators to grep for a log line that does not exist anywhere in source. Operators cannot tell "HubSpot didn't fire" apart from "HubSpot fired and the receiver silently 200'd." Fix is small (request-arrival log + applied/ignored summary log + runbook correction) but must precede any real test-portal walkthrough.
- **Test-portal seed wiring (uncommitted)** — `package.json` and `docs/qa/test-portal-seed-plan.md` were added in this worktree but are not yet committed. The seed script (`scripts/seed-hubspot-test-portal.ts`) and tests already exist; only the wiring needs to land.
- **#16** — OAuth install success page polish + redirect back into HubSpot. UX, not blocking, but needed for a clean first-install demo.
- **#28** — Enable HubSpot enrichment by default after OAuth install so a freshly installed tenant has data without hand-config.
- **#18** — Mintlify support/docs portal. **Deferred — post-MVP.** Out of scope for this plan.

This plan is the single ordered punch-list to take MVP from "feature-complete" to "demonstrably installable, observable, and testable end-to-end against a real HubSpot test portal." It is also the reference for the `/team-build` / `/build` agent that will execute the work.

## Objective

Ship a deployable MVP where:

1. The lifecycle webhook receiver produces auditable Vercel function logs that disambiguate the three states of "no delivery / signature failure / delivery applied," and the dev runbook matches the actual log shape.
2. The test-portal seed wiring is committed, tested, and PR'd to `main`.
3. A real HubSpot test portal can be installed end-to-end, seeded with data exercising all 8 V1 QA states, and walked through in the company-record card without manual config.
4. Issues #16 (OAuth success UX) and #28 (default-on enrichment) are closed.
5. Quality-engineer signs off on a fresh end-to-end verification run before any "done" claim.

Issue #18 (Mintlify docs) and any feature work outside the locked V1 wedge remain explicitly out of scope.

## Problem Statement

The product is built but not yet provably testable. Three concrete blockers stand between feature-complete and real-world MVP validation:

- **No way to trust the lifecycle delivery signal.** Operators have no log evidence to distinguish a non-delivering integration from a silent-success receiver. This breaks every downstream test that depends on tenant provisioning.
- **No committed path to seed a test portal.** The seed script and dataset exist in source, but the npm scripts and the canonical seed-plan doc are uncommitted in this worktree. Without that, every test-portal validator has to hand-roll the dataset.
- **Two open install-UX issues degrade the first-install demo.** #16 leaves users on a bare success page outside HubSpot. #28 leaves them with an empty card unless they manually toggle enrichment in settings — defeating the wedge of "one credible reason to contact this account now."

## Solution Approach

Land the work in five ordered phases. Phase 0 is a mandatory short preflight that locks five open decisions in `docs/slice-12-preflight-notes.md` and gates all downstream work. Phases 1A and 1B are parallel-safe (different file scopes, no shared state). Phase 3 (UX polish) runs sequentially because both #16 and #28 edit `apps/api/src/routes/oauth.ts`. Phase 2 (operator walkthrough) runs AFTER all four code PRs merge, becoming the end-to-end integration test for the full MVP-ready stack. Phase 4 is the final read-only validation.

Every code change follows the project iron law: **failing test first, minimum implementation, fresh verification, no completion claim without evidence.**

Every agent dispatch must:

- Use `mode: "bypassPermissions"` (mandatory per CLAUDE.md).
- Open with the RepoPrompt binding flow described in _Implementation Phases — RepoPrompt MCP Discipline_ below.
- Treat `mcp__RepoPrompt__file_search`, `read_file`, `apply_edits`, `git`, and `context_builder` as the default code-interaction surface; fall back to Bash only for tests, dev servers, dependency installs, and git write operations.

## Relevant Files

Use these files to complete the task. Read with `mcp__RepoPrompt__read_file` (line slices where the file is large), search with `mcp__RepoPrompt__file_search`, edit with `mcp__RepoPrompt__apply_edits`.

### Lifecycle observability (Issue #19)

- `apps/api/src/routes/lifecycle.ts` — receiver. Verified line numbers (read 2026-05-10):
  - Handler starts at line 94 (`app.post("/", async (c) => {`).
  - Add request-arrival log inside the handler at line 95, BEFORE the signature/timestamp header reads at lines 95–96.
  - Existing `console.warn` paths: line 118 (signature mismatch), line 149 (missing portalId).
  - Success counter `applied += 1` is at line 164 (NOT 158 as a casual read might suggest).
  - Add applied/ignored summary log AFTER the `for` loop closes (line 165) and BEFORE `return c.json(...)` at line 167. Do NOT put the summary log inside the loop — that would emit one per event instead of one per request.
- `apps/api/src/middleware/hubspot-signature.ts` — `canonicalizeRequestUrl` (~line 253). Read-only reference; do not modify (#26 already corrected forwarded-proto handling).
- `apps/api/src/lib/tenant-lifecycle.ts` — `applyHubSpotLifecycleEvent` (lines 76–106; verified 2026-05-10). Read-only reference for understanding the no-tenant-match no-op path. NOTE: this function does NOT create the tenant — it only updates `isActive` on existing tenants. First-install tenant creation lives in `apps/api/src/routes/oauth.ts:212` (the OAuth callback `.insert(tenants).onConflictDoUpdate(...)`), not here. This matters for Issue #28 (see below).
- `apps/api/src/__tests__/` — pattern reference for the new failing test on log emission (use `vi.spyOn(console, "log")` style; existing tests already mock console output).
- `docs/runbooks/slice-11-dev-quickstart.md` — fix the documented log lines at lines 139 (APP_INSTALL) and 152 (APP_UNINSTALL) to match the new receiver output. Verified 2026-05-10: those are the actual line numbers of the `[lifecycle] APP_INSTALL received portalId=...` / `[lifecycle] APP_UNINSTALL received portalId=...` references. A repo-wide grep for `[lifecycle] APP_INSTALL received` and `[lifecycle] APP_UNINSTALL received` returns zero hits in `apps/`, `packages/`, `scripts/` — confirming those log lines exist only in the runbook and never in source.
- `docs/slice-11-preflight-notes.md` — preflight context for receiver/bootstrap contract; do not modify.

### Test-portal seed wiring (already in worktree, needs commit + PR)

- `package.json` — **uncommitted**: adds `seed:test-portal` and `seed:test-portal:dry` scripts. Verify the diff is exactly two script lines and nothing else.
- `docs/qa/test-portal-seed-plan.md` — **uncommitted, new**: canonical 8-state seed plan + run instructions.
- `scripts/seed-hubspot-test-portal.ts` — already in repo. Read-only reference; verify helpers it exports (`buildSeedTargets`, `buildSeedPlan`, `executeSeedPlan`, `parseArgs`, `runSeed`).
- `scripts/__tests__/seed-hubspot-test-portal.test.ts` — already in repo. Run before commit to confirm green baseline.
- `packages/config/src/factories.ts` — already in repo. Property shapes that the seed dataset mirrors. Read-only reference.
- `docs/qa/slice-2-walkthrough.md` — already in repo. Cross-reference target for the new seed-plan doc.

### OAuth install success page (Issue #16)

- `apps/api/src/routes/oauth.ts` — HTTP route surface. Verified 2026-05-10:
  - `GET /install` at line 114 (issues HubSpot authorize-URL redirect with fresh state).
  - `GET /callback` at line 131 (token exchange + tenant upsert).
  - The error path already returns a polished HTML response via an `htmlError(...)` helper (e.g., line 134 returns `c.html(htmlError("Install declined", ...))`). The natural pattern for #16 is an `htmlSuccess(...)` mirror that returns a small HTML page with a meta-refresh / button back into HubSpot. Do not invent a totally different success surface.
- `apps/api/src/lib/oauth.ts` — token exchange + state verification helpers consumed by the route. Read-only reference unless a helper signature actually needs to change.
- HubSpot install-redirect URL pattern — verify against current HubSpot marketplace install docs via Context7 (`mcp__MCP_DOCKER__resolve-library-id` then `get-library-docs`) before hardcoding any return URL. Likely target shape: `https://app.hubspot.com/integrations-settings/<portalId>/installed`, but confirm in docs before writing.
- `apps/hubspot-project/src/app/app-hsmeta.json` — OAuth `redirectUrls` configuration. Read-only reference; do not modify unless the new redirect target requires whitelisting.

### Default-on enrichment after install (Issue #28)

- `apps/api/src/routes/oauth.ts:212` — actual tenant-creation site. Verified 2026-05-10. The `db.insert(tenants).values({ hubspotPortalId, name }).onConflictDoUpdate({...})` block is where a freshly-installed tenant row is created. `onConflictDoUpdate` only resets `isActive`/`deactivatedAt`/`deactivationReason`/`updatedAt` on reinstall. The default-on enrichment toggle should land in `.values({...})` for first-install, and MUST NOT clobber existing settings on reinstall.
- `packages/db/src/schema/tenants.ts` — schema for the tenants table (verified 2026-05-10). **Important finding:** the `tenants` table already has a `settings: jsonb("settings").default({})` column (line 10). No new column or migration is required. Issue #28 implementation should store the toggle as `settings: { enrichmentEnabled: true }` in the OAuth-callback insert. Plan supersedes earlier hedging about three schema options.
- `apps/api/src/lib/tenant-lifecycle.ts` (lines 76–106) — `applyHubSpotLifecycleEvent`. Read-only reference. Do NOT put the default-on logic here; this function fires after the tenant row already exists and its only job is `isActive` toggling.
- `packages/db/src/schema/__tests__/slice2-migration.test.ts` and `slice3-migrations.test.ts` — pattern reference. New migration test NOT required (no schema change).
- `apps/api/src/__tests__/tenant.test.ts` — pattern reference for the failing test on default-enrichment behavior. Tests should assert against the OAuth callback flow (mocking the HubSpot token + identity calls) rather than the lifecycle webhook handler.
- Issue #28 body — re-read for any acceptance constraints the maintainer specified, including whether the toggle is per-tenant only or also surfaces in the settings UI.

### New files

- `docs/slice-12-preflight-notes.md` — **mandatory, produced by Task 0**. 1-page preflight following the slice-N-preflight-notes.md convention. Locks five decisions before any builder dispatches:
  1. **Lifecycle log shape** — exact string templates for request-arrival and applied/ignored summary so the test spy assertions and the implementation cannot drift.
  2. **Log redaction posture** — reaffirm that `portalId` is safe to log (slice-11 preflight §6 already established this) and that the body, signature header, and any token are NOT.
  3. **#16 success-page surface** — 302 to HubSpot return URL vs. HTML page with meta-refresh, decided from the issue body and Context7-fetched marketplace docs.
  4. **#28 reinstall semantics** — confirm that reinstall preserves a user-set `enrichmentEnabled=false` (i.e., the default-on logic lives in `.values({...})`, not in `onConflictDoUpdate.set`).
  5. **#28 UI scope** — backend-only default vs. also surfacing the toggle in the Settings UI, decided from the issue body.
     Cross-references: `docs/slice-11-preflight-notes.md` §6 (log-safe fields), `docs/security/SECURITY.md` (CSP and secret-handling), the live `htmlError` helper at `apps/api/src/routes/oauth.ts:98`. Output is the binding contract for Tasks 1, 4, 5.

## Implementation Phases

### Phase 0: Preflight (mandatory, sequential)

Produce `docs/slice-12-preflight-notes.md` resolving the five open decisions enumerated in _Relevant Files — New Files_ above. No code changes in this phase. Output is a small markdown document committed via its own PR. Phase 0 gates Phase 1 — builders for Tasks 1, 4, and 5 read the preflight before writing failing tests, so test assertions and implementation cannot drift from the locked decisions. The preflight is small (~1 page); the cost is one extra PR cycle, the benefit is eliminating wrong-shape rework caught only at validator-stage.

### Phase 1: Foundation (parallel-safe, gated on Phase 0)

Two independent file scopes. Run 1A and 1B in parallel after the Phase 0 preflight PR merges.

**1A — Lifecycle observability fix (Issue #19).**
Failing test: write a Vitest case that posts a valid signed payload to the lifecycle receiver via `app.request(...)` and asserts `console.log` was called with the EXACT log strings locked in `docs/slice-12-preflight-notes.md` §1. Confirm fail. Add the two log lines (request-arrival + summary) to `apps/api/src/routes/lifecycle.ts`. Confirm pass. Update `docs/runbooks/slice-11-dev-quickstart.md` lines 139 (APP_INSTALL block) and 152 (APP_UNINSTALL block) to the new log shape — verify line numbers haven't shifted before editing. Run full backend test suite.

**1B — Commit + PR seed wiring.**
Run `pnpm install` (worktree has no `node_modules`). Run the existing seed test to confirm green baseline: `pnpm test scripts/__tests__/seed-hubspot-test-portal.test.ts`. Run `pnpm seed:test-portal:dry` and capture output. Stage `package.json` and `docs/qa/test-portal-seed-plan.md`. Commit with conventional message. Push, open PR against `main`.

### Phase 2: Live test-portal walkthrough (operator-only, sequential)

After Phase 1 PRs merge:

1. Operator authenticates against the HubSpot test portal: `hs auth`, `hs accounts list`, confirm test portal id.
2. Operator deploys the merged Phase 1 changes via Vercel (preview is fine if main hasn't promoted yet).
3. Operator triggers OAuth install of the app on the test portal. Confirms install completes.
4. Operator runs `pnpm seed:test-portal --portal <id>`. Pastes results table into the issue / PR comment.
5. Operator triggers an uninstall. Pulls Vercel function logs. Confirms either a `hubspot-lifecycle-webhook: request received` line (which then either applies or 401s on signature) **or** absence of any log (proving HubSpot is not firing — at which point #19 reopens with new evidence and a different hypothesis).
6. Operator opens each of the 8 seeded company records in HubSpot and walks the card UI states against `docs/qa/test-portal-seed-plan.md` and `docs/qa/slice-2-walkthrough.md`. Captures screenshots or notes per state.

### Phase 3: Install UX polish (sequential — same file)

Both #16 and #28 edit `apps/api/src/routes/oauth.ts`. Run sequentially to avoid merge conflicts: 3A first, then 3B rebased on 3A. Phase 3 is gated on Phase 1 only (lifecycle observability + seed wiring merged) — NOT on Phase 2 walkthrough. Phase 2 becomes the integration walk for the full set of four merged PRs.

**3A — Issue #16: OAuth install success page + redirect.**
Failing test first against the OAuth callback handler: assert that on success the response is a 302 to a HubSpot-side return URL (or to a polished success page that auto-redirects within N seconds, depending on the maintainer's intent in #16). Read #16 body before deciding which behavior to implement. Confirm with Context7-fetched HubSpot marketplace docs that the chosen redirect target is correct for the install flow.

**3B — Issue #28: Default-on enrichment after install.**
The default lands in the OAuth callback tenant insert (`apps/api/src/routes/oauth.ts:212`), NOT in the lifecycle webhook handler. The `tenants.settings` JSONB column already exists — no migration. Failing test against the OAuth callback flow: after a fresh callback for a previously-unknown portal, the new tenant row's `settings.enrichmentEnabled` must be `true`. Confirm fail. Add `settings: { enrichmentEnabled: true }` to the `.values({...})` block (not to `onConflictDoUpdate.set`, which would clobber user changes on reinstall). Add a reinstall-preserves-user-toggle test and a cross-tenant isolation test. Confirm all pass.

### Phase 4: Validation

Quality-engineer agent runs the read-only end-to-end verification: pulls the merged PRs, runs full test suite, walks each of the 8 seeded states against the live test portal screenshots from Phase 2, confirms #16 and #28 acceptance criteria are met, confirms `docs/runbooks/slice-11-dev-quickstart.md` matches the new log shape, confirms no production code lacks tests. Inspect-only — no file modifications. Reports pass/fail per task.

### RepoPrompt MCP Discipline (apply to every agent in this plan)

Every agent dispatched against this plan opens with this exact sequence before any other tool call:

1. `mcp__RepoPrompt__manage_workspaces` `action="list"` — find the workspace whose `repo_paths` exactly matches `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/.claude/worktrees/amazing-kepler-6f062b`.
2. `mcp__RepoPrompt__bind_context` `op="bind"` `working_dirs="/Users/romeoman/Documents/Dev/HubSpot/Account Plan App/.claude/worktrees/amazing-kepler-6f062b"` (with `create_if_missing=true` and a tab name if the workspace doesn't exist yet).
3. Verify the response says `Binding: ... • workspace <name>` matching the worktree.
4. Only then run `workspace_context`, `file_search`, `read_file`, etc.

Anti-patterns the agent must avoid:

- Calling `workspace_context` first without binding and then concluding "RepoPrompt is stale." 0 tokens means no selection, not stale.
- Falling back to `grep` / `rg` / `cat` without explicit acknowledgement that the binding-first rule was skipped and why.
- Reading entire 1000-line files when a line slice would do.
- Using `sed` / `awk` for edits when `apply_edits` exists.

Bash falls back to: running tests (`pnpm test`), starting servers, `pnpm install`, git write operations (`commit`, `push`, `checkout`), Docker, HubSpot CLI, Vercel CLI.

## Team Orchestration

- The team lead (`/team-build` or `/build` orchestrator) operates as the director. Never writes code directly. Uses `Agent`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`, `TaskOutput` to coordinate.
- Every `Agent()` spawn MUST include `mode: "bypassPermissions"`. Every parallel launch (`run_in_background: true`) and every SendMessage-based resume must respect the original spawn's mode.
- Every spawn must include the RepoPrompt binding flow above in its system prompt or initial instructions.
- The lead validates work against acceptance criteria using the quality-engineer validator. The lead never declares a task complete without fresh `pnpm test` / live-portal evidence.

### Team Members

- Specialist
  - Name: `builder-preflight`
  - Role: Produce `docs/slice-12-preflight-notes.md` resolving the five locked decisions (log shape, redaction posture, #16 surface, #28 reinstall semantics, #28 UI scope). Doc-only — no code, no tests.
  - Agent Type: `general-purpose`
  - Resume: true
- Specialist
  - Name: `builder-lifecycle-observability`
  - Role: Implement Issue #19 observability fix — failing test, two log lines in `apps/api/src/routes/lifecycle.ts`, runbook update.
  - Agent Type: `backend-engineer`
  - Resume: true
- Specialist
  - Name: `builder-seed-wiring-pr`
  - Role: Verify the uncommitted seed-wiring changes build and test green, commit them with a conventional message, push, open PR against `main`.
  - Agent Type: `general-purpose`
  - Resume: true
- Specialist
  - Name: `builder-oauth-success-page`
  - Role: Implement Issue #16 — failing test on OAuth callback redirect, then implementation. Verify chosen redirect target against current HubSpot marketplace docs (Context7).
  - Agent Type: `frontend-specialist`
  - Resume: true
- Specialist
  - Name: `builder-default-enrichment`
  - Role: Implement Issue #28 — failing test on install branch defaulting enrichment to on, then implementation, plus a cross-tenant isolation test.
  - Agent Type: `backend-engineer`
  - Resume: true
- Quality Engineer (Validator)
  - Name: `validator`
  - Role: Validate completed work against acceptance criteria (read-only inspection mode). Confirms tests pass, runbook matches new log shape, both PRs are green on CI, and the live test-portal walkthrough notes from Phase 2 cover all 8 states.
  - Agent Type: `quality-engineer`
  - Resume: false

Phase 2 is **operator-only** (the user, on a real machine with HubSpot CLI authenticated). No agent assignment — the team lead surfaces the operator checklist as a TaskCreate item assigned to `owner: "operator"` so it appears in `TaskList` and gates Phase 3.

## Step by Step Tasks

Each task maps directly to a `TaskCreate` call in the build phase. Tasks marked **Parallel: true** can be launched simultaneously (single message, multiple `Agent()` calls).

**Effective execution order after dependency resolution:**

1. **Wave 0 (preflight, sequential):** Task 0 `preflight-mvp-readiness` — produces `docs/slice-12-preflight-notes.md`. Gates Wave A.
2. **Wave A (parallel):** Task 1 `lifecycle-observability-fix` + Task 2 `commit-seed-wiring`
3. **Wave B (sequential):** Task 4 `oauth-success-page-polish` (after Wave A merges)
4. **Wave C (sequential):** Task 5 `default-enrichment-after-install` (after Task 4 merges; rebases on Task 4)
5. **Wave D (operator):** Task 3 `operator-live-walkthrough` (after all four code PRs merge — gates Phase 4)
6. **Wave E (validation):** Task 6 `validate-all`

The numbered headings below preserve the original task IDs for reference. **The dependency graph — not the heading order — is authoritative.**

### 0. Preflight: Lock MVP-Readiness Decisions

- **Task ID**: `preflight-mvp-readiness`
- **Depends On**: none
- **Assigned To**: `builder-preflight`
- **Agent Type**: `general-purpose`
- **Parallel**: false (gates Wave A)
- Bind RepoPrompt per the binding flow.
- Read these inputs end-to-end with `read_file`:
  - Issue bodies via `gh issue view 19`, `gh issue view 16`, `gh issue view 28` for maintainer-stated acceptance constraints.
  - `docs/slice-11-preflight-notes.md` §6 (log-safe fields contract) and §7 (env vars).
  - `docs/security/SECURITY.md` for CSP and secret-handling constraints relevant to a polished `htmlSuccess` page.
  - `apps/api/src/routes/oauth.ts:98` (`htmlError` helper) and the existing CSP-compliant HTML pattern.
  - `packages/db/src/schema/tenants.ts` (`settings` JSONB column already exists).
  - HubSpot marketplace install docs via Context7 (`mcp__MCP_DOCKER__resolve-library-id` then `get-library-docs`) for the install-redirect URL pattern. If Context7 has no entry, fall back to `firecrawl_scrape` on `https://developers.hubspot.com/docs/apps/marketplace/listing-your-app`.
- Produce `docs/slice-12-preflight-notes.md` (~1 page, mirrors slice-11 preflight format) with these five locked sections:
  1. **Lifecycle log shape (binding contract for Task 1).** EXACT string templates for the request-arrival log and the applied/ignored summary log. Include sample output, the regex the spy assertion uses, and a Don't-Log list (body, signature header, any token).
  2. **Log redaction posture.** Reaffirm `portalId` is safe to log per slice-11 preflight §6. Decide whether to include any other field (timestamp, eventTypeId, applied/ignored counts) and justify.
  3. **#16 success-page surface (binding contract for Task 4).** Decision: 302 to HubSpot return URL vs. HTML page with meta-refresh vs. both. Cite the issue body and the Context7 / firecrawl evidence. If HTML, declare CSP headers it must carry and confirm no inline scripts / no third-party assets per `docs/security/SECURITY.md`.
  4. **#28 reinstall semantics (binding contract for Task 5).** Confirm: default-on logic lives in `.values({...})` of the OAuth-callback insert, NOT in `onConflictDoUpdate.set`. Reinstalls preserve a user-set `enrichmentEnabled=false`. Cross-tenant isolation is tested explicitly.
  5. **#28 UI scope.** Decision: backend-only default vs. also surfacing the toggle in the Settings UI. If the issue body is silent, default to backend-only and flag for follow-up.
- Cross-link the preflight from this plan and from `PLANNING_INDEX.md` so future readers find it via the index.
- Open a PR titled `docs(preflight): lock MVP-readiness decisions for slice 12` against `main`. PR body summarizes the five decisions in 5 bullets so reviewers can sign off without reading the whole doc. Merge after maintainer review.
- Iron law applies: no fixes, no code, no test files in this task. Doc-only.

### 1. Lifecycle Observability Fix (Issue #19)

- **Task ID**: `lifecycle-observability-fix`
- **Depends On**: `preflight-mvp-readiness`
- **Assigned To**: `builder-lifecycle-observability`
- **Agent Type**: `backend-engineer`
- **Parallel**: true (with `commit-seed-wiring`)
- Bind RepoPrompt to the worktree per the binding flow above.
- `mcp__RepoPrompt__file_search` for `lifecycle.ts` in `apps/api/src/routes/` and read it end-to-end with `read_file`.
- Read `apps/api/src/middleware/hubspot-signature.ts` (signature gate) and `apps/api/src/lib/tenant-lifecycle.ts` (no-tenant-match no-op) for context. Do not modify either.
- Write a failing Vitest test in `apps/api/src/__tests__/` (or alongside existing lifecycle tests) that:
  - posts a valid signed payload to the lifecycle receiver via `app.request(...)`,
  - spies on `console.log`,
  - asserts a request-arrival log AND an applied/ignored summary log were emitted with the expected shape.
- Confirm test fails for the expected reason (no logs are emitted today).
- Add two `console.log` lines to `apps/api/src/routes/lifecycle.ts` via `apply_edits`:
  - request-arrival log INSIDE the `app.post("/", ...)` handler at line 95, BEFORE the signature/timestamp header reads. Shape: `console.log("hubspot-lifecycle-webhook: request received");`.
  - summary log AFTER the `for (const event of events)` loop closes at line 165, BEFORE the `return c.json(...)` at line 167. Shape: `console.log(\`hubspot-lifecycle-webhook: applied=\${applied} ignored=\${ignored} portalIds=\${portalIds.join(",")}\`);`. Do NOT place this inside the loop — one log per request, not one per event.
  - `portalIds` must be derived from the events array safely. Suggested derivation: collect each successful event's `portalId` into a local array inside the loop (next to where `applied += 1` is incremented at line 164), then join after the loop. Null-check each event before accessing `.portalId`. Never log secrets — the body, signature header, and any token are NOT safe to log.
- Confirm test passes.
- Update `docs/runbooks/slice-11-dev-quickstart.md` lines 139 (APP_INSTALL block) and 152 (APP_UNINSTALL block) to reference the new log shape. Use `apply_edits`. Verify line numbers before editing — a formatter run on the runbook may have shifted them.
- Run `pnpm test apps/api` and confirm green.
- Run `pnpm typecheck` and `pnpm lint` (or whatever the repo aliases to biome).
- Commit with message `fix(lifecycle): emit request-arrival and applied/ignored logs (#19)` and push.
- Open PR against `main` titled `fix(lifecycle): emit request-arrival and applied/ignored logs (closes #19)` with body summarizing the observability gap finding from the 2026-05-10 investigation.

### 2. Commit and PR Seed Wiring

- **Task ID**: `commit-seed-wiring`
- **Depends On**: `preflight-mvp-readiness`
- **Assigned To**: `builder-seed-wiring-pr`
- **Agent Type**: `general-purpose`
- **Parallel**: true (with `lifecycle-observability-fix`)
- Bind RepoPrompt per the binding flow.
- Run `git status` via `mcp__RepoPrompt__git`. Confirm exactly two changes:
  - modified: `package.json`
  - new: `docs/qa/test-portal-seed-plan.md`
- If anything else is dirty, stop and surface to the team lead.
- Run `pnpm install` (worktree has no `node_modules` per the prior session note).
- Run `pnpm test scripts/__tests__/seed-hubspot-test-portal.test.ts` and confirm green.
- Run `pnpm seed:test-portal:dry` and confirm it prints the planned 8-state operations without erroring.
- Run `pnpm typecheck` and `pnpm lint`.
- Stage exactly the two files. Commit with message `chore(seed): wire seed:test-portal scripts and publish seed plan`.
- Push and open PR against `main`. PR body includes the dry-run output and a link to the new `docs/qa/test-portal-seed-plan.md`.

### 3. Operator: Live Test-Portal Walkthrough (Phase 2)

- **Task ID**: `operator-live-walkthrough`
- **Depends On**: `lifecycle-observability-fix`, `commit-seed-wiring`, `oauth-success-page-polish`, `default-enrichment-after-install`
- **Assigned To**: `operator` (the user — no agent dispatch)
- **Agent Type**: n/a
- **Parallel**: false
- Wait for ALL FOUR PRs (Tasks 1, 2, 4, 5) to merge to `main` and for Vercel to deploy. Operator walkthrough is the end-to-end integration test for the full MVP-ready stack.
- `hs auth` against the HubSpot test portal. `hs accounts list` to confirm portal id.
- Trigger OAuth install of the deployed app on the test portal via the dev install URL.
- Run `pnpm seed:test-portal --portal <id>`. Capture the results table.
- Trigger one uninstall and one re-install. Pull Vercel function logs (`vercel logs <deployment>` or equivalent) and grep for `hubspot-lifecycle-webhook`. Confirm at least one `request received` log per delivery attempt.
- If no logs appear, **#19 reopens** with the new evidence and a fresh hypothesis (HubSpot-side delivery, not observability). Stop the plan here and re-investigate.
- If logs appear and `applied >= 1`, mark #19 closeable.
- Open each of the 8 seeded company records in the HubSpot UI. Walk the card against `docs/qa/test-portal-seed-plan.md`. Capture screenshots or written notes per state.
- File a comment on the (now-merging) #19 thread or a tracking issue with the screenshots and the log-grep evidence.

### 4. OAuth Install Success Page Polish (Issue #16)

- **Task ID**: `oauth-success-page-polish`
- **Depends On**: `lifecycle-observability-fix`, `commit-seed-wiring`
- **Assigned To**: `builder-oauth-success-page`
- **Agent Type**: `frontend-specialist`
- **Parallel**: false (Task 5 edits the same file `apps/api/src/routes/oauth.ts` and must rebase on this)
- Bind RepoPrompt per the binding flow.
- Read Issue #16 body via `gh issue view 16` to confirm the maintainer's exact intent (auto-redirect vs. polished landing vs. both).
- Read `apps/api/src/lib/oauth.ts` end-to-end. Identify the success-path response.
- Use Context7 (`mcp__MCP_DOCKER__resolve-library-id` then `get-library-docs`) on HubSpot marketplace install docs to confirm the correct return-to-HubSpot URL pattern. Do not hardcode without doc evidence.
- Write a failing Vitest test on the OAuth callback handler asserting the chosen redirect behavior (302 to HubSpot return URL, or 200 with HTML containing a meta-refresh, depending on #16 scope).
- Implement the minimum change. Confirm pass.
- If a static HTML success page is added, ensure it follows the project's CSP/security posture from `docs/security/SECURITY.md`. No inline scripts. No third-party assets.
- Verify `apps/hubspot-project/src/app/app-hsmeta.json` `redirectUrls` covers the new redirect target. Adjust only if necessary; document the change in the PR body.
- Run `pnpm test apps/api`. Run typecheck and lint.
- Commit with message `feat(oauth): polish install success page and redirect to HubSpot (#16)`. Push and PR.

### 5. Default-On Enrichment After Install (Issue #28)

- **Task ID**: `default-enrichment-after-install`
- **Depends On**: `oauth-success-page-polish`
- **Assigned To**: `builder-default-enrichment`
- **Agent Type**: `backend-engineer`
- **Parallel**: false (rebases on Task 4 since both edit `apps/api/src/routes/oauth.ts`)
- Bind RepoPrompt per the binding flow.
- Read Issue #28 body via `gh issue view 28` to confirm exact acceptance.
- Read `packages/db/src/schema/tenants.ts` and confirm the `settings: jsonb("settings").default({})` column at line 10 is still present. The implementation reuses this column — NO new migration is expected.
- Read `apps/api/src/routes/oauth.ts` lines 209–227 (the tenant insert/upsert block). The default toggle goes into the `.values({...})` block, NOT into `onConflictDoUpdate.set` — preserving existing settings on reinstall.
- Read `apps/api/src/lib/tenant-lifecycle.ts` only to confirm it does NOT need changes (it operates on already-existing tenants).
- Write two failing tests under `apps/api/src/__tests__/`:
  - On a fresh OAuth callback for a previously-unknown portal, the new tenant row's `settings.enrichmentEnabled` must be `true` after the insert (test the route, mocking HubSpot token + identity fetches following the existing `tenant.test.ts` mocking pattern).
  - On a reinstall (tenant exists with `settings: { enrichmentEnabled: false }` set by the user), the OAuth callback must NOT overwrite the user's setting back to `true`. This is the cross-tenant / cross-state isolation guarantee — combine with a tenant-A-vs-tenant-B test confirming changes to tenant A's settings do not bleed into tenant B.
- Confirm both fail.
- Implement the minimum change in `apps/api/src/routes/oauth.ts:212` — add `settings: { enrichmentEnabled: true }` to the `.values({...})` block. Do NOT touch `onConflictDoUpdate.set`. If a Drizzle migration is unexpectedly needed (e.g., the maintainer chose a column-default approach in the issue body), use `pnpm db:generate` then `pnpm db:migrate` (the actual workspace scripts; verified in `packages/db/package.json`).
- Confirm both tests pass.
- Run `pnpm test apps/api`. Run typecheck and lint.
- Commit with message `feat(install): default enrichment to on for newly installed tenants (#28)`. Push and PR.

### 6. Final Validation

- **Task ID**: `validate-all`
- **Depends On**: `preflight-mvp-readiness`, `lifecycle-observability-fix`, `commit-seed-wiring`, `operator-live-walkthrough`, `oauth-success-page-polish`, `default-enrichment-after-install`
- **Assigned To**: `validator`
- **Agent Type**: `quality-engineer`
- **Parallel**: false
- Bind RepoPrompt per the binding flow.
- Pull `main` after all five PRs (preflight + Phase 1 + Phase 3) merge.
- Confirm `docs/slice-12-preflight-notes.md` exists and contains the five locked sections. Confirm Tasks 1, 4, 5 PR descriptions cite it.
- Run `pnpm install`, `pnpm typecheck`, `pnpm lint`, `pnpm test` at the repo root. Capture output.
- Open the new lifecycle log test file and confirm both spy assertions (request-arrival + applied/ignored summary) exist and are wired to a passing test case. Run that test in isolation with `pnpm test apps/api/src/__tests__/<lifecycle-log-test-file>` and confirm green — proves the failing-test-first cycle was followed for Task 1.
- Confirm `docs/runbooks/slice-11-dev-quickstart.md` references the new log shape and contains no orphan references to the old `[lifecycle] APP_INSTALL received portalId=...` line.
- Confirm `package.json` has both seed scripts and `docs/qa/test-portal-seed-plan.md` exists and is internally consistent with `scripts/seed-hubspot-test-portal.ts`.
- Confirm the operator's Phase 2 walkthrough notes/screenshots cover all 8 QA states.
- Confirm both #16 and #28 acceptance criteria from their issue bodies are met by reading the merged code, not just the PR descriptions.
- Confirm cross-tenant isolation test for #28 exists and passes. This is mandatory per CLAUDE.md.
- Operate in inspection mode only — no file modifications. Report pass/fail per task with evidence (file paths, line numbers, command output excerpts). If any check fails, surface the failure to the team lead and propose the next agent dispatch to fix it.

## Acceptance Criteria

- [ ] `docs/slice-12-preflight-notes.md` is committed and contains all five locked sections (log shape, redaction posture, #16 surface, #28 reinstall semantics, #28 UI scope). Tasks 1, 4, 5 cite it as their binding contract in PR descriptions.
- [ ] `apps/api/src/routes/lifecycle.ts` emits a `hubspot-lifecycle-webhook: request received` log on every incoming request, before signature verification.
- [ ] `apps/api/src/routes/lifecycle.ts` emits a `hubspot-lifecycle-webhook: applied=N ignored=N portalIds=...` log after the success path, and a Vitest test asserts both logs were called via `console.log` spies.
- [ ] `docs/runbooks/slice-11-dev-quickstart.md` references the actual emitted log shape on the APP_INSTALL block at line 139 and the APP_UNINSTALL block at line 152 (verified line numbers as of 2026-05-10; reconfirm before editing in case a formatter has shifted them); no orphan references to the old `[lifecycle] APP_INSTALL received portalId=...` / `[lifecycle] APP_UNINSTALL received portalId=...` lines remain anywhere in the repo (`mcp__RepoPrompt__file_search` returns zero hits in `apps/`, `packages/`, `scripts/`, and `docs/`).
- [ ] `package.json` contains `seed:test-portal` and `seed:test-portal:dry` scripts, and they are committed.
- [ ] `docs/qa/test-portal-seed-plan.md` is committed and links to `scripts/seed-hubspot-test-portal.ts` and `docs/qa/slice-2-walkthrough.md`.
- [ ] `pnpm test scripts/__tests__/seed-hubspot-test-portal.test.ts` passes against the merged `main`.
- [ ] Operator has run `pnpm seed:test-portal --portal <id>` against a real HubSpot test portal and captured the results table.
- [ ] Operator has captured Vercel function-log evidence of `hubspot-lifecycle-webhook: request received` lines from a live install/uninstall, OR — if no logs appeared — has reopened #19 with new evidence and a fresh hypothesis.
- [ ] All 8 QA states (eligible-strong, fewer-contacts, empty, stale, degraded, low-confidence, ineligible, restricted) have been walked in the live HubSpot UI and notes/screenshots are filed.
- [ ] Issue #16 closed: OAuth install success path redirects to or auto-returns to HubSpot per the maintainer's intent, verified by a Vitest test on the callback handler.
- [ ] Issue #28 closed: a fresh OAuth callback for a previously-unknown portal results in a tenant row with `settings.enrichmentEnabled === true`, verified by a Vitest test on the OAuth callback handler. A reinstall test confirms `onConflictDoUpdate` does NOT overwrite a user-set `settings.enrichmentEnabled = false`. A cross-tenant isolation test confirms tenant A's toggle does not affect tenant B.
- [ ] Quality-engineer validator has produced a fresh report against merged `main` confirming all of the above.
- [ ] No file modifications by the validator agent during validation.

## Validation Commands

Run these from the repo root after Phase 4 starts:

- `pnpm install` — install all workspace dependencies.
- `pnpm typecheck` — TypeScript across the monorepo.
- `pnpm lint` — biome (per `biome.json` v2 config).
- `pnpm test` — full Vitest suite across `apps/api`, `apps/hubspot-extension`, `packages/*`, `scripts/`. All green.
- `pnpm test scripts/__tests__/seed-hubspot-test-portal.test.ts` — explicit green confirmation on the seed helpers.
- `pnpm test apps/api/src/__tests__/` — explicit green confirmation on the lifecycle log test added in Task 1.
- `pnpm seed:test-portal:dry` — confirm the dry-run prints the 8 planned operations and exits 0.
- `mcp__RepoPrompt__file_search` for the old runbook log line text — must return zero hits across all paths.
- `gh pr list --state merged --limit 10` — confirm the four PRs (lifecycle observability, seed wiring, #16, #28) are merged.
- `gh issue list --state closed --search "is:issue is:closed 19 16 28"` — confirm the three issues are closed.
- Operator-only: `vercel logs <deployment-id> | grep hubspot-lifecycle-webhook` after a live install/uninstall — confirm logs appear.

## Notes

- **Issue #18 (Mintlify support docs) is explicitly out of scope** for this MVP-readiness plan. Track separately.
- The lifecycle observability fix is intentionally minimal. Two log lines, no telemetry framework, no structured-logging library introduction. The repo's other warn-paths use plain `console.warn`; mirror that style for the new logs. Avoid scope creep.
- If the operator's Phase 2 walkthrough surfaces _new_ behavior — for example, that HubSpot truly is not delivering despite the new logs — the plan halts and a fresh investigation lands as a new slice plan under `.claude/tasks/`. Do not patch the bootstrap or webhooks-hsmeta config blindly.
- Cross-tenant isolation testing for #28 is non-negotiable per CLAUDE.md. Any builder skipping that test should be re-spawned with a corrective prompt.
- The `slice-12-preflight-notes.md` artifact in _New Files_ is optional. Recommend creating it only if the team-build orchestrator finds the lifecycle change touches more than the two log lines (e.g., if log redaction or PII concerns surface during implementation).
- All four PRs (Phase 1 + Phase 3) should be small, single-purpose, and merge cleanly without rebase conflicts. If any PR exceeds ~150 lines of diff outside tests, the orchestrator should split it before merging.
- Husky `post-commit` hook auto-pushes per CLAUDE.md workflow §3. No manual `git push` needed after commit.
- The `bypassPermissions` mode is mandatory on every `Agent()` spawn dispatched against this plan. Re-state it in every team-build prompt.
