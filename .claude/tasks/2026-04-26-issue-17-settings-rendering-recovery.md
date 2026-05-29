# Plan: Issue #17 Settings Rendering Recovery

## Task Description

Issue #17 tracks the HubSpot settings extension rendering failure for the HubSpot Account Plan App.

The previous React externalization / settings-surface branch is already merged into `main` through PR #21 cleanup, and `main` is clean at `b19d8c2`. The next failure evidence is different from the original `useState` crash: HubSpot portal runtime still shows blocking HubSpot-shell/API 404s for settings/discovery/app-details endpoints, including requests shaped like:

- `GET /api/application/settings/v3/page/37116835?...` -> `404`
- `GET /api/ecosystem/v1/features?...featureType=DISCOVERY_CARD&sourceId=37116835...` -> `404`
- `GET /api/ecosystem/v1/apps/details?...appId=37116835` -> `404`

This plan treats issue #17 as an active registration/provisioning/rendering investigation from current `main`, not as a continuation of the stale `codex/issue-17-settings-crash` or `codex/settings-product-followup` worktrees. Those branches have no unique commits relative to current `main` and should not be used as the implementation base.

## Objective

Restore the installed app settings page so it renders in HubSpot without the generic HubSpot error, without the original React `useState` crash, and without blocking HubSpot-side 404s for the app settings surface.

The first objective is to prove the root cause with systematic debugging. Code changes should only happen after a hypothesis is supported by docs, local artifacts, upload/deploy evidence, or portal runtime evidence. Any production code change must follow the repo's TDD rule: failing test first, minimal implementation, focused passing test, then broader verification.

## Relevant Files

### Repo instructions and source-of-truth docs

- `AGENTS.md` - repo operating contract, TDD and verification requirements, product/architecture guardrails.
- `CLAUDE.md` - active repo workflow, commands, deployment notes, and current project rules.
- `PLANNING_INDEX.md` - path resolver for moved planning docs.
- `.taskmaster/docs/prd.md` - locked product wedge and HubSpot platform assumptions.
- `planning/chatprd/AI_CODING_RULES_AND_STANDARDS.md` - coding, modularity, HubSpot, and current-docs rules.
- `docs/security/SECURITY.md` - tenant isolation, auth, config, secret-handling, and data-minimization constraints.

### HubSpot project configuration

- `apps/hubspot-project/hsproject.json` - HubSpot project name, source directory, and platform version.
- `apps/hubspot-project/src/app/app-hsmeta.json` - app metadata, OAuth URLs, scopes, and permitted URLs.
- `apps/hubspot-project/src/app/settings/settings-hsmeta.json` - settings extension `uid`, `type`, and `entrypoint` registration.
- `apps/hubspot-project/src/app/settings/Settings.tsx` - HubSpot settings entrypoint wrapper that re-exports the bundled artifact.
- `apps/hubspot-project/src/app/settings/package.json` - dependencies HubSpot sees for the settings extension build.

### Settings extension source and tests

- `apps/hubspot-extension/src/settings/settings-entry.tsx` - `hubspot.extend<"settings">(...)` runtime entrypoint.
- `apps/hubspot-extension/src/settings/settings-page.tsx` - main settings UI component.
- `apps/hubspot-extension/src/settings/api-fetcher.ts` - API fetch abstraction used by settings.
- `apps/hubspot-extension/src/settings/use-settings.ts` - settings load/save hook.
- `apps/hubspot-extension/src/settings/settings-entry.test.tsx` - entrypoint-level behavior coverage.
- `apps/hubspot-extension/src/settings/__tests__/settings-page.test.tsx` - UI behavior coverage.
- `apps/hubspot-extension/src/settings/__tests__/use-settings.test.tsx` - settings data-flow coverage.

### Build, bundle, upload, and runtime scripts

- `apps/hubspot-extension/vite.config.ts` - existing card-oriented Vite config; compare with programmatic bundler behavior.
- `scripts/bundle-hubspot-card.ts` - current card + settings bundling pipeline and externalization rules.
- `scripts/bundle-hubspot-card-cli.ts` - CLI wrapper for bundle generation.
- `scripts/hs-project-upload.ts` - HubSpot project upload orchestration.
- `apps/hubspot-project/UPLOAD.md` - upload/deployment runbook if present.

