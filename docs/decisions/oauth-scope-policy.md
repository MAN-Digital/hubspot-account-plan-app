# Decision: OAuth scope policy — read-only vs. seed-write

**Status**: Proposed (awaiting product sign-off)
**Decision needed by**: before Wave D operator walkthrough (#37) ships, or sooner if anyone tries `pnpm seed:test-portal` against a live portal
**Tracking**: [#38](https://github.com/MAN-Digital/hubspot-account-plan-app/issues/38)
**Recommendation**: **Path C (Private App token for the seed script)**, with Path A as the cheap fallback if engineering time is the bottleneck

## TL;DR

The marketplace listing is the decision driver. The production app is `"distribution": "marketplace"`, which means any scope change requires HubSpot to re-review the app — that's days-to-weeks of latency and a real risk that a reviewer questions why a "signal-first read-only" product wants write access. That removes Path B from the table as a near-term option.

Of the two remaining paths:

- **Path A** (manual data entry, abandon the seed) is free-today but throws away PR #32 and adds ~1h of clicking before every walkthrough.
- **Path C** (Private App token, decouple the seed from the user-facing OAuth grant) is 3–4 hours of work and keeps the seed as a durable QA tool with the production app's read-only posture intact.

Path C wins on total cost across all future walkthroughs. Path A only wins if there will be exactly one walkthrough.

## The problem in one sentence

`scripts/seed-hubspot-test-portal.ts` (wired in PR #32) reads the per-tenant OAuth token from `tenant_hubspot_oauth`, then calls `POST /crm/v3/objects/companies`. That token was issued under read-only scopes, so HubSpot returns `403 Forbidden` on the first write.

## Constraints worth naming upfront

These are the facts that pin down the option space:

1. **Marketplace distribution**: `apps/hubspot-project/src/app/app-hsmeta.json` declares `"distribution": "marketplace"`. Per HubSpot's [App Marketplace policy](https://developers.hubspot.com/docs/apps/marketplace/get-started/create-marketplace-app), scope changes on a listed app trigger re-review.
2. **Existing OAuth grants are scope-locked**: HubSpot's OAuth flow does not retroactively grant new scopes to existing access tokens. Even after a scope change is approved, every installed tenant must re-grant via reinstall before the new scopes apply to their token.
3. **Product wedge is "read-only signal-first"**: The CLAUDE.md product brief explicitly frames the app as read-only. Asking for write scopes changes the trust posture users see at install time — the install consent screen will list "Read and write companies" instead of "Read companies".
4. **The seed script's auth surface is already tested via injection**: `runSeed()` accepts a `clientFactory` (see [scripts/seed-hubspot-test-portal.ts:426-428](../../scripts/seed-hubspot-test-portal.ts)). The tests already substitute a mock. Path C can use the same seam.
5. **HubSpotClient is OAuth-coupled**: [apps/api/src/lib/hubspot-client.ts](../../apps/api/src/lib/hubspot-client.ts) takes `{ tenantId, db }` and decrypts an OAuth token from `tenant_hubspot_oauth`. There is no "use this static Bearer token" entry point today.
6. **The seed only needs 6 HubSpot methods**: `searchCompaniesByMarker`, `createCompany`, `updateCompany`, `createContact`, `findContactByEmail`, `associateContactWithCompany`. The `SeedHubSpotClient` interface in the seed file already names them.

## The three paths

### Path A — keep the app read-only, abandon the seed script

Accept that `pnpm seed:test-portal` is unusable against the production OAuth grant. For the Slice-2 walkthrough (8 QA states × ~17 records), manually create companies and contacts in the HubSpot UI using the dataset in [docs/qa/test-portal-seed-plan.md](../qa/test-portal-seed-plan.md). PR #32's seed code becomes documentation (and its test suite still validates the dataset shape).

| Aspect                          | Detail                                                                               |
| ------------------------------- | ------------------------------------------------------------------------------------ |
| Eng effort today                | 0 (or ~30 min to add `pnpm seed:test-portal:print` flag for paste-into-UI checklist) |
| Operator effort per walkthrough | ~1h of clicking                                                                      |
| Scope footprint                 | unchanged — pure read-only                                                           |
| Marketplace impact              | none                                                                                 |
| Reuse value                     | low — every walkthrough repeats the manual work                                      |
| Reversibility                   | high — Path C can be added later                                                     |

**When this wins**: if Wave D is a one-shot acceptance gate and Slice 5 + future walkthroughs would never use a seed.

### Path B — add `crm.objects.{companies,contacts}.write` to required scopes

Edit `app-hsmeta.json`, re-upload via `pnpm hs:project upload`, and resubmit the marketplace listing for re-review. Once approved, ask every installed tenant to reinstall.

| Aspect                          | Detail                                                                                                                        |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Eng effort today                | ~30 min (config + upload)                                                                                                     |
| Operator effort per walkthrough | 0                                                                                                                             |
| Scope footprint                 | expanded — install consent now shows "Read and write companies/contacts"                                                      |
| Marketplace impact              | **re-review required**, days-to-weeks of latency, real risk of reviewer pushback on a "signal-first" product asking for write |
| Existing installs               | broken until each tenant reinstalls                                                                                           |
| Trust posture change            | "read-only signal" → "we can edit your CRM"                                                                                   |
| Reversibility                   | low once shipped — going from write-back-to-read in a listed app is also a re-review                                          |

**When this wins**: only if there is a separate near-term product reason to write to HubSpot (e.g., enrichment writing properties back) that justifies the consent change on its own merits. Doing this purely to make the test-portal seed work is the wrong trade.

### Path C — separate seed mechanism via HubSpot Private App access token

Refactor `scripts/seed-hubspot-test-portal.ts` to support two auth modes:

1. If `HUBSPOT_PRIVATE_APP_TOKEN` env var set → use it via a new `PrivateAppSeedClient` that calls the same HubSpot REST API with the Private App's Bearer token.
2. Else fall back to the current OAuth-token-from-DB path (so the existing test mocks still work, and a future Path B world still works).

Operator workflow:

- One-time per test portal: in the HubSpot portal, create a Private App with `crm.objects.companies.write` + `crm.objects.contacts.write` + matching read scopes. Copy the access token.
- Add `HUBSPOT_PRIVATE_APP_TOKEN=<token>` to local `.env` (one line per portal if you switch between them).
- Run `pnpm seed:test-portal --portal <id>` as documented.

| Aspect                          | Detail                                                                                               |
| ------------------------------- | ---------------------------------------------------------------------------------------------------- |
| Eng effort today                | 3–4h (new client class, env wiring, tests, doc update)                                               |
| Operator effort per walkthrough | 0 (after one-time Private App setup, ~5 min per portal)                                              |
| Scope footprint                 | production app unchanged — Private Apps are per-portal, granted by the portal admin manually         |
| Marketplace impact              | none                                                                                                 |
| Existing installs               | unaffected                                                                                           |
| Trust posture change            | none for end users — Private Apps live in the portal admin's UI, not in the marketplace consent flow |
| Reusable for                    | Slice 2 walkthrough, Slice 5 pilot, any future QA seed (incl. multi-portal test matrix)              |
| Reversibility                   | high — if a future product feature legitimately needs write, Path B can be layered on top            |

**When this wins**: every scenario except "we will literally never run the seed again". Even if Wave D is the only acceptance gate today, the seed will likely come back for Slice 5 pilot and any future regression sweep.

## Why Path B is not the right answer (extended)

Three independent reasons:

1. **Marketplace re-review is a critical-path block**. We don't control the review timeline. Wave D would either wait (slipping slice-12 acceptance further) or re-review in parallel and risk reviewer pushback that ratchets up the back-and-forth.
2. **Asking for write scopes purely to enable an internal seed script is a category error.** Scopes are user-facing trust surface; the seed is an engineering testing tool. Mixing the two pushes complexity onto the wrong audience.
3. **Once you have write scopes, they're hard to remove from a marketplace-listed app.** Scope reduction is also a re-review event, and HubSpot's marketplace listings show historical scope sets to potential installers. We'd be locking in a worse trust posture for marginal test convenience.

The only case where Path B is correct is when **a product feature already wants write capability** (e.g., enrichment writing properties back to HubSpot). At that point, the seed-script convenience comes along for the ride. Until then, Path B is paying a real cost for a synthetic benefit.

## What Path C looks like concretely

Minimum viable refactor of `scripts/seed-hubspot-test-portal.ts`:

```ts
// New: scripts/seed-hubspot-private-app-client.ts
// Implements SeedHubSpotClient using fetch + Bearer Private App token.
// ~150 lines, mirrors the 6 methods on the interface.

// Edit: scripts/seed-hubspot-test-portal.ts (around line 425-445)
let client: SeedHubSpotClient;
if (deps.clientFactory) {
  client = deps.clientFactory();
} else if (env.HUBSPOT_PRIVATE_APP_TOKEN) {
  // Path C — recommended for operator workflows.
  client = new PrivateAppSeedClient({
    token: env.HUBSPOT_PRIVATE_APP_TOKEN,
  });
} else {
  // Fallback — only works if/when Path B is also adopted in some future world.
  // ... existing OAuth-token-from-DB path ...
}
```

Documentation deltas:

- `docs/qa/test-portal-seed-plan.md`: add a "Private App setup" subsection (5-step recipe) under "Prerequisites".
- `.env.example` (if it exists): add a commented `HUBSPOT_PRIVATE_APP_TOKEN=` line.
- Existing `docs/qa/slice-2-walkthrough.md`: no change — the seed output table format stays the same.

Test deltas:

- `scripts/__tests__/seed-hubspot-test-portal.test.ts`: add a test that when `env.HUBSPOT_PRIVATE_APP_TOKEN` is set, the script constructs the Private App client (asserted by injected factory). Existing tests stay green because they use `clientFactory` injection directly.
- New unit tests for `PrivateAppSeedClient` against `vi.fn()` `global.fetch`.

Acceptance for the Path C work:

- [ ] `pnpm seed:test-portal --dry-run` still passes (no token needed)
- [ ] `pnpm seed:test-portal --portal <id>` with `HUBSPOT_PRIVATE_APP_TOKEN` set seeds 8 companies + correct contact counts
- [ ] Rerun against the same portal flips create→update (idempotency intact)
- [ ] Unit tests pass; no real HubSpot calls in `pnpm test`

## Recommendation

**Adopt Path C now.**

Reasoning:

- 3–4h of engineering is cheap relative to (a) the marketplace risk of Path B and (b) the per-walkthrough manual-entry cost of Path A across every future walkthrough.
- The existing seed code, its dataset, its test suite, and its idempotency design are all preserved.
- The production app keeps its clean read-only posture, which matches the documented product wedge.
- Reversible — a future Path B (real product need for write) can be layered on top without removing the Private App path.

**If 3–4h is too much engineering time right now**, fall back to Path A with one polish: add a `pnpm seed:test-portal:print` mode that emits the planned dataset as a Markdown checklist suitable for paste-into-HubSpot-UI. That keeps Wave D unblocked today while preserving the option to do Path C later when the seed is needed more often.

**Do not adopt Path B** unless and until a separate product feature actually justifies write scopes on its own merits.

## What happens after the decision lands

- Path C: open an issue/task to implement the refactor; estimate 3–4h; close #38 when the refactor merges and is documented.
- Path A (fallback): close #38 with a comment saying "deferred to Path C when needed; using manual UI entry for Slice 2 + 5". Add the `:print` flag if Wave D operators ask for it.
- Path B: would require a parallel issue to schedule marketplace re-review and a comms plan for existing tenants. Don't start this without explicit product sign-off.
