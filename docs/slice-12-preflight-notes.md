# Slice 12 Preflight Notes

Date: 2026-05-10

Purpose: lock five binding decisions before any builder dispatches against
`.claude/tasks/2026-05-10-mvp-deployment-readiness.md` (Wave A and beyond).
This doc is the contract Tasks 1, 4, and 5 implement against — test
assertions and implementation must not drift from the strings, shapes, and
semantics locked here.

Sources (verified 2026-05-10):

- Issue bodies: `gh issue view 19`, `gh issue view 16`, `gh issue view 28`.
- `docs/slice-11-preflight-notes.md` §6 (log-safe fields), §7 (env vars).
- `docs/security/SECURITY.md` (CSP / secret-handling posture, sections 1, 5,
  13, 14, 16, 19).
- `apps/api/src/routes/oauth.ts` (read 2026-05-10) — `htmlError` helper
  (lines 95–105) and tenant insert/upsert block (lines 209–227).
- `apps/api/src/routes/lifecycle.ts` (read 2026-05-10) — handler entry at
  line 94, `applied += 1` at line 164, loop close at line 165, `return
c.json(...)` at line 167.
- `packages/db/src/schema/tenants.ts` (read 2026-05-10) — `settings:
jsonb("settings").default({})` confirmed at line 10.
- HubSpot OAuth docs (Perplexity-cited 2026-05-10):
  https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/working-with-oauth
  ,
  https://developers.hubspot.com/docs/apps/developer-platform/build-apps/authentication/oauth/oauth-quickstart-guide

## 1. Lifecycle log shape (binding contract for Task 1)

The receiver in `apps/api/src/routes/lifecycle.ts` MUST emit exactly two
log lines per request. No structured-logging library, no JSON envelope —
mirror the existing `console.warn` style at lines 118 and 149.

### Request-arrival log

Emit INSIDE `app.post("/", ...)` at line 95, BEFORE the signature/timestamp
header reads.

EXACT call (literal string, no template):

```ts
console.log("hubspot-lifecycle-webhook: request received");
```

Sample line in Vercel logs:

```
hubspot-lifecycle-webhook: request received
```

### Applied/ignored summary log

Emit AFTER the `for (const event of events)` loop closes (line 165) and
BEFORE the `return c.json(...)` at line 167. Exactly one summary per
request, never one per event.

EXACT template (template literal):

```ts
console.log(
  `hubspot-lifecycle-webhook: applied=${applied} ignored=${ignored} portalIds=${portalIds.join(",")}`,
);
```

`portalIds` is a local `string[]` collected inside the loop next to
`applied += 1` at line 164. Push the event's coerced `portalId` only on the
applied path (i.e., after `mapEventTypeId(...)` and `coercePortalId(...)`
have both succeeded). Do NOT collect portalIds from ignored events.

Sample line in Vercel logs (one install delivery, one portal):

```
hubspot-lifecycle-webhook: applied=1 ignored=0 portalIds=146425426
```

Sample line for an ignored delivery (e.g., unknown eventTypeId):

```
hubspot-lifecycle-webhook: applied=0 ignored=1 portalIds=
```

### Test spy assertions (binding regex for Task 1's failing test)

The Vitest test MUST spy on `console.log` and assert both calls were made
with strings matching:

- Request-arrival match — exact equality (preferred):
  `"hubspot-lifecycle-webhook: request received"`.
  Or regex: `/^hubspot-lifecycle-webhook: request received$/`.
- Summary match — regex (only `applied`/`ignored` counts and portalIds
  vary):
  `/^hubspot-lifecycle-webhook: applied=\d+ ignored=\d+ portalIds=[\d,]*$/`.

Use `vi.spyOn(console, "log").mockImplementation(() => {})` and assert
against `spy.mock.calls.flat()` so both calls are visible regardless of
order. Order MUST be request-arrival first, summary second — assert that
explicitly via `spy.mock.calls[0]` vs `spy.mock.calls[1]`.

### Worked example — one APP_INSTALL delivery

Vercel function logs after a single signed `4-1909196` event for portal
`146425426`:

```
hubspot-lifecycle-webhook: request received
hubspot-lifecycle-webhook: applied=1 ignored=0 portalIds=146425426
```

