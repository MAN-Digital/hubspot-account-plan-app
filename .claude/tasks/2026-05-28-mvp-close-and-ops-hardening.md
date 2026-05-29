# Plan: MVP Close and Ops Hardening (Post-Slice-12) — v6.1

Date: 2026-05-29 (v6 + erratum 6.1; v6 was ship-ready conditional on one SHA-ordering bug in Phase 1 Step 1, fixed in v6.1)
Branch base: `origin/main` HEAD `c182cc7`.
Status: planning only — implementation follows via `/team-build` or `/build` against this file.

## v6 revision note

Codex v5 re-review confirmed items 1, 5, 6 FIXED; items 2, 3, 4 PARTIALLY FIXED; surfaced 1 CRITICAL + 4 should-patch + region-hardcode trap. v6 closes every gap.

**Critical fix applied:**

1. **Production env file no longer lives in the repo working tree.** v5 said `vercel env pull .env.production.local` — that writes all production secrets into the repo tree (`.env.production.local` would be gitignored by Vercel convention but the file still sits in the workspace, one `rm -rf` mistake or one `git clean -fdx` away from data loss, and one accidental `git add .` away from a secrets leak). v6 pulls to a `mktemp` location OUTSIDE the repo, sets a `trap 'rm -f "$ENV_FILE"' EXIT` to guarantee cleanup on shell exit (success OR failure OR SIGINT), and explicitly forbids sourcing the file as a whole — only `DATABASE_URL` is extracted into the shell.

**v5 partial-fix gaps closed:**

