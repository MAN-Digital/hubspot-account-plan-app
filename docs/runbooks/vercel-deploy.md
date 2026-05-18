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