### Issue and prior-plan context

- `.claude/tasks/settings-product-followup.md` - useful product follow-up context, but not the source of truth for current issue #17 runtime state.
- `.claude/tasks/2026-04-16-slice-4-settings-configuration.md` - original Slice 4 settings implementation plan and settings-specific constraints.

## Step by Step Tasks

### Phase 0: RepoPrompt context and issue frontier

1. Bind RepoPrompt to `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App` with `bind_context`.
2. Use `workspace_context` to confirm the active selection and token shape before asking for code review or creating handoff prompts.
3. Use `file_search` to locate all settings-related code, tests, plans, and upload scripts.
4. Use `read_file` for targeted files and line ranges instead of broad shell reads.
5. Use `manage_selection` to keep the active context focused on the settings config, settings runtime, bundler, upload script, and relevant source-of-truth docs.
6. Keep shell usage for git state, package scripts, HubSpot CLI, Vercel/CI, and runtime verification.

### Phase 1: Create the isolated worktree

1. Use `/using-git-worktrees` from clean `main`.
2. Use the existing project-local `.worktrees/` directory.
3. Verify `.worktrees/` is ignored with `git check-ignore -q .worktrees` before creating anything.
4. Create a fresh branch and worktree, recommended:
   - branch: `codex/issue-17-settings-registration-debug`
   - path: `.worktrees/issue-17-settings-registration-debug`
5. Do not continue work in stale branches:
   - `codex/issue-17-settings-crash`
   - `codex/settings-product-followup`
6. Run baseline install/test commands appropriate for this repo before editing. If a full test suite needs Postgres or secrets, record the exact blocker and run focused baseline tests that can execute locally.

### Phase 2: Current HubSpot documentation preflight

1. Verify current official HubSpot docs before material work.
2. Confirm settings pages are supported for the latest developer platform.
3. Confirm expected project shape:
   - `src/app/settings/`
   - `*-hsmeta.json`
   - `type: "settings"`
   - `config.entrypoint`
   - React/TypeScript entrypoint using the UI extensions SDK.
4. Confirm expected upload/build flow:
   - `hs project install-deps`
   - `hs project upload`
   - `hs project open`
   - settings component listed on the project details page.
5. Confirm expected user verification path:
   - Marketplace icon
   - Connected apps
   - My apps
   - app overview
   - Settings tab.
6. Record the source links and exact doc claims in the investigation notes.

### Phase 3: Capture fresh runtime evidence

1. Reproduce issue #17 in the installed HubSpot account.
2. Capture browser console output and network requests for the settings page.
3. Specifically record whether the current failure still includes:
   - React `useState` null crash
   - generic HubSpot UI error
   - `/api/application/settings/v3/page/...` 404
   - `/api/ecosystem/v1/features...featureType=DISCOVERY_CARD...` 404
   - `/api/ecosystem/v1/apps/details...appId=37116835` 404
4. Record portal ID, app ID, project name, deployed build timestamp, and whether the installed app was installed before or after the latest upload.
5. Capture HubSpot CLI upload output for the same project/profile used by the installed test account.
6. Capture Vercel/backend logs only after proving the settings shell actually reaches backend fetches; HubSpot-shell 404s may happen before app code executes.

### Phase 4: Registration and artifact audit

1. Compare repo config against official docs:
   - `apps/hubspot-project/hsproject.json`
   - `apps/hubspot-project/src/app/app-hsmeta.json`
   - `apps/hubspot-project/src/app/settings/settings-hsmeta.json`
   - `apps/hubspot-project/src/app/settings/Settings.tsx`
   - `apps/hubspot-project/src/app/settings/package.json`
2. Build the settings bundle locally and inspect generated artifacts:
   - settings artifact exists under `.bundle-artifacts/settings`
   - project artifact exists under `apps/hubspot-project/src/app/settings/dist/index.js`
   - bundle shape is compatible with the `Settings.tsx` re-export.
