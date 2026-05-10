# Test Portal Seed Plan — V1 MVP Validation

This is the canonical reference for how the V1 HubSpot test portal is seeded
to validate the eight QA states the `crm.record.tab` extension must render.
For the operator-facing run procedure, see the per-slice walkthroughs:

- `docs/qa/slice-2-walkthrough.md` (Slice 2 live integration)
- `docs/qa/slice-5-pilot-walkthrough.md` (Slice 5 pilot smoke)

## Why this exists

The CLAUDE.md root rule:

> Use a separate HubSpot developer or configurable test account for the first
> real validation. Populate it with mock CRM company/contact data before
> claiming the extension works end-to-end. Include at least one target account
> using `hs_is_target_account` and records that exercise strong-evidence,
> fewer-than-3-contacts, empty, stale, degraded, and ineligible states.

This plan operationalizes that rule: a single `pnpm seed:test-portal` run
materializes one company plus 0–3 contacts per QA state in the configured
test portal, idempotently, with no fabricated evidence.

## Dataset (eight states, eight companies)

Source of truth: `buildSeedTargets()` in
`scripts/seed-hubspot-test-portal.ts`. Property shapes intentionally mirror
the in-memory fixtures in `packages/config/src/factories.ts` so the rendered
state-semantics match the unit-test fixture semantics 1:1.

| QA State        | Company Name (idempotency key)   | Domain                       | `hs_is_target_account` | Contacts | Expected card render                                           |
| --------------- | -------------------------------- | ---------------------------- | ---------------------- | -------- | -------------------------------------------------------------- |
| eligible-strong | `Slice2-EligibleStrong-AcmeCorp` | `slice2-acme.example.com`    | `true`                 | 3        | Reason-to-contact + 3 people cards + full evidence drill-in    |
| fewer-contacts  | `Slice2-FewerContacts-BetaInc`   | `slice2-beta.example.com`    | `true`                 | 1        | Reason-to-contact + 1 person + explicit "fewer contacts" note  |
| empty           | `Slice2-Empty-GammaCo`           | `slice2-gamma.example.com`   | `true`                 | 0        | "No credible reason to contact this account now" empty state   |
| stale           | `Slice2-Stale-DeltaLLC`          | `slice2-delta.example.com`   | `true`                 | 1        | Stale-warning alert; reason rendered but annotated stale       |
| degraded        | `Slice2-Degraded-EpsilonGmbH`    | `slice2-epsilon.example.com` | `true`                 | 1        | Degraded-source badge; partial evidence allowed                |
| low-confidence  | `Slice2-LowConfidence-ZetaSA`    | `slice2-zeta.example.com`    | `true`                 | 1        | Caution alert + confidence score in trust breakdown            |
| ineligible      | `Slice2-Ineligible-EtaPLC`       | `slice2-eta.example.com`     | `false`                | 1        | "Not a target account" suppression — reason NOT rendered       |
| restricted      | `Slice2-Restricted-ThetaInc`     | `slice2-theta.example.com`   | `true`                 | 1        | Empty-with-zero-leakage — NO evidence text, NO reason rendered |

Idempotency marker: every company name starts with `Slice2-`. The seed
searches `name CONTAINS_TOKEN "Slice2*"` on rerun and updates rather than
duplicates. Contacts are deduplicated by email (HubSpot enforces email
uniqueness server-side).

### What the dataset deliberately does NOT do

- **No evidence is written.** The seed touches only Companies and Contacts.
  Evidence rows live in app Postgres and are produced by adapters
  (`apps/api/src/adapters/signal/`) at runtime. The seed never calls Exa,
  Firecrawl, or any LLM.
- **No custom company/contact properties are created.** Idempotency uses the
  standard `name` property prefix so the dev token does not need
  `crm.schemas.companies.write`.
- **No filler people.** When a state expects 0 or 1 contact, the seed never
  pads to 3 — fabricated contacts would violate the V1 wedge rule.
- **No tenant or LLM config seeding.** Those are tenant-isolated and come
  from the OAuth install flow + per-tenant settings UI.

## Seeding surface

The seed talks directly to the HubSpot CRM v3/v4 REST API via the existing
`HubSpotClient` (`apps/api/src/lib/hubspot-client.ts`). Auth resolves a
per-tenant OAuth token from the local `tenant_hubspot_oauth` table:

1. Operator runs `hs auth` (or completes the in-app OAuth install flow)
   against the test portal so a tenant row exists.
2. Operator runs `pnpm seed:test-portal --portal <portalId>`.
3. The script reads `tenants` by `hubspotPortalId`, instantiates a tenant-
   bound client, and issues calls to `companies/search`, `companies`,
   `contacts`, and `associations/default/contacts/{id}`.

The script is a no-op without `--portal` / `HUBSPOT_TEST_PORTAL_ID` unless
`--dry-run` is passed; dry-run mode runs entirely offline (no DB, no HTTP)
and just prints the planned operations.

## How to run

### Prerequisites

- Test portal installed via the dev OAuth callback (a row exists in
  `tenants` with the matching `hubspot_portal_id`).
- `DATABASE_URL` exported in your shell so the script can resolve the
  per-tenant token. The seed script reads `process.env` directly and does
  NOT load `.env` files automatically. Either:
  - export the variables in your shell:
    `export DATABASE_URL=...` (and any other vars), or
  - prefix the command with a dotenv loader, e.g.:
    `pnpm dlx dotenv-cli -e .env -- pnpm seed:test-portal --portal <id>`.
- `pnpm install` has been run at the repo root.

### Commands

```bash
# 1. Verify the plan offline (no token, no DB, no HTTP).
pnpm seed:test-portal:dry

# 2. Authenticate the HubSpot CLI against the test portal.
hs auth
hs accounts list   # confirm the test portal id is listed

# 3. Run the live seed (idempotent).
pnpm seed:test-portal --portal <testPortalId>
# or, with HUBSPOT_TEST_PORTAL_ID set in .env:
pnpm seed:test-portal
```

The dry-run prints eight `[seed] create ...` lines. The live run prints a
pipe-delimited `| QA State | Company Name | Company ID | Contact IDs |`
table that you paste into `docs/qa/slice-2-walkthrough.md` for the
per-state checklist.

### Re-running

Safe. Re-run flips every row from `create` to `update` (matched by name).
Contacts dedupe by email server-side. To force a clean reset, archive the
eight `Slice2-*` companies in the HubSpot UI first.

## Tests

Pure helpers (`buildSeedTargets`, `buildSeedPlan`, `executeSeedPlan`,
`parseArgs`, `runSeed`) are covered by
`scripts/__tests__/seed-hubspot-test-portal.test.ts`. The tests stub the
`SeedHubSpotClient` interface — no network calls during `pnpm test`.

Run:

```bash
pnpm test scripts/__tests__/seed-hubspot-test-portal.test.ts
```

Acceptance asserts in the suite:

- exactly 8 targets, one per QA state (covers the CLAUDE.md rule)
- every name carries the `Slice2-` idempotency prefix
- ineligible target sets `hs_is_target_account=false`
- empty target has zero contacts, eligible-strong has three
- `buildSeedPlan` flips rows to `update` when the marker search returns them
- `executeSeedPlan` does not call `createCompany` on the update path
- `runSeed --dry-run` constructs no client and tolerates a missing token
- `runSeed` without `--portal` and without `--dry-run` throws clearly
