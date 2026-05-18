# Supabase auto-pause runbook

> **TL;DR**: A Vercel cron hits `/admin/keep-alive` once a day. As long as that cron keeps firing, the production Supabase project stays warm. If the project pauses anyway, unpause via the Supabase dashboard and check the cron history in Vercel.

## What triggers an auto-pause

Supabase free-tier projects pause after roughly **7 days of database inactivity**. "Inactivity" means no queries executed against Postgres — inbound HTTP requests that fail before reaching the DB do not count.

Pausing is silent. The dashboard still loads, but every connection from the API returns `connection refused` until someone clicks "Restore project" in the Supabase UI.

This was first observed during slice 12 (issue [#41](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/41)) when the project paused between the slice landing in `main` and the operator walkthrough being executed. Every backend operation (OAuth callback, lifecycle webhook, settings API) returned 5xx until the project was manually unpaused.

## Mitigation in place

Vercel cron schedule lives in [apps/api/vercel.json](apps/api/vercel.json):

```json
"crons": [{ "path": "/admin/keep-alive", "schedule": "0 12 * * *" }]
```

The cron hits [apps/api/src/routes/admin/keep-alive.ts](apps/api/src/routes/admin/keep-alive.ts) daily at 12:00 UTC. Each invocation:

1. Runs `select 1` against Postgres (the keep-alive ping)
2. Calls `sweepExpiredNonces(db)` to delete `signed_request_nonce` rows older than 10 minutes (TTL cleanup that has been promised in the schema comment since slice 3)

The DB ping happens regardless of the sweep result, so the auto-pause clock is reset on every successful run.

### Auth

Vercel cron injects `Authorization: Bearer <CRON_SECRET>` automatically when the `CRON_SECRET` env var is set on the project. The route compares this with constant-time `timingSafeEqual`. Behavior:

| Condition                      | Status | Body                                                         |
| ------------------------------ | ------ | ------------------------------------------------------------ |
| `CRON_SECRET` env not set      | 503    | `{ "error": "keepalive_not_configured" }`                    |
| Authorization header missing   | 401    | `{ "error": "missing_cron_token" }`                          |
| Bearer token wrong             | 403    | `{ "error": "invalid_cron_token" }`                          |
| DB unreachable (ping or sweep) | 503    | `{ "error": "database_unreachable" }`                        |
| Success                        | 200    | `{ "status": "ok", "dbPingMs", "sweptNonces", "timestamp" }` |

A 503 from this route surfaces as a failed run in Vercel's cron history, which is the alerting channel we want — failures are loud, not silent.

## Setup on a fresh deployment

The route is wired in code. The only manual step is the env var:

```bash
# From the apps/api directory of a linked project
vercel env add CRON_SECRET production
# Paste a random 32+ byte secret. This becomes the Bearer token Vercel injects.
```

After the next deploy, verify:

```bash
# Confirm Vercel registered the cron
vercel crons ls --scope=man-digital
# Expected: an entry for /admin/keep-alive on the production deployment

# Smoke-test the endpoint manually
curl -i -H "Authorization: Bearer $CRON_SECRET" https://hap.mandigital.dev/admin/keep-alive
# Expected: HTTP 200, JSON with status=ok, dbPingMs (number), sweptNonces (number)
```

## If the project pauses anyway

1. **Unpause**: open [the Supabase project](https://supabase.com/dashboard/project/ucjpzljcppxsxtclnbdj) → click "Restore project" or "Resume".
2. **Verify reach** from the machine that has `.env` populated:
   ```bash
   export DATABASE_URL=$(grep '^DATABASE_URL=' .env | cut -d= -f2-)
   psql "$DATABASE_URL" -c 'select now(), version();'
   ```
3. **Check why keep-alive stopped firing**:
   - Vercel dashboard → project → Cron Jobs → look at the last few runs.
   - If runs were succeeding but ten or more days have elapsed since the last 200, the cron schedule may have been disabled or removed.
   - If runs were failing (503 `database_unreachable`), the DB was already paused — once unpaused, the next scheduled run will get it warm again.
4. **Force a warm-up** without waiting for the next scheduled run:
   ```bash
   curl -i -H "Authorization: Bearer $CRON_SECRET" https://hap.mandigital.dev/admin/keep-alive
   ```

## When this mitigation is no longer enough

If you observe repeated pauses despite the cron firing successfully, the working assumption (daily `select 1` is sufficient) has broken. Two next steps:

- **Bump cron frequency** to every 6 hours (`0 */6 * * *`) — still well inside Vercel cron Hobby limits.
- **Upgrade Supabase to Pro** ($25/month) — paid projects do not auto-pause. Track that decision in a new ops issue rather than silently flipping it.