3. Verify React and `@hubspot/ui-extensions` externalization for the settings bundle, not just the card bundle.
4. Verify that `Settings.tsx` points at the artifact HubSpot actually receives during upload.
5. Verify HubSpot upload output lists the settings component and does not silently skip it.
6. If HubSpot upload output does not show the settings component, prioritize registration/config fixes before UI changes.

### Phase 5: Systematic debugging hypotheses

Use `/systematic-debugging` after the worktree is created.

Start with these hypotheses, in order:

1. **H1: HubSpot registration/provisioning mismatch**
   - The portal/app does not have a registered settings page for app ID `37116835`, even though the repo contains settings files.
   - Evidence: HubSpot-shell settings endpoint 404s before our extension code executes.

2. **H2: Upload/build artifact mismatch**
   - The upload does not include the intended settings bundle or points HubSpot at a stale/missing artifact.
   - Evidence: local bundle exists but upload output omits settings, or uploaded component entrypoint differs from repo expectation.

3. **H3: Installed app state mismatch**
   - The developer project has settings, but the installed app instance in the target portal is stale, installed from an older build, or points at the wrong app ID/project.
   - Evidence: project details show component, but Connected Apps runtime still calls a missing app/settings ID.

4. **H4: Runtime settings code regression**
   - HubSpot shell loads the settings extension, but the extension fails after boot.
   - Evidence: settings bundle network fetch succeeds and console points to our code, React, HubSpot SDK, or backend calls.

5. **H5: Backend settings API failure**
   - The settings UI renders, then fails to load/save tenant settings.
   - Evidence: extension starts and calls our `API_ORIGIN`, then receives 401/403/404/500 or schema errors.

Do not start by changing the React UI unless Phase 3 or Phase 4 proves H4/H5.

### Phase 6: TDD implementation only after root cause is proven

1. If root cause is a deterministic code/config bug, write a failing test first.
2. Prefer the narrowest test that captures the exact failure:
   - package export/build guard
   - settings entrypoint shape
   - generated artifact presence
   - upload-script inclusion logic
   - settings API behavior, if backend is involved.
3. Confirm the test fails for the expected reason.
4. Implement the minimal fix.
5. Confirm the focused test passes.
6. Run broader verification appropriate to touched files:
   - `pnpm lint`
   - `pnpm typecheck`
   - focused Vitest suites
   - full tests if local dependencies are available.

### Phase 7: Verification before completion

Use `/verification-before-completion` before claiming success.

Required evidence:

1. Local build/bundle command succeeds and produces the expected settings artifact.
2. Relevant tests pass locally, or blockers are documented exactly.
3. HubSpot project upload succeeds for the intended profile/project.
4. HubSpot project details show the settings component after upload.
5. Installed app settings page opens from Connected Apps -> app overview -> Settings.
6. Browser console has no generic HubSpot extension error and no React `useState` null crash.
7. Network panel has no blocking HubSpot settings/discovery/app-details 404s for the settings page.
8. If backend settings APIs are exercised, responses are tenant-scoped and do not expose plaintext credentials.
9. CI passes before merge if a PR is opened.

### Phase 8: Code review and branch finish

1. Use `/requesting-code-review` once the branch has a focused fix and local verification evidence.
2. Request both local review and external review if available:
   - local Codex review for deterministic bugs/regressions
   - Claude/cubic/CodeRabbit/GitHub review if a PR is opened.
3. Use `/receiving-code-review` for each substantive review batch.
4. Use `/finishing-a-development-branch` only after:
   - all valid review findings are resolved or intentionally deferred
   - CI is green
   - manual HubSpot verification is documented
   - the branch has a clean status.

## Acceptance Criteria

- The settings page renders for the installed HubSpot app from Connected Apps -> app overview -> Settings.
- The generic HubSpot rendering error is gone.
- The original `Cannot read properties of null (reading 'useState')` error does not recur.
- The settings page is not blocked by HubSpot-shell 404s for settings/discovery/app-details endpoints.
- The settings UI receives the correct HubSpot context and API origin.
- Settings load/save behavior remains tenant-scoped.
- No plaintext provider or LLM secrets are returned to the client.
- No silent CRM writes are introduced.
- Any code/config fix is covered by a failing-first test where deterministic testing is possible.
- Local verification and CI/manual HubSpot verification are recorded before completion.

