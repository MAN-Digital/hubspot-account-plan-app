# HubSpot Project Upload Workflow

## Quick reference

```bash
pnpm tsx scripts/hs-project-upload.ts --profile local
```

That script copies `apps/hubspot-project/` to a temporary directory outside any git worktree, then runs `hs project upload` from there.
An explicit HubSpot config profile is required.

## Why this indirection

The HubSpot CLI's project uploader (`@hubspot/cli` 8.4.0) cannot reliably upload from inside a git worktree (`.worktrees/<branch>/`). The bundler reports `The file /app/cards/<entry>.tsx was not found` even when the file is on disk and `hs project validate` passes. The same files upload + build + deploy successfully when copied to a clean temporary directory outside the worktree.

This appears to be a worktree-context issue in the CLI's git-aware file walker, not a misconfiguration on our side. Reproduced consistently:

| Source dir                                 | Outcome                                          |
| ------------------------------------------ | ------------------------------------------------ |
| `.worktrees/slice-2/apps/hubspot-project/` | upload succeeds; build FAILS (`*.tsx not found`) |
| `/tmp/<copy>/` (no git)                    | build + deploy succeed                           |
| `/tmp/<copy>/` (with `git init`)           | build + deploy succeed                           |

The wrapper script removes the worktree variable from the equation.

## Local development

For active card development with hot reload, use:

```bash
cp apps/hubspot-project/local.json.example apps/hubspot-project/local.json
cd apps/hubspot-project
CLIENT_SECRET="$HUBSPOT_CLIENT_SECRET" hs project dev --profile local
```

`hs project dev` does NOT use the same upload-and-build pipeline as `hs project upload` and works fine from inside the worktree.
The `local.json` proxy is required because HubSpot's `hubspot.fetch()` URLs
must stay HTTPS and cannot target `localhost` directly. The proxy remaps the
local profile's `API_ORIGIN` to `http://localhost:3001` only for local
development.

## Config profiles

Slice 5 standardizes HubSpot app configuration through config profiles instead
of hardcoded environment-specific JSON.

Committed templates:

- `apps/hubspot-project/hsprofile.local.example.json`
- `apps/hubspot-project/hsprofile.staging.example.json`
- `apps/hubspot-project/hsprofile.production.example.json`
- `apps/hubspot-project/local.json.example`

Create real local profile files by copying the templates and removing the
`.example` suffix. Real `hsprofile.*.json` files are gitignored because they
contain account IDs and environment-specific values.

The app config now expects these profile variables:

- `OAUTH_REDIRECT_URI`
- `API_ORIGIN`

Example flows:

```bash
cp apps/hubspot-project/hsprofile.local.example.json apps/hubspot-project/hsprofile.local.json
cp apps/hubspot-project/local.json.example apps/hubspot-project/local.json
pnpm tsx scripts/hs-project-upload.ts --profile local
```

```bash
cp apps/hubspot-project/hsprofile.staging.example.json apps/hubspot-project/hsprofile.staging.json
pnpm tsx scripts/hs-project-upload.ts --profile staging
```

## Manual fallback

If the wrapper script breaks, copy and run by hand:

```bash
TMP=$(mktemp -d)
rsync -a --exclude node_modules --exclude '.git*' apps/hubspot-project/ "$TMP/"
cd "$TMP" && hs project upload --profile staging
```

## Slice 3 follow-up

`@todo Slice 3` — file an issue against `@hubspot/cli` reproducing the worktree upload failure with a minimal repro, and remove this indirection if/when the CLI handles worktrees correctly.

## CLI version status (upgraded 2026-07-03)

The global CLI was upgraded 5.1.3 → **8.9.1** (`npm i -g @hubspot/cli@latest`;
the workflow above was originally diagnosed against 8.4.0). Verified on 8.9.1:

- `hs account list` — auth config (`~/.hscli/config.yml`) survived the upgrade.
- `hs project validate --profile local` — **profiles must live under `src/`**;
  a root-level-only `hsprofile.<name>.json` still fails with "Failed to load
  profile". The `mirrorProfileIntoSrc` workaround in
  `scripts/hs-project-upload.ts` is therefore still required on 8.9.1. For
  CLI-direct commands (`validate`, `dev`), keep a copy of the real profile at
  `src/hsprofile.<name>.json` (gitignored) alongside the root-level canonical
  one.
- With the profile in `src/`, validation passes: "Project hap-signal-workspace
  is valid and ready to upload".

Still untested on 8.9.1: the worktree upload bug. On the next real upload, try
`hs project upload --profile local` directly from
`.worktrees/<branch>/apps/hubspot-project/`. If the build no longer reports
`*.tsx not found`, the temp-dir wrapper indirection in
`scripts/hs-project-upload.ts` can be removed (see the Slice 3 follow-up).

## Current Slice 5 production contract

The app is already on the OAuth marketplace model. The remaining production
readiness contract is:

- `app-hsmeta.json` uses profile variables instead of a hardcoded localhost redirect
- the selected HubSpot profile supplies `OAUTH_REDIRECT_URI` and `API_ORIGIN`
- staging/production installs must use HTTPS callback URLs
- the API-side `HUBSPOT_OAUTH_REDIRECT_URI` must match the active deployed origin

Slice 10 closes the extension side of that contract: `hs-project-upload.ts`
now threads the selected profile's `variables.API_ORIGIN` into the
programmatic bundler (`scripts/bundle-hubspot-card.ts`) via
`process.env.API_ORIGIN`. The bundler's `define` block embeds
`__HAP_API_ORIGIN__` into both the card and settings bundles, so deployed
extensions call the origin declared in `hsprofile.<name>.json` instead of
the hardcoded default.

Two profile-aware build paths now exist:

- `apps/hubspot-extension` → `pnpm build:with-profile --profile <name>` —
  single-bundle wrapper for local dev ergonomics.
- `scripts/hs-project-upload.ts --profile <name>` — production two-bundle
  path that actually ships to HubSpot.

Both read the same `hsprofile.<name>.json` and share the same
`__HAP_API_ORIGIN__` substitution contract. A profile that is missing
`variables.API_ORIGIN` causes the upload wrapper to exit non-zero before
any bundling or `hs project upload` subprocess runs.

See also:

- `docs/slice-5-preflight-notes.md`
- `docs/security/SECURITY.md`
