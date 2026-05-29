# Worktree Prune Evidence — 2026-05-29

Recorded as Phase 0 task #2 of the v6 MVP-close plan
(`.claude/tasks/2026-05-28-mvp-close-and-ops-hardening.md`).
HEAD at time of pruning: `87b7498` (origin/main, +1 plan commit on top of `c182cc7`).

## Method

For each worktree, `git log --left-right --cherry-pick --oneline origin/main...<branch>`
identifies branch-side-unique commits (lines beginning with `>`). For each truly
unique commit, the patch-id was computed (`git show <sha> | git patch-id`) and
either matched against origin/main's last 40 patch-ids OR a file-level audit
confirmed the commit's changes are reflected on origin/main (squash-merge can
shift patch-ids while preserving behavior).

A branch is safe to prune iff (cherry-pick output has no `>` lines) OR (every
`>` commit's change is present on origin/main via file-level audit).

## Results

| Worktree                                          | Branch                                       | Unique commits (`>`)                    | Evidence                                                                                                                                                                                                                                                      | Decision |
| ------------------------------------------------- | -------------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `.claude/worktrees/feature-38-private-app-seed`   | `feature/38-private-app-seed`                | 0                                       | Branch fully behind origin; ancestor of `87b7498`                                                                                                                                                                                                             | PRUNE    |
| `.claude/worktrees/fix-keep-alive-mount`          | `fix/keep-alive-mount-path`                  | 0                                       | Cherry-pick shows no `>`; fully merged via PR #48 (`42885f6`)                                                                                                                                                                                                 | PRUNE    |
| `.claude/worktrees/ops-main`                      | (detached @ 47aafea)                         | 0 (detached at a commit on origin/main) | `47aafea` is on origin/main (`fix(build): pre-build workspace packages before app builds (#36)`)                                                                                                                                                              | PRUNE    |
| `.worktrees/enable-hubspot-enrichment-default`    | `codex/enable-hubspot-enrichment-default`    | 0                                       | Cherry-pick shows no `>`; merged via PR #35 (`c707c59`)                                                                                                                                                                                                       | PRUNE    |
| `.worktrees/fix-vercel-dist-artifact-regression`  | `codex/fix-vercel-dist-artifact-regression`  | 0                                       | Cherry-pick shows no `>`; superseded by deploy chain (#22, #25, #27, #36)                                                                                                                                                                                     | PRUNE    |
| `.worktrees/issue-17-settings-crash`              | `codex/issue-17-settings-crash`              | 0                                       | Cherry-pick shows no `>`; merged via the issue B series + PR #29                                                                                                                                                                                              | PRUNE    |
| `.worktrees/issue-17-settings-registration-debug` | `codex/issue-17-settings-registration-debug` | 0                                       | Cherry-pick shows no `>`; merged via PR #29 (`2995e08`)                                                                                                                                                                                                       | PRUNE    |
| `.worktrees/issue-24-settings-auth-xfp`           | `codex/issue-24-settings-auth-xfp`           | 2 (`037f9a6`, `f6d7b42`)                | `037f9a6` (canonicalize lifecycle webhook URL) — `canonicalizeRequestUrl` IS on origin/main (`apps/api/src/middleware/hubspot-signature.ts:253`, used in `lifecycle.ts:36,112`). `f6d7b42` — superseded by squash-merge PR #24/#26 (`4bb042a`, same subject). | PRUNE    |
| `.worktrees/settings-product-followup`            | `codex/settings-product-followup`            | 0                                       | Cherry-pick shows no `>`; merged via PR #20 (`0e9875c`)                                                                                                                                                                                                       | PRUNE    |
| `.worktrees/slice-12-handoff`                     | (detached @ 47aafea)                         | 0 (same as ops-main)                    | `47aafea` on origin/main                                                                                                                                                                                                                                      | PRUNE    |
| `.worktrees/vercel-pnpm-install-command`          | `codex/vercel-pnpm-install-command`          | 3 (`7694a3e`, `c030873`, `4c1cdf1`)     | All three reflected on origin/main: `apps/api/src/vercel-handler.ts` imports `handle` from `@hono/node-server/vercel` and `app from "./app.js"`; `apps/api/api/index.ts` re-exports `dist/vercel-handler.js`. File-level audit confirms full coverage.        | PRUNE    |

## Kept

| Worktree                                                 | Branch                      | Reason                                                     |
| -------------------------------------------------------- | --------------------------- | ---------------------------------------------------------- |
| `/Users/romeoman/Documents/Dev/HubSpot/Account Plan App` | `main`                      | Primary worktree                                           |
| `.claude/worktrees/feature-37-wave-d-runbook`            | `feature/37-wave-d-runbook` | PR #50 lives on this branch — held until merge per Phase 2 |

## Operator notes

- The `.worktrees/slice-12-handoff` worktree was a detached-HEAD pointer at `47aafea` (same commit as `ops-main`). Removing it does not lose work — `47aafea` is on origin/main and reachable from any branch tracking origin.
- Branch deletes used `git branch -D` because the local branches are no longer needed; the corresponding commits remain reachable via remote tracking refs and reflog until GC.
- No branches were force-deleted from origin. Remote branches (if any of these still exist as `origin/codex/...`) are untouched.