Two consecutive lines per delivery. The runbook's `grep
hubspot-lifecycle-webhook` will return both; operators can read counts
without parsing.

### Don't-Log list (HARD rule)

NEVER pass any of the following to `console.log`, `console.warn`,
`console.error`, or any future logger introduced for the lifecycle
receiver:

- The raw request body (`body` from `c.req.text()`).
- The signature header (`x-hubspot-signature-v3`) or its value.
- The timestamp header value (it's signed input — out of scope; doesn't
  buy us anything in logs).
- Any HubSpot OAuth token, refresh token, or `client_secret`.
- Any `correlationId` from upstream HubSpot errors UNLESS the audit explicitly
  requires it (out of scope for Task 1).

This list is the slice-12 instantiation of `docs/slice-11-preflight-notes.md`
§6 (Error handling — `correlationId` and `message` are safe; bearer token
and `client_secret` are not) and §7 (`HUBSPOT_APP_CLIENT_SECRET` /
`INTERNAL_BOOTSTRAP_TOKEN` MUST NOT appear in logs). The slice-12 logs add
no new sensitive surface — they only emit the already-safe `portalId` field
and two literal counters.

## 2. Log redaction posture

Reaffirm: `portalId` is safe to log. Slice-11 preflight §6 already
established this (numeric tenant identifier, low-PII, already exposed in
the runbook example output and in the live receiver's `console.warn` paths
at lines 118/149). No additional scrubbing is required for slice-12.

Field-by-field decisions for the new summary log:

- **`portalId`** — INCLUDE. Required for operator triage ("did the right
  portal fire?"). Already public-facing in the HubSpot UI and runbooks.
- **`applied` / `ignored` counters** — INCLUDE. Required for operator
  triage ("did the receiver actually do something?"). Pure integers, no
  PII surface.
- **Timestamp** — EXCLUDE. Vercel function logs already prepend an
  ingestion timestamp. Adding our own duplicates the operator's view and
  invites drift between server clock and Vercel ingestion clock.
- **`eventTypeId`** — EXCLUDE. The applied-vs-ignored split already conveys
  this (applied → it was install or uninstall; ignored → it was something
  else). Including the raw id forces operators to memorize HubSpot's
  numeric event ids to read logs. If a future audit needs the granularity,
  add it then with explicit justification.
- **Per-event detail (`occurredAt`, `subscriptionId`, etc.)** — EXCLUDE.
  Out of scope; this is a request-level summary, not an event-level
  audit log.

The two log lines together let an operator distinguish three states in one
`grep`: no log → HubSpot didn't fire; request-arrival only → signature
failed (existing line 118 `console.warn` fires too); both lines with
`applied >= 1` → delivery applied. That's the operator-triage contract.

## 3. #16 success-page surface (binding contract for Task 4)

### DECISION: HTML success page with explicit user-initiated CTA back to HubSpot. NO automatic redirect to a HubSpot URL by default.

Rationale, citing maintainer-stated and HubSpot-doc evidence:

1. **HubSpot DOES pass `returnUrl` for marketplace install flows.**
   Correction posted 2026-05-10 (post-Wave-0 review): the original draft
   asserted HubSpot OAuth never passes `returnUrl`. That was wrong — it
   conflated the standalone OAuth Quickstart flow (which only passes
   `code`/`state`) with the marketplace "App Install Flow," which is the
   relevant flow for this product. Verified against HubSpot's official
   Developer Documentation via Context7 (`/websites/developers_hubspot`,
   trust score 10) on 2026-05-10:
   - "Example Initial Installation Request URL" —
     `https://www.myinstallserver.com/install?returnUrl=<hubspot-return>&step=authorize`
   - "Example Final Installation Request URL" —
     `https://www.myinstallserver.com/install?code=123&state=...&returnUrl=<hubspot-return>&step=finalize`
     The codebase also already documents this at
     `apps/api/src/routes/oauth.ts:261` ("HubSpot passes `returnUrl` on some
     install flows") with active 302-to-`returnUrl` handling at lines 264–267.
     Implementation MUST treat the validated `returnUrl` 302 as the primary
     path and the new `htmlSuccess` page as the fallback when `returnUrl` is
     absent or fails the `isAllowedReturnUrl(...)` guard.
2. **HubSpot has no documented canonical post-install URL** for OAuth
   apps when `returnUrl` is absent (verified). Issue #16's body suggested
   `https://app-eu1.hubspot.com/settings/{portalId}/integrations/connected-apps`
   as a fallback — that path exists but is NOT documented as the
   recommended post-install destination by HubSpot. It is also region-
   specific (`-eu1`) which would mis-route US-region installs. Therefore
   the fallback path stays the rendered `htmlSuccess` page with a manual
   CTA, NOT a guessed HubSpot URL redirect.
3. **Issue #16 explicitly asks for a polished, branded, in-app success
   page** with primary CTA and supporting copy. The maintainer's
   acceptance criteria say "success path no longer uses the generic
   `htmlError()` presentation" and "page is visually polished and
   intentional." That maps cleanly to a polished HTML page in the
   `returnUrl`-absent fallback path. The 302-to-`returnUrl` happy path
   already exists (oauth.ts:264–267) and is unchanged by this slice. The
   issue body also mentions a countdown / auto-redirect — declined for
   this slice (see "No meta-refresh tag" guarantee below); if reinstated
   later, that needs its own preflight.
4. **The existing `htmlError(...)` helper at oauth.ts:98** already
   establishes the safe HTML pattern we must mirror: server-rendered
   inline HTML, no inline scripts, no third-party assets,
   `escapeHtml(...)` for any interpolated user-supplied value (here:
   `identity.hubDomain` and `portalIdAsText`).

### Required `htmlSuccess(...)` helper surface

Task 4 introduces an `htmlSuccess(title, detail, options)` helper alongside
`htmlError`. Required guarantees:

- Server-rendered inline HTML; no client-side fetch, no inline `<script>`,
  no third-party CDN/asset/font loads. CSP-compliant by construction.
- All interpolated values pass through the existing `escapeHtml(...)` at
  oauth.ts:94. No raw `identity.hubDomain` or `portalIdAsText` may reach
  the rendered HTML unescaped.
- Status code: `200`.
- `Content-Type: text/html; charset=utf-8` (Hono's `c.html(...)` already
  sets this).
- **No meta-refresh tag.** The existing 302-to-`returnUrl` branch at
  `apps/api/src/routes/oauth.ts:264–267` already handles auto-redirect
  when HubSpot supplies a valid `returnUrl`. By the time `htmlSuccess` is
  rendered, control flow has already proven that path is unavailable
  (returnUrl absent or fails `isAllowedReturnUrl`). A meta-refresh inside
  `htmlSuccess` would be dead code — it can never fire because the 302
  beats it to the response. Task 4's job is purely to upgrade the
  fallback HTML, not to duplicate redirect logic. Do NOT add a
  meta-refresh tag in this slice. If a future requirement asks for a
  countdown UX on the no-`returnUrl` fallback, that is a separate slice
  with its own preflight.
- Primary CTA: a plain `<a href="https://app.hubspot.com/">Return to
HubSpot</a>` button-styled link. The href is the documented HubSpot
  app entry — neutral, region-agnostic, and the user's session takes
  them to the right portal landing page.
- Secondary copy: a one-line confirmation of the connected portal,
  using `escapeHtml(identity.hubDomain)` if non-empty, else
  `portalIdAsText`. Shape suggestion (final wording owned by Task 4):
  "Signal-First Account Workspace is now connected to portal
  `<escaped portal>`. You can close this tab or return to HubSpot
  to continue."

### CSP and secret-handling guarantees (per `docs/security/SECURITY.md`)

- The page MUST NOT include any inline `<script>`, `<style onload>`,
  `<iframe>`, third-party `<img>`, web fonts, or asset URLs that aren't
  same-origin or `data:`. Inline `<style>` is acceptable for layout (the
  existing `htmlError` helper has no styles; Task 4 may add a minimal
  inline `<style>` block for visual polish — that's CSP-compatible
  because it's same-document).
- The page MUST NOT echo any token, code query value, state value, or
  HubSpot client secret in any form (visible or HTML-attribute or
  comment). The only safe interpolated values are `identity.hubDomain`
  (passed through `escapeHtml`) and `portalIdAsText` (numeric).
- Logging from the success path is unchanged from the existing route
  posture. No new `console.log` is added by Task 4.

### `redirectUrls` whitelist in `app-hsmeta.json`

`apps/hubspot-project/src/app/app-hsmeta.json`'s `redirectUrls` is the
list HubSpot honors as legitimate `redirect_uri` targets for the OAuth
flow itself. Since Task 4 does not introduce a new OAuth `redirect_uri`,
**no `redirectUrls` change is required**. The existing whitelist
(covering the API origin's `/oauth/callback`) remains correct.

If a future change introduces a server-rendered redirect to a URL
outside the API origin, that new origin would need whitelisting —
explicitly document it then.

## 4. #28 reinstall semantics (binding contract for Task 5)

### LOCK: default-on logic lives in `.values({...})`, NOT in `onConflictDoUpdate.set`

Verified at `apps/api/src/routes/oauth.ts:209–227`:

```ts
const tenantInsert = await db
  .insert(tenants)
  .values({
    hubspotPortalId: portalIdAsText,
    name: identity.hubDomain || portalIdAsText,
  })
  .onConflictDoUpdate({
    target: tenants.hubspotPortalId,
    set: {
      isActive: true,
      deactivatedAt: null,
      deactivationReason: null,
      updatedAt: sql`now()`,
    },
  })
  .returning();
```

`onConflictDoUpdate.set` only fires on reinstall (existing tenant row).
Adding `settings` to `set` would CLOBBER any user-modified
`settings.enrichmentEnabled = false` set via `PUT /api/settings`. That
violates §19.2 of `docs/security/SECURITY.md` ("a non-empty value
replaces the stored value; blank/whitespace inputs preserve the existing
value") for user-set toggles, and violates the maintainer's intent in
issue #28 ("default to enabled for new installs" — reinstall is not new).

### LOCK: exact `.values({...})` shape Task 5 must add

```ts
.values({
  hubspotPortalId: portalIdAsText,
  name: identity.hubDomain || portalIdAsText,
  settings: { enrichmentEnabled: true },
})
```

The `settings: jsonb("settings").default({})` column already exists at
`packages/db/src/schema/tenants.ts:10`. **No migration is required.** Task
5's PR description must call this out explicitly and link to this
preflight section.

If a future field is added to `settings` (e.g. `notificationsEnabled`),
the merge semantics for first-install are unchanged: `.values({...})`
sets the full initial JSONB blob. Reinstall semantics remain "do not
clobber existing settings."

### LOCK: cross-tenant isolation MUST be tested explicitly

Per CLAUDE.md: tenant isolation is mandatory at every layer. Task 5's
test file MUST include a tenant-A-vs-tenant-B test:

1. First OAuth callback for tenant A → row inserted with
   `settings.enrichmentEnabled === true`.
2. Tenant A user disables enrichment via `PUT /api/settings` → row's
   `settings.enrichmentEnabled === false`.
3. First OAuth callback for tenant B (different `hubspotPortalId`) →
   tenant B row inserted with `settings.enrichmentEnabled === true`.
4. Re-read tenant A's row: `settings.enrichmentEnabled === false` —
   tenant B's install MUST NOT have leaked tenant A's value back to
   `true`.
5. Tenant A reinstall (same `hubspotPortalId`, conflict path): tenant
   A's `settings.enrichmentEnabled` MUST remain `false`. The
   `.values({...})` is ignored on conflict; `onConflictDoUpdate.set`
   does not touch `settings`.

This combines the reinstall-preserves-user-toggle and cross-tenant
isolation guarantees in one test file. Mirror the pattern in
`apps/api/src/__tests__/cross-tenant.test.ts`.

## 5. #28 UI scope

### DECISION: backend-only default. NO Settings UI changes in this slice.

Issue #28's body is silent on the Settings UI surface — it asks only
"should HubSpot enrichment default to enabled for new installs?" and
explicitly scopes itself as "a product/default-settings decision only."
Per the prompt's instruction (default to backend-only when the issue is
silent), the implementation lands the toggle default in the OAuth
callback insert and stops there.

The existing Settings UI (slice 4) at `apps/hubspot-project/src/app/settings/`
already reads `signalProviders.hubspotEnrichment.enabled` from
`GET /api/settings` and reflects whatever value the backend returns. No
UI work is required for the new tenant default to render correctly — the
toggle will appear "on" for fresh installs because the backend returns
`{ enabled: true }`, and "off" if the user has explicitly disabled it
via `PUT /api/settings`.

If a follow-up product question arises about surfacing the default-on
state more visibly (e.g., a "First-time setup" banner that calls out the
auto-enabled toggles), file a new issue. Out of scope for this slice.

## Cross-references

- `docs/slice-11-preflight-notes.md` §6 (log-safe / not-log-safe fields)
  and §7 (env-var contract — `HUBSPOT_APP_CLIENT_SECRET`,
  `INTERNAL_BOOTSTRAP_TOKEN`, never log).
- `docs/security/SECURITY.md` §1 (tenant resolution chain), §5 (data
  minimization — adapters do not log evidence), §13 (HubSpot signature
  verification — `console.warn` redaction posture mirrored by the new
  logs), §14 (server-to-HubSpot credential handling), §16 (Slice 3 OAuth
  migration — `htmlError` pattern lives here), §19 (Slice 4 settings —
  blank-input replace-only semantics that #28's reinstall guarantee
  parallels).
- `apps/api/src/routes/oauth.ts:98` — `htmlError(...)` helper that the
  new `htmlSuccess(...)` mirror must follow (no inline scripts, no
  third-party assets, `escapeHtml` for all interpolations).
- `apps/api/src/routes/oauth.ts:212` — tenant insert site for #28's
  default-on toggle (`.values({...})` block).
- `apps/api/src/routes/oauth.ts:264–267` — existing 302-to-`returnUrl`
  branch that runs BEFORE the success-page render path. #16 leaves this
  branch unchanged and only upgrades the fallback HTML.
- `packages/db/src/schema/tenants.ts:10` — `settings` JSONB column
  (already exists; no migration for #28).
- `apps/api/src/routes/lifecycle.ts:94` — handler entry (request-arrival
  log site).
- `apps/api/src/routes/lifecycle.ts:164` — `applied += 1` (portalIds
  collection site).
- `apps/api/src/routes/lifecycle.ts:165` — for-loop close (summary log
  site is between this and the `return c.json(...)` at line 167).
- The plan: `.claude/tasks/2026-05-10-mvp-deployment-readiness.md`
  (Wave 0 produces this doc; Waves A–E consume it).
