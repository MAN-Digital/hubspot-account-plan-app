# Vercel deployment runbook

> **TL;DR**: Pushes to `main` auto-deploy to production at `https://hap.mandigital.dev`. Pushes to any other branch trigger preview deploys. If something is wrong with the integration, the symptoms are silent — no errors, just no deploys.

## How deploys reach production today

The Vercel project `man-digital/hap-signal-workspace-staging` is linked to the GitHub repo `MAN-Digital/hubspot-account-plan-app`.

| Setting             | Value                                              |
| ------------------- | -------------------------------------------------- |
| Production Branch   | `main`                                             |
| Root Directory      | `apps/api`                                         |
| Framework Preset    | `hono`                                             |
| Auto-Deploy on Push | `enabled` (`gitProviderOptions.createDeployments`) |
| Production URL      | `https://hap.mandigital.dev`                       |
| Team                | `man-digital` (`team_RgSSPVkSj5hbNoeq7df4lepE`)    |
| Project ID          | `prj_4URVqH5tUCVFzASVnahG22Pzk5I3`                 |

Branch behavior:

- Push to `main` → production deploy → aliased to `hap.mandigital.dev`
- Push to any other branch → preview deploy at a per-deployment URL
- Open PR → preview deploy posted as a check on the PR

## How this was broken before (resolved 2026-05-18, issue #39)

Between project creation and 2026-05-18, the Vercel project had **no git repository connected at all**. Every "production deploy" in the dashboard prior to that date was a manual `vercel deploy --prod` run from a local machine. Merging to `main` did nothing on the Vercel side because there was no webhook to receive the event.

The fix was a single CLI call:

```bash
cd apps/api  # must be inside a directory linked to the project
vercel link --yes --project=hap-signal-workspace-staging --scope=man-digital
vercel git connect https://github.com/MAN-Digital/hubspot-account-plan-app.git --yes
```

After this, the project's `link` field in the API response populates with:

```json
{
  "type": "github",
  "repo": "hubspot-account-plan-app",
  "org": "MAN-Digital",
  "productionBranch": "main",
  "gitCredentialId": "cred_..."
}
```

## Diagnosing an "auto-deploy stopped firing" report

The dashboard alerts are quiet on this kind of regression. Check these in order:

### 1. Confirm git is still linked

```bash
VERCEL_TOKEN=$(jq -r '.token' ~/Library/Application\ Support/com.vercel.cli/auth.json)
TEAM=team_RgSSPVkSj5hbNoeq7df4lepE
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/hap-signal-workspace-staging?teamId=$TEAM" \
  | jq '.link'
```

`link: null` means someone (or something) disconnected it. Reconnect with the `vercel git connect` call above.

`link.productionBranch != "main"` means production deploys aren't firing on `main` pushes. Fix via dashboard → Project Settings → Git → Production Branch.

### 2. Confirm the GitHub webhook is reaching Vercel

```bash
gh api repos/MAN-Digital/hubspot-account-plan-app/hooks --jq '.[] | select(.config.url|test("vercel")) | {url:.config.url, active, last_response: .last_response}'
```

Last response code should be 200 or 204. If 4xx/5xx, look at the failure reason — usually means a credential expired or the project was deleted.

### 3. Confirm recent deploys show `Source: git`

```bash
vercel ls hap-signal-workspace-staging --scope=man-digital
```

