# Slice 12 — Wave D operator walkthrough

> **Purpose**: end-to-end operator validation that the slice-12 acceptance criteria hold against the live production deployment on a real HubSpot test portal. Tracks GitHub issue [#37](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/37).
>
> **Scope (Path A)**: validates #19 (lifecycle log shape), #16 (OAuth `htmlSuccess` page), and #28 (default-on enrichment). No seed data, no 8-state UI walk — that's Path B and blocked on the scope decision being implemented (#38 / PR #47 / `docs/decisions/oauth-scope-policy.md`).
>
> **Production state confirmed pre-walkthrough (2026-05-19)**:
>
> - `hap.mandigital.dev` aliased to `dpl_1qag14gpq` (post-#47 deploy)
> - `/admin/keep-alive` returning 200 with sweptNonces > 0
> - Supabase project reachable, schema integrity confirmed
> - None of the recommended test portals currently has a tenant row — installs will be fresh

## Pick a test portal

Five HubSpot accounts are available via the `hs` CLI per [issue #44](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/44):

| Portal id | Name                        | Type                                 | Recommendation                                                                                                                                                                                      |
| --------- | --------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 144198749 | sales-intel                 | test (under man-digital-dev)         | **Best choice for a fresh slice-12 walkthrough.** No tenant row exists, the portal hasn't been used since slice 12 landed, so the install will exercise the full Wave-C default-on-enrichment path. |
| 147062576 | man-digital-dev-account-oct | standard                             | Default in `hs config.yml`. Also fresh — viable.                                                                                                                                                    |
| 27151345  | man-digital-dev             | dev account (parent of sales-intel)  | OK if you want to install on the dev account itself.                                                                                                                                                |
| 146425426 | man-digital-development     | dev account (parent of mandev)       | Same.                                                                                                                                                                                               |
| 146425449 | mandev                      | test (under man-digital-development) | Previously had a tenant row with `settings={}` (pre-Wave-C). That row is gone from the current DB, so this is also viable for a fresh install.                                                      |

Pick one. The walkthrough below uses `<PORTAL_ID>` as a placeholder.

## Pre-flight (server-side checks, run before clicking anything)

These have been verified once on 2026-05-19. Re-run before starting the walkthrough to confirm nothing has drifted.

```bash
# 1. Keep-alive route healthy (also confirms DB reachability via SELECT 1)
curl -sS -H "Authorization: Bearer $CRON_SECRET" https://hap.mandigital.dev/admin/keep-alive
# Expected: HTTP 200, {"status":"ok","dbPingMs":<n>,"sweptNonces":<n>,"timestamp":"..."}

# 2. Production alias points at the latest deploy
vercel ls hap-signal-workspace-staging --scope=man-digital | head -3
# Expected: top row's deployment id matches `dpl_*` you see in `vercel inspect`.
# If the production alias is behind, see #49.

# 3. No pre-existing tenant for the chosen portal
psql "$DATABASE_URL" -c "SELECT hubspot_portal_id, name, is_active, settings, created_at FROM tenants WHERE hubspot_portal_id = '<PORTAL_ID>';"
# Expected: zero rows. If a row exists, archive it first via:
#   UPDATE tenants SET is_active = false WHERE hubspot_portal_id = '<PORTAL_ID>';
# or pick a different portal — a re-install on an existing tenant skips the
# `.values({settings:{enrichmentEnabled:true}})` insert (the slice-12 #28 path).
```

## The walkthrough

Each step has an acceptance criterion + an evidence artifact. Capture every artifact — these are what close [#37](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/37).

### Step 1 — start the log tail (separate terminal)

Open a second terminal. The log tail must be running BEFORE you click install so it captures both lifecycle deliveries (`install` then `applied`).

```bash
vercel logs hap-signal-workspace-staging --scope=man-digital --follow 2>&1 | grep -E "hubspot-lifecycle-webhook|hubspot-oauth"
```

Leave this running through steps 2–6.

### Step 2 — trigger OAuth install on the chosen portal

In a browser **logged into the chosen test portal**, navigate to:

```
https://hap.mandigital.dev/oauth/install
```

You should see HubSpot's authorization prompt listing the read-only scopes:

- `oauth`
- `crm.objects.companies.read`
- `crm.objects.contacts.read`

Click **Authorize**.

**Acceptance for #16**: after authorize, you land on a polished `htmlSuccess` page hosted at `hap.mandigital.dev` with a clear **"Return to HubSpot"** CTA. The page should NOT contain a `<meta refresh>` tag (the slice-12 preflight removed it as dead code).

**Evidence**: take a screenshot of the htmlSuccess page. Attach to #37.

### Step 3 — confirm lifecycle log shape

Switch to the log-tail terminal. You should see two lines for the install:

```
hubspot-lifecycle-webhook: request received
hubspot-lifecycle-webhook: applied=1 ignored=0 portalIds=<PORTAL_ID>
```

**Acceptance for #19**: both lines present, in that order, with `applied=1` and the correct `portalIds` value.

**Evidence**: paste the log excerpt into #37 (5–10 lines of context is enough).

### Step 4 — confirm default-on enrichment

Run the SQL query (in your shell with `DATABASE_URL` exported):

```bash
psql "$DATABASE_URL" -c "SELECT hubspot_portal_id, name, is_active, settings, created_at FROM tenants WHERE hubspot_portal_id = '<PORTAL_ID>';"
```

Expected output:

```
 hubspot_portal_id |  name  | is_active |          settings           |          created_at
-------------------+--------+-----------+-----------------------------+------------------------------
 <PORTAL_ID>       | <name> | t         | {"enrichmentEnabled": true} | 2026-05-19 hh:mm:ss.xxx+00
```

**Acceptance for #28**: `settings.enrichmentEnabled` is `true`. (If `{}`, the install hit the `ON CONFLICT DO NOTHING` path — meaning a previous tenant row existed. Re-run after archiving the old row, or pick a different portal.)

**Evidence**: paste the psql output into #37.

### Step 5 — trigger uninstall + reinstall

In HubSpot UI for the test portal: **Settings → Integrations → Connected Apps → HAP Signal Workspace → Uninstall**.

Wait ~5 seconds. The log tail should show:

```
hubspot-lifecycle-webhook: request received
hubspot-lifecycle-webhook: applied=1 ignored=0 portalIds=<PORTAL_ID>
```

Then in the browser, navigate back to:

```
https://hap.mandigital.dev/oauth/install
```

…and reauthorize. The log tail should show two more lines (a second pair, total 4 since you started watching).

**Acceptance for #19 (full)**: two lifecycle deliveries observed — one for uninstall, one for reinstall. Each delivery emits both log lines.

**Evidence**: paste the additional log excerpts into #37.

### Step 6 — close out the issue

In [#37](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/37), check off the acceptance criteria boxes and attach the evidence. Then comment with a brief summary, e.g.:

```
Wave D complete on portal 144198749 (sales-intel) at 2026-05-19 hh:mm UTC.
- #16: htmlSuccess page rendered with "Return to HubSpot" CTA (screenshot attached)
- #19: 4 lifecycle log lines captured (2 deliveries × 2 lines each — log excerpt attached)
- #28: tenant row inserted with settings.enrichmentEnabled = true (psql output attached)

Wave E (#42) is now unblocked.
```

Close the issue. Move on to Wave E (#42), which is engineer-side validation of the merged code against the same acceptance criteria, plus PR #46/#47/#48 review-sweep.

## Troubleshooting

### htmlSuccess page didn't render — got a redirect or error instead

HubSpot OAuth flows can include a `returnUrl` query param when the install originates from the marketplace listing. When `returnUrl` is present, the code path is `302 → returnUrl` (HubSpot redirects you back into the portal). `htmlSuccess` is the FALLBACK shown only when `returnUrl` is absent or fails the `isAllowedReturnUrl(...)` guard.

If you started the install from `https://hap.mandigital.dev/oauth/install` directly (no `returnUrl`), you should always land on htmlSuccess. If you started from the marketplace listing, you'll be redirected back to HubSpot without seeing htmlSuccess — that's the primary path and is also correct behavior. To force htmlSuccess for the screenshot, start from `/oauth/install` directly.

### Log tail shows zero lines for the install

Two known causes:

1. **Production alias hasn't promoted to the latest deploy** (issue [#49](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/49)). The deployed code logs correctly but `hap.mandigital.dev` is pinned to an older deploy that predates the lifecycle logging. Check via:

   ```bash
   vercel alias ls --scope=man-digital | grep hap.mandigital.dev
   ```

   If the source deploy is older than the merge of PR #33 (lifecycle logging), re-alias manually:

   ```bash
   vercel alias set <latest-deploy-url> hap.mandigital.dev --scope=man-digital
   ```

2. **The webhook subscription isn't bootstrapped on the production app.** HubSpot only delivers lifecycle events for `INSTALL` / `UNINSTALL` if your app has registered for them. PR #33 added the subscription-bootstrap admin endpoint. If lifecycle deliveries never reach the function, run:
   ```bash
   curl -X POST -H "X-Internal-Bootstrap-Token: $INTERNAL_BOOTSTRAP_TOKEN" \
     https://hap.mandigital.dev/admin/lifecycle/bootstrap
   ```
   …and retry the walkthrough. Check the response — `created` should list the install + uninstall event subscriptions.

### Tenant row not inserted

If the OAuth flow completed (htmlSuccess rendered, you got redirected back) but no row appears in `tenants`, that means the install hit the `ON CONFLICT DO NOTHING` path — there's already an entry for that portal (possibly with `is_active = false`). Check:

```sql
SELECT id, hubspot_portal_id, is_active, settings FROM tenants WHERE hubspot_portal_id = '<PORTAL_ID>';
```

If the row exists with `is_active = false`, slice 12's reinstall semantics activated it again. Verify:

```sql
SELECT updated_at FROM tenants WHERE hubspot_portal_id = '<PORTAL_ID>';
-- updated_at should be within the last minute
```

If the row exists with `settings = '{}'`, this is the pre-Wave-C state — the `.values({...})` block was skipped on conflict, which is the documented behavior. Archive the row (set `is_active = false`, change the portal_id, or hard-delete in dev DBs) and re-run.

## References

- Issue: [#37](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/37)
- Plan: `.claude/tasks/2026-05-10-mvp-deployment-readiness.md`
- Preflight: `docs/slice-12-preflight-notes.md`
- Lifecycle log shape: `docs/runbooks/slice-11-dev-quickstart.md` (updated 2026-05-10)
- htmlSuccess source: `apps/api/src/routes/oauth.ts:123`
- Default-on enrichment source: `apps/api/src/routes/oauth.ts:241`
- Lifecycle log emitter: `apps/api/src/routes/lifecycle.ts:95, 168–170`
- Blocks: [#42](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/42) (Wave E)
- Related: [#49](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/49) (custom domain auto-promotion), [#38](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/38) (Path B scope decision)