2. **DB hostname check is now region-allowlist regex, not literal.** v5 hardcoded `aws-0-eu-west-1.pooler.supabase.com`. A legitimate Supabase region migration (eu-central, us-east, ap-southeast) would hard-fail the plan. v6 validates against the regex `^aws-0-[a-z0-9-]+\.pooler\.supabase\.com$` — region-agnostic but still rejects any arbitrary hostname. Also adds optional cross-check via `mcp__supabase__get_project_url` (which returns the project's actual region) to defend against a wrong-project pull.

3. **Hostname parser handles IPv6 literals.** v5's `sed -E 's|.*@([^:/]+).*|\1|'` breaks on `postgres://user:pass@[2606:4700::1]:5432/db`. v6 uses `python3 -c "from urllib.parse import urlparse; ..."` (or `node -e` fallback) which handles IPv6, percent-encoded passwords, and unicode hostnames per RFC 3986.

4. **Scope assertion direction fixed: required ⊂ returned, not returned ⊂ allowed.** v5's `jq` script was `returned scopes are in the allowed set`, which trivially passes when the token has only `[companies.read]` even though `contacts.write` is required. v6 asserts `(required - returned).length == 0` — all required scopes MUST be present in returned. Required list lives in `docs/decisions/oauth-scope-policy.md` Option C section; v6 references it as the single source.

5. **Vercel deploy verification ties to the no-op commit SHA.** v5 captured "the latest production deploy" without proving it came from the verification push. A racing main push, a skipped build (`ignoreCommand`), or a cron-triggered deploy could substitute a different deploy. v6 captures `HEAD_SHA=$(git rev-parse HEAD)` BEFORE the push, then queries Vercel REST API `GET /v6/deployments?projectId=<id>&target=production&limit=1` with `Authorization: Bearer $VERCEL_TOKEN` and asserts `.deployments[0].meta.githubCommitSha == $HEAD_SHA` before checking the alias.

6. **Fallback write probe replaced with read-only check.** v5's fallback created a `hap-pat-probe` company then deleted it. HubSpot retains audit history on the delete; the artifact contaminates operator confidence and may leak into seed runs. v6 keeps the read probe (`GET /crm/v3/objects/companies?limit=1`) but drops the write probe. If write-scope verification is truly required, Path B's first real seed call IS the write test — no need for a separate probe. v6 documents this explicitly: "if the documented token-info endpoint 404s AND you need write-scope proof BEFORE Path B, run the real seed for one record and observe success; the seed script's audit footprint is intentional and tracked."

**v5 carry-overs still correct:**

- Phase 0 mechanism, pre-flight pull-conflict check, worktree pruning via patch-id evidence.
- Path A opt-out requires `3a + 3b + 3c` (zero-row check kept on opt-out).
- Wave E matrix: RLS on tenant-scoped data tables, NOT `tenants`; LLM config via resolver-pattern check.
- `domain-path-selected` synthetic milestone.
- HubSpot endpoints: `GET /integrations/v1/me` for portal id; `POST /oauth/v2/private-apps/get/access-token-info` for scopes. Endpoint paths verified via Context7 before running.
- Vercel JSON parse for deploy id (v5 was right that `vercel inspect --json | jq -r .id` is the direction; v6 strengthens with REST API + SHA check).
- Default release tag `v0.1.0-mvp` or `v0.1.0-mvp-smoke` per opt-out state.
- `mode: "bypassPermissions"`, RepoPrompt binding, Context7 docs verification before relying on CLI/endpoint shapes.

**v6 carry-forward note for executing agent:** v5 also flagged that `--target production` may not be a valid `vercel ls` flag in all CLI versions, and `--json` may not be documented on `vercel inspect`. v6 mandates: **before running Phase 1 verification, run `vercel ls --help` and `vercel inspect --help` against the installed CLI and confirm the flags work. If not, fall back to the Vercel REST API path documented inline in Phase 1.** The REST API is the source of truth; the CLI is convenience.

## Task Description

All 11 Taskmaster tasks (75 subtasks) are `done`. Slice-12 PRs (#30–#36) and post-slice-12 PRs (#46, #47, #48) merged + deployed.

Remaining:

1. Local hygiene with pre-flight pull-conflict check + no `git stash -u`.
2. **#49** custom-domain auto-promotion.
3. Merge PR #50 (parallel with #49).
4. Test portal prep — production DB fingerprint (mktemp + trap + regex hostname check), zero-row, lifecycle bootstrap, Private App + real scope verification (required ⊂ returned).
5. Wave D walkthrough (Path A + Path B).
6. Wave E sign-off (v6 matrix).
7. Docs sweep + handoff closure + release tag.

#18 out of scope.

## Objective

Ship MVP where:

1. Local `main` matches `origin/main`, clean tree, ≤ 2 worktrees, v6 plan committed.
2. `git push origin main` → new prod deploy ≤ 2 min → Vercel REST API confirms `meta.githubCommitSha == HEAD_SHA` AND `hap.mandigital.dev` alias matches the new deploy id ≤ 2 min later AND authenticated `curl` to `/admin/keep-alive` returns 200 + valid JSON, multi-region sampled. (Or: manual fallback documented.)
3. PR #50 MERGED.
4. Production DB pulled to ephemeral temp file with trap cleanup; hostname matches `^aws-0-[a-z0-9-]+\.pooler\.supabase\.com$`; chosen portal has zero tenant rows; lifecycle subs bootstrapped. (Path B only:) Private App created; token in operator's local `.env`; `GET /integrations/v1/me` returns expected portal id; `POST /oauth/v2/private-apps/get/access-token-info` confirms required Option C scopes ⊂ returned scopes (or read-only fallback succeeds).
5. Operator completes Path A (always) AND Path B (mandatory unless opted out).
6. Wave E pass against v6 matrix.
7. README/CHANGELOG/decision-doc-status updated; handoffs closed; release tag command surfaced.

Out of scope: #18, anything outside V1 wedge.

## Problem Statement

Same as v5. v6 hardens the operator-prep mechanics: prod secrets no longer leak into the repo tree; scope verification can't silently pass with missing scopes; deploy verification can't accept a deploy from a different commit; region migrations don't hard-fail; IPv6 hostnames don't break parsing; the write probe doesn't leave CRM audit noise.

## Solution Approach

Same phasing as v5. v6 changes are tactical: better mechanics inside Phase 1 verification and Phase 3 prep; matrix unchanged from v5.

TDD waiver: Phase 1 (#49 fix), Phase 5b docs-sweep, Phase 5c release tag.

## Relevant Files

### Repo hygiene (Phase 0)

Same as v5.

### Custom-domain auto-promotion (#49, Phase 1) — v6 verification

- Vercel project: `man-digital/hap-signal-workspace-staging` (`prj_4URVqH5tUCVFzASVnahG22Pzk5I3`).
- `apps/api/src/routes/admin/keep-alive.ts` — verified return shape; no deploy id.
- `docs/runbooks/vercel-deploy.md` — Phase 1 appends section.
- **CLI flag confirmation (do FIRST, every run):** `vercel ls --help` and `vercel inspect --help` against installed CLI. Confirm `--json`, `--target production` (or equivalent), `--scope`. If absent, use REST API.
- **REST API source of truth:**
  - `GET https://api.vercel.com/v6/deployments?projectId=prj_4URVqH5tUCVFzASVnahG22Pzk5I3&target=production&limit=1` with `Authorization: Bearer $VERCEL_TOKEN`.
  - Response shape (per docs): `.deployments[0].uid`, `.deployments[0].meta.githubCommitSha`, `.deployments[0].state`.
  - `VERCEL_TOKEN` must be in operator's env (created via `vercel login` or generated in Vercel dashboard with scope-of-project access). DO NOT commit; DO NOT add to Vercel project env.

### Wave D runbook (PR #50, Phase 2)

Same as v5.

### Test portal prep (Phase 3, v6 mechanics)

- `AGENTS.md:53-60` — Phase 3 Locked Decisions.
- `docs/decisions/oauth-scope-policy.md` Option C section — **canonical required-scopes list**. Phase 3e reads this, NOT a literal in the script.
- `scripts/seed-hubspot-test-portal.ts:405-414` — dry-run path; do NOT use for token validation.
- HubSpot endpoints (verify via Context7 before running):
  - `GET https://api.hubapi.com/integrations/v1/me` — portal id.
  - `POST https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info` body `{"tokenKey": "<token>"}` — `hubId` + `scopes`.
  - Fallback: `GET /crm/v3/objects/companies?limit=1` for read-only proof. NO write probe.
- Supabase project URL via `mcp__supabase__get_project_url` (optional cross-check that the pulled DB is the right project).
- Lifecycle bootstrap: `docs/runbooks/slice-11-dev-quickstart.md`.
- Recommended portal: `sales-intel` (144198749).

### Wave D walkthrough (#37, Phase 4)

Same as v5.

### Wave E validation (#42, Phase 5)

Same as v5.

### MVP closure (Phase 5b)

Same as v5.

## Implementation Phases

### Phase 0: Repo hygiene

Same as v5. Pre-flight pull-conflict check, targeted `git restore`, no `git stash -u`, `git patch-id`/`range-diff` before worktree prune. Commit v6 plan + archived notes.

### Phase 1: Custom-domain auto-promotion fix (#49) — v6 verification

Same diagnosis order. v6 verification:

**Step 0 — CLI flag confirmation.** Run `vercel ls --help` and `vercel inspect --help`. Confirm `--json` exists on both AND `--target production` exists on `ls`. If either flag is missing, skip to REST API path below.

**Step 1 — Create the no-op commit, THEN capture its SHA, THEN push.**

Critical ordering — capturing `HEAD_SHA` before the no-op commit captures the pre-verification SHA, so the deployed SHA will never match. v6.1 corrects the v6 ordering bug surfaced in Codex re-review.

```bash
# 1. Create the no-op commit FIRST.
git commit --allow-empty -m "chore(deploy): verify auto-promotion (no-op for #49)"

# 2. Capture the SHA of THAT commit — this is the SHA Vercel will report on deploy.
HEAD_SHA=$(git rev-parse HEAD)
echo "Captured HEAD after no-op commit: $HEAD_SHA"

# 3. Push. The deploy that fires from this push will report meta.githubCommitSha == HEAD_SHA.
git push origin main

# Poll until a deploy with this SHA appears as READY (see Step 3 below).
```

**Step 3 — Verify the latest production deploy came from this push.**

Preferred (CLI):

```bash
LATEST=$(vercel ls --target production --scope=man-digital --json | jq -r '.deployments[0]')
LATEST_SHA=$(echo "$LATEST" | jq -r '.meta.githubCommitSha // .meta.gitCommitSha // ""')
LATEST_ID=$(echo "$LATEST" | jq -r '.uid // .id')
[ "$LATEST_SHA" = "$HEAD_SHA" ] || { echo "WRONG_DEPLOY: latest sha $LATEST_SHA != $HEAD_SHA"; exit 1; }
```

REST API fallback (always supported):

```bash
RESP=$(curl -fsS \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v6/deployments?projectId=prj_4URVqH5tUCVFzASVnahG22Pzk5I3&target=production&limit=1")
LATEST_SHA=$(echo "$RESP" | jq -r '.deployments[0].meta.githubCommitSha')
LATEST_ID=$(echo "$RESP" | jq -r '.deployments[0].uid')
LATEST_STATE=$(echo "$RESP" | jq -r '.deployments[0].state')
[ "$LATEST_STATE" = "READY" ] || { echo "NOT_READY: state=$LATEST_STATE"; exit 1; }
[ "$LATEST_SHA" = "$HEAD_SHA" ] || { echo "WRONG_DEPLOY: $LATEST_SHA != $HEAD_SHA"; exit 1; }
```

**Step 4 — Verify canonical domain alias points at THIS deploy.**

Preferred:

```bash
ALIASED=$(vercel inspect --json https://hap.mandigital.dev --scope=man-digital | jq -r '.id // .uid')
[ "$LATEST_ID" = "$ALIASED" ] && echo OK || { echo "ALIAS_MISMATCH"; exit 1; }
```

REST API fallback:

```bash
# Resolve hap.mandigital.dev → current deploy id via alias endpoint
ALIASED=$(curl -fsS \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v4/aliases/hap.mandigital.dev" \
  | jq -r '.deploymentId')
[ "$LATEST_ID" = "$ALIASED" ] && echo OK || { echo "ALIAS_MISMATCH"; exit 1; }
```

**Step 5 — Authenticated reachability check on canonical domain.**

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://hap.mandigital.dev/admin/keep-alive" | jq -e '.status == "ok"'
```

**Step 6 — Multi-region sampling.** Re-run step 4 from a non-local network/VPN to catch stale-edge.

Append "Custom-domain promotion" section to `docs/runbooks/vercel-deploy.md`.

**Stall mitigation, TDD waiver, rollback:** same as v5.

### Phase 2: Wave D runbook merge (#50)

Same as v5.

### Phase 3: Test portal prep (operator, v6 mechanics)

**3a — Production DB pull with trap cleanup, no repo-tree spill.**

```bash
# Pull to ephemeral temp file OUTSIDE the repo. Guarantee cleanup on any exit.
ENV_FILE=$(mktemp -t hap-prod-env.XXXXXX)
chmod 600 "$ENV_FILE"
trap 'rm -f "$ENV_FILE"' EXIT INT TERM

cd "$REPO_ROOT"
vercel env pull "$ENV_FILE" --environment=production --scope=man-digital --yes

# Extract ONLY DATABASE_URL into this shell. Do not source the file as a whole.
DATABASE_URL=$(grep '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"')
export DATABASE_URL

# Parse hostname with a real URL parser (handles IPv6, percent-encoded passwords).
PG_HOST=$(python3 -c "
from urllib.parse import urlparse
import os, sys
h = urlparse(os.environ['DATABASE_URL']).hostname
sys.stdout.write(h or '')
")

# Or, if python3 is not available:
# PG_HOST=$(node -e "console.log(new URL(process.env.DATABASE_URL).hostname)")

echo "Parsed DB host: $PG_HOST"

# Region-allowlist regex — accepts any Supabase Pooler region, rejects everything else.
if ! echo "$PG_HOST" | grep -qE '^aws-0-[a-z0-9-]+\.pooler\.supabase\.com$'; then
  echo "WRONG_DB_HOST: $PG_HOST does not match Supabase Pooler pattern"
  exit 1
fi

# Optional cross-check: confirm pulled URL belongs to the expected Supabase project.
# (Run via Supabase MCP if available: mcp__supabase__get_project_url.)

# Confirm DB name.
psql "$DATABASE_URL" -tA -c "SELECT current_database();" | grep -E "^postgres$" \
  || { echo "WRONG_DB"; exit 1; }
```

The `trap` line guarantees `$ENV_FILE` is deleted when the shell exits — success, error, Ctrl-C, kill. Do NOT mention `$ENV_FILE` after the trap is set; only use the extracted `$DATABASE_URL` variable.

**3b — Zero-row check on chosen portal (required for both Path B and Path A opt-out).**

Same as v5.

**3c — Lifecycle subscription bootstrap.** Same as v5.

**3d — Private App creation** (Path-B-only). Same as v5.

**3e — Real scope verification (v6 — required ⊂ returned).**

```bash
source <(grep '^HUBSPOT_PRIVATE_APP_TOKEN=' .env | sed 's/^/export /')

# Step 1: portal id.
curl -fsS -H "Authorization: Bearer $HUBSPOT_PRIVATE_APP_TOKEN" \
  "https://api.hubapi.com/integrations/v1/me" | tee /tmp/hap-pat-portal.json
jq -e '.portalId == 144198749' /tmp/hap-pat-portal.json \
  || { echo "WRONG_PORTAL"; exit 1; }

# Step 2: scope check via documented Private App token-info endpoint.
# VERIFY endpoint path via Context7 before running.
curl -fsS -X POST \
  -H "Authorization: Bearer $HUBSPOT_PRIVATE_APP_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"tokenKey\":\"$HUBSPOT_PRIVATE_APP_TOKEN\"}" \
  "https://api.hubapi.com/oauth/v2/private-apps/get/access-token-info" \
  | tee /tmp/hap-pat-scopes.json

# Required scopes from docs/decisions/oauth-scope-policy.md Option C.
# Update this list IF the decision doc changes.
REQUIRED='[
  "crm.objects.companies.read",
  "crm.objects.companies.write",
  "crm.objects.contacts.read",
  "crm.objects.contacts.write"
]'

# v6 assertion: required ⊂ returned. (required - returned).length == 0.
jq --argjson required "$REQUIRED" \
  -e '($required - (.scopes // [])) | length == 0' \
  /tmp/hap-pat-scopes.json \
  || { echo "MISSING_SCOPES: required not all present"; jq '.scopes' /tmp/hap-pat-scopes.json; exit 1; }
```

**Fallback (if token-info endpoint 404s) — READ ONLY.** v6 drops the write probe. If write-scope proof is required before Path B, run the real seed for one record:

```bash
# Read probe — proves the token works and has crm.objects.companies.read.
curl -fsS -H "Authorization: Bearer $HUBSPOT_PRIVATE_APP_TOKEN" \
  "https://api.hubapi.com/crm/v3/objects/companies?limit=1" | jq -e '.results' || exit 1

# Write probe REMOVED — leaves CRM audit history. If you need write-scope proof,
# Path B's first real seed call IS the write test. Treat seed audit footprint as
# expected and tracked, not as probe contamination.
```

**Decision gate.** Same as v5: opt-out requires `3a + 3b + 3c`; `3d` + `3e` skipped.

### Phase 4: Operator walkthrough (#37) — HUMAN

Same as v5.

### Phase 5: Wave E + MVP closure

Same as v5. Matrix unchanged from v5.

### RepoPrompt MCP Discipline

Same as v5.

## Team Orchestration

Same as v5. Team members unchanged.

## Step by Step Tasks

### 1. Repo hygiene

Same as v5 with commit message `chore(docs): add v6 mvp-close plan; archive issue-17 session note`.

### 2. Custom-domain auto-promotion fix (#49) — v6 verification

- **Task ID**: `domain-autopromote`
- **Depends On**: `repo-hygiene`
- **Assigned To**: `builder-domain-autopromote`
- **Agent Type**: `deployment-engineer`
- **Parallel**: true (with `wave-d-runbook-merge`)
- Diagnose via the documented surfaces.
- Verify via the v6 6-step procedure (`vercel ls/inspect --help` flag check FIRST; then HEAD SHA capture; no-op push; deploy SHA verification; alias-to-deploy comparison; authenticated reachability; multi-region sampling). Use REST API where CLI flags are unavailable.
- Append runbook section.
- **Verification:** v6 procedure passes; runbook updated.
- **TDD waiver:** infra config.
- **Rollback:** revert dashboard toggle; manual `vercel alias set`.

### 3. Wave D runbook merge (#50)

Same as v5.

### 4. Mark `domain-path-selected` milestone

Same as v5.

### 5. Test portal prep — operator (v6 mechanics)

- **Task ID**: `test-portal-prep`
- **Depends On**: `wave-d-runbook-merge`
- **Assigned To**: `operator-walkthrough` (HUMAN, optional `general-purpose` for shell substeps)
- **Agent Type**: N/A (human)
- **Parallel**: false
- Execute Phase 3 steps 3a–3e per decision gate. Opt-out requires `3a + 3b + 3c`.
- **3a v6 mechanics:** `mktemp` outside repo, `trap rm EXIT INT TERM`, hostname via `python3 urlparse` (or `node URL`), region-allowlist regex `^aws-0-[a-z0-9-]+\.pooler\.supabase\.com$`.
- **3e v6 mechanics:** `(required - returned).length == 0` jq assertion. Required list from `docs/decisions/oauth-scope-policy.md` Option C.
- **Verification:** 3a parsing + hostname regex passes + DB name `postgres` + `$ENV_FILE` cleaned up on exit; 3b returns 0; 3c subscriptions visible; 3d token in local `.env`; 3e portal id check + required ⊂ returned scope check (or read-only fallback). Opt-out: 3a + 3b + 3c only.

### 6. Operator walkthrough (#37) — HUMAN

Same as v5.

### 7. Wave E quality-engineer validation (#42) — v6 matrix (unchanged from v5)

Same as v5.

### 8. Docs sweep + MVP closure (5b)

Same as v5.

### 9. Final validation

Same as v5.

## Acceptance Criteria

- `git status` clean; HEAD ≥ `c182cc7`.
- ≤ 2 worktrees. `apps/api/public/.gitkeep 2` deleted. v6 plan committed. Archive moved.
- `git push origin main` → deploy ≤ 2 min → Vercel REST API confirms `meta.githubCommitSha == HEAD_SHA` for latest production deploy AND `hap.mandigital.dev` alias deploy id matches that deploy ≤ 2 min later → authenticated `curl` to `/admin/keep-alive` returns 200 + valid JSON, multi-region sampled. (Or: manual fallback documented.)
- PR #50 MERGED.
- Production DB pull lives in temp file outside repo, deleted on shell exit. Hostname parsed from `DATABASE_URL` matches `^aws-0-[a-z0-9-]+\.pooler\.supabase\.com$`. `current_database()` returns `postgres`. Zero-row check returns 0 on chosen portal. Lifecycle subs bootstrapped. (Required for BOTH Path B and Path A opt-out.)
- (Path B only) Private App created; `HUBSPOT_PRIVATE_APP_TOKEN` in operator's local `.env` only; `GET /integrations/v1/me` returns expected portal id; `POST /oauth/v2/private-apps/get/access-token-info` returns scopes that satisfy required ⊂ returned per Option C (or read-only fallback succeeds + Path B first seed call confirms write scope).
- #37 has operator evidence covering Path A AND Path B (or Path A only if opted out).
- #42 quality-engineer report against v6 matrix; #42 and #37 CLOSED.
- All v6 matrix items PASS (`8 QA states evidenced` marked `N/A — Path B deferred` if opted out).
- Issues CLOSED. Decision doc `Status: Accepted` with PR #47 link.
- README and CHANGELOG reflect shipped MVP.
- Release tag command (`v0.1.0-mvp` or `v0.1.0-mvp-smoke`) surfaced but NOT executed.

## Validation Commands

- `git status` — clean
- `git rev-parse HEAD` vs `git rev-parse origin/main` — match
- `git ls-tree origin/main -- .claude/tasks/2026-05-28-mvp-close-and-ops-hardening.md` — empty BEFORE Task 1, non-empty AFTER
- `git worktree list | wc -l` — ≤ 2
- `[ -e "apps/api/public/.gitkeep 2" ] && echo BAD || echo OK` — OK
- Phase 1 CLI flag check: `vercel ls --help | grep -E "\-\-json|\-\-target"` and `vercel inspect --help | grep "\-\-json"` — if any missing, use REST API
- Phase 1 HEAD SHA capture: `git commit --allow-empty` FIRST, then `HEAD_SHA=$(git rev-parse HEAD)` (post-commit, pre-push)
- Phase 1 deploy SHA match (REST): `curl -fsS -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v6/deployments?projectId=prj_4URVqH5tUCVFzASVnahG22Pzk5I3&target=production&limit=1" | jq -r '.deployments[0].meta.githubCommitSha'` matches `$HEAD_SHA`
- Phase 1 deploy ready: same REST response, `.deployments[0].state == "READY"`
- Phase 1 alias match (REST): `curl -fsS -H "Authorization: Bearer $VERCEL_TOKEN" "https://api.vercel.com/v4/aliases/hap.mandigital.dev" | jq -r '.deploymentId'` matches `.deployments[0].uid`
- Phase 1 reachability: `curl -fsS -H "Authorization: Bearer $CRON_SECRET" "https://hap.mandigital.dev/admin/keep-alive" | jq -e '.status == "ok"'`
- Phase 3a env file ephemerality: `ENV_FILE=$(mktemp ...); trap 'rm -f "$ENV_FILE"' EXIT INT TERM`. After exit, `[ -e "$ENV_FILE" ] && echo LEAKED || echo OK` — OK.
- Phase 3a hostname regex: `echo "$PG_HOST" | grep -qE '^aws-0-[a-z0-9-]+\.pooler\.supabase\.com$' && echo OK || echo WRONG_HOST`
- Phase 3a DB name: `postgres`
- Phase 3b zero-row: 0
- Phase 3e portal: `jq -e '.portalId == 144198749' /tmp/hap-pat-portal.json`
- Phase 3e scopes (required ⊂ returned): `jq --argjson required '[<list>]' -e '($required - (.scopes // [])) | length == 0' /tmp/hap-pat-scopes.json`
- `pnpm test` / `pnpm typecheck` / `pnpm lint` / `pnpm build` — green
- `gh pr view 50 --json state` — MERGED
- `for n in 16 19 28 37 38 39 40 41 42 43 44 45 49; do echo -n "#$n "; gh issue view $n --json state -q .state; done` — all CLOSED
- `gh issue list --state open` — only `#18` (+ optional Path-B follow-up if opt-out)
- `grep -E "^Status:" docs/decisions/oauth-scope-policy.md` — `Status: Accepted`

## Notes

- **Out of scope:** #18; anything outside V1 wedge.
- **TDD waiver scope:** Phase 1 (#49 fix), Phase 5b docs-sweep, Phase 5c release tag.
- **Permission mode:** every `Agent()` call MUST include `mode: "bypassPermissions"`.
- **RepoPrompt binding:** mandatory before any code-touching tool call.
- **Task Master mirroring:** tag `mvp-close`.
- **AGENTS.md alignment:** Wave E matrix excludes RLS check on `tenants`.
- **DATABASE_URL provenance (v6):** pulled to `mktemp` outside repo, trap-cleaned, parsed via `python3 urlparse` (or `node URL`), region-allowlist regex.
- **Token verification (v6):** `(required - returned).length == 0` assertion. Required list from `docs/decisions/oauth-scope-policy.md` Option C. Verify endpoint path via Context7 before running.
- **Deploy verification (v6):** ties to `HEAD_SHA` via Vercel REST API `meta.githubCommitSha` match. CLI is convenience; REST is source of truth.
- **Fallback probe (v6):** read-only. No write probe — leaves CRM audit history. If write-scope proof needed before Path B, the seed's real first call IS the write test.
- **Region-allowlist regex (v6):** `^aws-0-[a-z0-9-]+\.pooler\.supabase\.com$` accepts any Supabase Pooler region, rejects arbitrary hostnames. Update if Supabase changes their Pooler URL convention.
- **`domain-path-selected` milestone:** Phase 4 depends on synthetic gate, not on `domain-autopromote` task completion.
- **Stall mitigations:** Phase 1 manual `vercel alias set` fallback; Phase 3 opt-out gate; Phase 4 human-resume.
- **Worktree pruning safety:** `git patch-id` + `git range-diff`.
- **Rollback Phase 1:** revert dashboard toggle, manual alias. Phase 5b: `git revert`.
- **VERCEL_TOKEN required for Phase 1 REST API path.** Operator generates token via `vercel login` or Vercel dashboard. Local-only; not committed, not in Vercel project env.