In the `Username` column, git-triggered deploys show `github` (or the committer's GitHub login). CLI-triggered deploys show the Vercel user who ran the CLI (e.g. `romeoman`).

If all recent deploys show a Vercel username, no git events have fired since the last manual deploy.

## Manual deploy fallback

If the git integration is broken and you need to ship right now:

```bash
cd "$(git rev-parse --show-toplevel)"
git worktree add .claude/worktrees/deploy-main origin/main
cd .claude/worktrees/deploy-main
cd apps/api
vercel link --yes --project=hap-signal-workspace-staging --scope=man-digital
mkdir -p public && echo "Serverless API placeholder" > public/.placeholder
vercel deploy --prod --yes
```

The `public/` placeholder hack exists because `apps/api/vercel.json` declares `outputDirectory: "public"`. The git-integration build does not need this — Vercel's build runner creates the empty directory on its own when invoked via webhook. This is only required for CLI deploys, and only because we deploy from the repo root via `cd ../..` in `installCommand` / `buildCommand`. (See [#44](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/44) for the gory history.)

## Don't create new projects by accident

`vercel deploy` from a directory that doesn't have a `.vercel/project.json` will create a brand-new project named after the directory. This happened during slice 12 and produced the orphan `man-digital/deploy-main` project ([#40](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/40)).

Before running `vercel deploy --prod` from any directory, confirm:

```bash
cat .vercel/project.json
# Must show:
#   { "projectId": "prj_4URVqH5tUCVFzASVnahG22Pzk5I3",
#     "orgId":     "team_RgSSPVkSj5hbNoeq7df4lepE" }
```

If `.vercel/project.json` is missing or points to a different project, run `vercel link --yes --project=hap-signal-workspace-staging --scope=man-digital` first.

## Custom-domain promotion

> **TL;DR**: `hap.mandigital.dev` only auto-promotes to new production deploys when the project-level setting `autoAssignCustomDomains` is `true`. This was fixed on 2026-05-29 ([#49](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/49)). If it ever reverts, the canonical domain will silently freeze on whatever deployment was last manually aliased — git pushes will still produce deploys, but `hap.mandigital.dev` will not move.

### How custom domain promotion actually works in Vercel

There are two independent paths a deploy can reach a URL:

1. **Intrinsic project aliases.** Every production deploy is automatically given a set of `*.vercel.app` aliases derived from the project/team/branch (e.g. `hap-signal-workspace-staging-git-main-man-digital.vercel.app`). These auto-promote unconditionally — they are not gated by any project setting.
2. **Custom domains attached to the project.** Domains like `hap.mandigital.dev` only follow the latest production deploy when the project-level setting `autoAssignCustomDomains` is `true`. When false, the custom domain stays pinned to whichever deploy it was last explicitly aliased to. CLI deploys (`vercel deploy --prod`) implicitly set this pin; git-integration deploys do not.

This means it is possible — and was the case before #49 — for `hap-signal-workspace-staging-git-main-man-digital.vercel.app` to point at the brand-new deploy while `hap.mandigital.dev` is still pointing at a month-old deploy. Both are "production" deploys; only one is the canonical URL.

### Diagnosis: is the custom domain auto-promoting?

```bash
VERCEL_TOKEN=$(jq -r '.token' ~/Library/Application\ Support/com.vercel.cli/auth.json)

# 1. Check the project-level flag.
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/hap-signal-workspace-staging?slug=man-digital" \
  | jq '{autoAssignCustomDomains, autoAssignCustomDomainsUpdatedBy}'
# Expected: { "autoAssignCustomDomains": true, ... }
# If false → custom domain will NOT auto-promote. Apply fix below.

# 2. Check the domain attachment.
curl -sS -H "Authorization: Bearer $VERCEL_TOKEN" \
  "https://api.vercel.com/v9/projects/hap-signal-workspace-staging/domains?slug=man-digital" \
  | jq '.domains[] | select(.name == "hap.mandigital.dev")'
# Expected: { "verified": true, "gitBranch": null, "redirect": null, "customEnvironmentId": null }
# A non-null gitBranch pins the domain to a specific branch (wrong for the canonical URL).

# 3. Confirm what the custom domain currently resolves to.
vercel inspect hap.mandigital.dev --scope=man-digital --format json 2>/dev/null \
  | jq '{id, url, target, createdAt: (.createdAt/1000|todate), githubCommitSha: .meta.githubCommitSha}'

# 4. Confirm the latest production deploy.
vercel ls --environment production --scope=man-digital --format json 2>/dev/null \
  | jq '.deployments[0] | {url, state, githubCommitSha: .meta.githubCommitSha}'

# The two IDs (step 3 vs step 4) MUST match. If they don't, auto-promotion is broken.
```

### Fix: enable auto-assignment

```bash
VERCEL_TOKEN=$(jq -r '.token' ~/Library/Application\ Support/com.vercel.cli/auth.json)

curl -sS -X PATCH -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"autoAssignCustomDomains": true}' \
  "https://api.vercel.com/v9/projects/hap-signal-workspace-staging?slug=man-digital" \
  | jq '{autoAssignCustomDomains}'
```

This patches the project setting but does **not** retroactively realias the canonical domain to the latest deploy. Existing pins stay until either (a) a new production deploy fires after the flag is true, or (b) you manually realias once to recover.

### Recovery: realias once to the current latest deploy

```bash
cd apps/api  # any directory linked to the project works
LATEST_URL=$(vercel ls --environment production --scope=man-digital --format json 2>/dev/null \
  | jq -r '.deployments[0].url')
vercel alias set "$LATEST_URL" hap.mandigital.dev --scope=man-digital
```

After this, the next push to `main` will produce a new production deploy, the flag will cause `hap.mandigital.dev` to follow that deploy, and no further manual aliasing is needed.

### Verification procedure (post-fix sanity check)

This is the same procedure operators should run any time they suspect the auto-promotion has broken again:

```bash
# 1. Create a no-op commit, THEN capture HEAD SHA, THEN push.
#    Critical ordering: capturing HEAD before the commit captures the wrong SHA.
git commit --allow-empty -m "chore(deploy): verify auto-promotion (no-op)"
HEAD_SHA=$(git rev-parse HEAD)
git push origin main

# 2. Poll until a production deploy with this SHA reaches READY (≤2 min).
VERCEL_TOKEN=$(jq -r '.token' ~/Library/Application\ Support/com.vercel.cli/auth.json)
for i in $(seq 1 24); do
  RESP=$(vercel ls --environment production --scope=man-digital --format json 2>/dev/null)
  STATE=$(echo "$RESP" | jq -r '.deployments[0].state')
  SHA=$(echo "$RESP" | jq -r '.deployments[0].meta.githubCommitSha')
  UID=$(echo "$RESP" | jq -r '.deployments[0].uid // .deployments[0].id')
  echo "[$i] state=$STATE sha=$SHA"
  if [ "$STATE" = "READY" ] && [ "$SHA" = "$HEAD_SHA" ]; then
    echo "Production deploy ready: $UID"
    LATEST_UID="$UID"
    break
  fi
  sleep 10
done
[ "$SHA" = "$HEAD_SHA" ] || { echo "WRONG_DEPLOY: $SHA != $HEAD_SHA"; exit 1; }

# 3. Confirm hap.mandigital.dev resolves to THIS deploy.
ALIASED=$(vercel inspect hap.mandigital.dev --scope=man-digital --format json 2>/dev/null | jq -r '.id')
[ "$LATEST_UID" = "$ALIASED" ] && echo "ALIAS_OK" || { echo "ALIAS_MISMATCH: $ALIASED != $LATEST_UID"; exit 1; }

# 4. Authenticated reachability.
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://hap.mandigital.dev/admin/keep-alive" | jq -e '.status == "ok"'

# 5. Multi-region sanity (run from another network/VPN).
```

### Manual fallback (use only if auto-promotion is broken and you need to ship now)

```bash
cd apps/api
LATEST_URL=$(vercel ls --environment production --scope=man-digital --format json 2>/dev/null \
  | jq -r '.deployments[0].url')
vercel alias set "$LATEST_URL" hap.mandigital.dev --scope=man-digital
```

This is a one-off recovery; it does not fix the underlying flag. If you find yourself running it more than once, re-run the diagnosis above — `autoAssignCustomDomains` likely flipped back to false (the original failure mode under #49).

### Root cause history

The project was created with `autoAssignCustomDomains: false` as a Vercel system default. Before the git integration landed in #39 on 2026-05-18, every "production deploy" was a manual `vercel deploy --prod` CLI run, which implicitly pinned `hap.mandigital.dev` to whatever deploy was made that day. After #39 the git integration started producing new production deploys automatically, but `autoAssignCustomDomains: false` meant the canonical domain remained pinned to the last CLI-deploy (`dpl_DdPBqqzUn5eJTkNHVXxhCQQQ83wB`, 2026-05-19) for the following ten days. The smoke test in PR #46 / #48 surfaced this as a 404 on `/admin/keep-alive` against `hap.mandigital.dev` while the git-aliased URL returned 200.

Fix applied 2026-05-29: PATCH `autoAssignCustomDomains: true` via the projects REST API, then a one-off recovery `vercel alias set`. See [#49](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/49) for the full diagnosis trace.
