# Changelog

All notable changes to the HubSpot Signal-First Account Workspace are documented
here. Entries are derived from merged pull requests. Format loosely follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/); the project is not yet
versioned with git tags, so everything to date sits under the pending MVP release.

## [0.1.0-mvp] - Unreleased

The MVP V1 wedge: a HubSpot `crm.record.tab` extension that surfaces one credible
reason to contact an account now plus up to 3 people, backed by inspectable
evidence with trust/freshness/confidence constraints and strict tenant isolation.

### Core product (Slices 1–11)

- Core domain: schema, services, and extension UI covering all 8 QA states
  (eligible-strong, fewer-contacts, empty, stale, degraded, low-confidence,
  ineligible, restricted) (#1).
- Live integrations: real auth, evidence drill-in, and next-move surface (#2).
- Slice 3: OAuth public app, real LLM adapters, and removal of mock fallbacks
  (#3); RLS, replay-nonce protection, bundling, and enrichment (#4).
- Slice 4: tenant settings and configuration UX (#5).
- Slice 5: production and marketplace readiness (#6).
- Slice 6: install lifecycle and tenant offboarding (#7).
- Slice 7: HubSpot app-lifecycle webhook receiver (#10); lifecycle subscription
  bootstrap (#15).
- Slice 8: resolve extension API origin from build profile (#9).
- Slice 9: profile-aware extension build wrapper (#14).
- Slice 10: wire profile `API_ORIGIN` into the HubSpot upload pipeline (#11).

### Settings & configuration

- Settings UX polish, surface redesign, and provider connection testing (#20).
- Guard against legacy news-provider response drift (#23).
- Normalize blank LLM endpoint URL on read (#29).

### Install & lifecycle

- Polish install success page with `htmlSuccess` helper (#34, closes #16).
- Default enrichment to on for new tenants (#35, closes #28).
- Emit lifecycle request-arrival and applied/ignored logs (#33, closes #19).

### Operations & deployment

- Restore app-root Vercel build path for the API runtime (#21).
- Restore Vercel API production deploy path (#22).
- Ignore local Vercel link directory (#25); exclude local artifacts from Vercel
  uploads (#27).
- Honor forwarded protocol for HubSpot signatures (#26, closes #24).
- Pre-build workspace packages before app builds (#36).
- Keep-alive cron + reconnected Vercel git integration (#46, closes #41, #39);
  direct handler mount hotfix so the keep-alive route resolves in prod (#48).

### Test tooling & QA

- Wire `seed:test-portal` scripts and publish the seed plan (#32).
- Private App token path for the test-portal seed — Path C of the OAuth scope
  decision (#47, closes #38).
- Wave D operator walkthrough runbook (#50, #37 prep).

### Documentation & planning

- Lock MVP-readiness decisions for Slice 12 (#30).
- MVP deployment readiness plan for Slice 12 (#31).
- Taskmaster + `PLANNING_INDEX` reconciliation with slice PR state (#12, #13).
