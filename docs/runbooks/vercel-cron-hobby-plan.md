# Vercel Hobby plan cron limit runbook

> **TL;DR**: The Vercel project is on the **Hobby** plan, which allows cron jobs to run **at most once per day**. `/admin/trigify-poll` needs a 6-hourly cadence to keep the Trigify signal feed fresh, so the real 6-hourly cron lives in **GitHub Actions** ([.github/workflows/trigify-poll.yml](../../.github/workflows/trigify-poll.yml)), calling the same endpoint. The Vercel cron entry in [apps/api/vercel.json](../../apps/api/vercel.json) is kept at a daily schedule as a redundant fallback poll.

## The constraint

Vercel's Hobby (free) plan restricts [Cron Jobs](https://vercel.com/docs/cron-jobs/usage-and-pricing) to a **maximum invocation frequency of once per day**. A `crons[]` entry with a sub-daily schedule (e.g. `0 */6 * * *`) is rejected at deploy time on Hobby — the deploy either fails or Vercel silently coerces the schedule to the nearest allowed frequency, depending on the exact violation. Either outcome is worse than designing around the limit up front.

This project's `apps/api/vercel.json` originally shipped `/admin/trigify-poll` at `0 */6 * * *` (Stage A Task 6). That schedule is **not valid on Hobby** and would break the next deploy.

## The fix: split the cadence across two schedulers

1. **Vercel cron (daily, `0 6 * * *`)** — stays in `apps/api/vercel.json`. This is the Hobby-plan-compliant fallback: even if the GitHub Actions workflow is disabled, paused, or the repo secret is missing, the Trigify signal store still gets refreshed once a day and never goes fully stale.
2. **GitHub Actions (6-hourly, `0 */6 * * *`)** — [.github/workflows/trigify-poll.yml](../../.github/workflows/trigify-poll.yml) hits the exact same `/admin/trigify-poll` endpoint on the real 6-hour cadence the plan calls for. This is safe to run more often than the Vercel cron because the endpoint is:
   - **Idempotent**: signals are upserted on `(tenantId, dedupeKey)` (unique constraint `signals_tenant_dedupe_key_unique`) — a redundant poll just re-confirms already-seen signals.
   - **Zero credit spend**: the poll path only calls Trigify's free `GET /v1/social-signals/feed`; it never creates a subscription (see `services/trigify/poller.ts`).

Both schedulers call the identical route with the identical `Authorization: Bearer <CRON_SECRET>` auth — there is only one auth pattern and one route to reason about, just two different triggers.

## Auth: the same `CRON_SECRET`, two homes

| Trigger                 | Where the secret lives                                                        | How it's injected                                                       |
| ----------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Vercel cron             | Vercel project env var `CRON_SECRET`                                          | Vercel injects the header automatically                                 |
| GitHub Actions workflow | GitHub repo secret `CRON_SECRET` (Settings → Secrets and variables → Actions) | The workflow reads `secrets.CRON_SECRET` and sets the header explicitly |

**The GitHub repo secret must be set to the SAME value as the Vercel project's `CRON_SECRET` env var**, or the workflow will get `403 invalid_cron_token` on every run. There is no way to read one from the other — this is a manual one-time copy when either is rotated.

### Missing-secret behavior (forks / early setup)

The workflow checks whether `secrets.CRON_SECRET` is set **before** attempting the call:

- **Secret absent** → the job logs a `::warning::` and skips the poll step entirely. The workflow run still reports success (green check) — this is deliberate so a fork of this repo, or a freshly-cloned CI setup before secrets are configured, doesn't show a permanently red workflow for something the fork owner hasn't configured yet.
- **Secret present, endpoint returns non-200** → the job fails loudly (`exit 1`) with the HTTP status and response body logged. This is the alerting signal we want: a real poll failure (wrong secret, deployment down, DB unreachable) surfaces as a failed GitHub Actions run, not a silent no-op.

## Optional: override the target URL

The workflow defaults to `https://hap.mandigital.dev` (the canonical production domain — see [vercel-deploy.md](./vercel-deploy.md)). To point it at a different deployment (e.g. a staging alias), set the repo/environment **variable** (not secret) `PRODUCTION_URL` in Settings → Secrets and variables → Actions → Variables.

## Upgrading to Vercel Pro

If the project moves to **Vercel Pro** (which allows cron jobs down to once-per-minute, subject to plan limits), the 6-hourly cadence can move back to a native Vercel cron:

1. In `apps/api/vercel.json`, change the `/admin/trigify-poll` entry's schedule from `0 6 * * *` back to `0 */6 * * *`.
2. Either disable `.github/workflows/trigify-poll.yml` (comment out the `schedule:` trigger, keep `workflow_dispatch` for manual runs) or leave it running as a redundant fallback poll — the endpoint's idempotency makes double-polling harmless either way.
3. Redeploy and confirm the new cron schedule appears in the Vercel dashboard's Cron Jobs tab without a plan-limit rejection.

No code changes to `trigify-poll.ts` or `poller.ts` are needed either direction — this is purely a scheduler-cadence decision.

## Verification

Manually trigger the GitHub Actions workflow (Actions tab → "Trigify poll (6-hourly)" → "Run workflow") and confirm:

```bash
gh run list --workflow=trigify-poll.yml --limit 1
gh run view --workflow=trigify-poll.yml --log
```

Expect a 200 response logged with a JSON body `{ "status": "ok", "tenantsPolled": ..., "signalsRecorded": ..., "skipped": ..., "errors": [] }`.

To confirm the Vercel side independently (mirrors the `keep-alive` verification pattern in [vercel-deploy.md](./vercel-deploy.md)):

```bash
curl -fsS -H "Authorization: Bearer $CRON_SECRET" \
  "https://hap.mandigital.dev/admin/trigify-poll" | jq -e '.status == "ok"'
```