## Team Orchestration

Recommended lane count: **1 active implementation lane**.

Reason: root cause is not proven yet. The safest next step is one isolated investigation/debugging lane, not parallel competing fixes. Additional reviewers can run after the root cause and patch are concrete.

Recommended command sequence:

1. `/using-git-worktrees`
2. `/systematic-debugging`
3. `/verification-before-completion`
4. `/requesting-code-review`
5. `/receiving-code-review`
6. `/finishing-a-development-branch`

### Team Members

- **Lead investigator / implementer**
  - Owns the fresh worktree, RepoPrompt context, HubSpot docs check, artifact audit, and minimal fix.
  - Uses RepoPrompt for code context and focused edits.
  - Uses shell/HubSpot CLI/GitHub CLI for runtime and git operations.

- **Docs researcher**
  - Confirms current official HubSpot settings-extension docs and records source links.
  - Does not make code changes.

- **Frontend/runtime reviewer**
  - Reviews the settings entrypoint, React externalization, HubSpot UI extensions SDK use, and browser console evidence.
  - Should only patch frontend files if root cause is proven to be H4.

- **Backend/security reviewer**
  - Reviews settings API behavior only if the shell gets far enough to call backend endpoints.
  - Confirms tenant isolation and secret-handling rules remain intact.

- **QA/browser verifier**
  - Captures before/after browser evidence in HubSpot.
  - Verifies console/network behavior and records exact pass/fail evidence.

## RepoPrompt Tool Operating Model

Use RepoPrompt as the primary code-context layer throughout this issue.

- `bind_context`
  - Bind the MCP session to the exact worktree being investigated.
  - Re-bind after creating the new issue #17 worktree so reads and edits do not accidentally target `main`.

- `get_file_tree`
  - Use for directory-level orientation before opening files.
  - Useful targets: `apps/hubspot-project`, `apps/hubspot-extension/src/settings`, `scripts`, `.claude/tasks`.

- `file_search`
  - Use instead of `grep` for codebase discovery.
  - Search terms: `settings`, `hubspot.extend`, `settings-hsmeta`, `bundleTargets`, `hs project upload`, `API_ORIGIN`, `37116835`.

- `read_file`
  - Use for precise context reads and line ranges.
  - Prefer targeted file reads over reading entire directories.

- `get_code_structure`
  - Use when a file is large and the relevant functions/classes need to be identified before full reads.
  - Useful for `scripts/hs-project-upload.ts`, settings hooks, API routes, and service files.

- `manage_selection`
  - Keep the shared context compact and relevant.
  - Add files only when they become part of the current hypothesis.
  - Remove stale plan files once they are no longer needed.

- `workspace_context`
  - Snapshot the current selected context before requesting review, consulting an oracle, or handing off to another agent/session.
  - Include `selection`, `code`, and `tokens` by default; include full `files` only when needed.

- `prompt`
  - Store short, shared notes for the current investigation if a handoff will span sessions.
  - Do not use it as a replacement for the durable plan file.

- `apply_edits`
  - Use for focused, literal file edits when the root cause is proven.
  - Keep edits small; use tests to justify production changes.

- `oracle_send`
  - Optional second-opinion tool after context is selected.
  - Best used for plan review or code-review-style risk checking, not as a substitute for local evidence.

## Ready-to-Paste Next Prompt

Use this after approving the plan:

```text
/using-git-worktrees

Repo: /Users/romeoman/Documents/Dev/HubSpot/Account Plan App
Goal: create a fresh isolated worktree for issue #17 settings rendering recovery.

Use the existing .worktrees directory after verifying it is ignored. Create branch codex/issue-17-settings-registration-debug at .worktrees/issue-17-settings-registration-debug from clean main b19d8c2. Do not use stale branches codex/issue-17-settings-crash or codex/settings-product-followup. After creating the worktree, bind RepoPrompt to the new worktree, run baseline verification that is feasible locally, and stop before implementing. Report the exact worktree path, branch, baseline command results, and any blockers.
```
