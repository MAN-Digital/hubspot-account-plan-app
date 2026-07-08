# Pricing & Packaging — Credits Model (source of truth, mirrors ChatPRD doc)

**ChatPRD doc:** `0b2aae63-a4de-4ebe-bf13-41124843cf2b`

**ChatPRD sync markers:**
- `ChatPRD sync addendum — round 11 overview/data gaps/ad hoc credits — 2026-07-07`
- `ChatPRD sync correction — round 11 single executive summary and This Outreach — 2026-07-07`
- `ChatPRD sync addendum — round 13 configurable generation and HubSpot signals — 2026-07-07`
- `ChatPRD sync addendum — round 14 settings interactions and API-backed admin UX — 2026-07-08`
- `ChatPRD sync addendum — round 16 Apollo/Harvest prospecting filters — 2026-07-08`
- `ChatPRD sync correction — round 17 signal cleanup and angle rebuild credits — 2026-07-08`

**Researched 2026-07-07** (official vendor pages; re-verify quarterly — LLM/vendor
rates move fast). Full research brief in session history; key numbers below.

## Supply models

- **Managed keys** (we own Exa/Trigify/LLM keys; Apollo ONLY after signing Apollo's
  official API Reseller Agreement — see risks) — customer consumes credits.
- **BYO keys** (current architecture) — tenant's own keys; credits still metered for
  visibility/limits. Customer ALWAYS brings their own Woodpecker key (deliverability
  stays under their identity).

## Tiers

| Tier       | Price           | Credits            | Keys                      | Notes                                                                                                                    |
| ---------- | --------------- | ------------------ | ------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Free trial | $0              | **100 credits**    | managed                   | Enough for several light account workspaces or one heavier prospecting/outreach workspace when the rep selects only needed modules; output-based debit prevents wasting credits on empty results |
| Pro        | **from $99/mo** | **500 credits/mo** | managed except Woodpecker | Launch allowance is provisional: ~4–6 actively worked new accounts/mo plus light monitoring if monitors stay in-pool; usage logs set the GA number |
| Enterprise | custom          | custom             | BYO everything            | + custom cards/views + optional full-service (we run signals+outreach, train team) — retainer                            |

## Credit price table (config-driven, 1 credit ≈ $0.02 retail; Clay-style: don't hide COGS variance in one flat credit)

| Action                                                                                 | COGS est.                | Credits |
| -------------------------------------------------------------------------------------- | ------------------------ | ------- |
| Account research run (Exa + LLM synthesis)                                             | low; Exa search/content + small LLM | 1-2     |
| Buying-group generation/regenerate                                                     | ~$0.03                   | 1       |
| Outreach cadence gen (5 touches + QA)                                                  | ~$0.09                   | 8       |
| People prospecting / accepted usable contact (Apollo search/enrichment + Harvest LinkedIn lead/evidence where enabled) | $0.02-0.16 (PROVISIONAL) | 4       |
| Trigify monitor (recurring, per account/mo)                                            | ~$0.20–0.40/mo           | 18/mo   |
| Standalone deep-research dossier                                                       | ~$0.15                   | 10      |
| Overage: top-ups at ~30% premium (Clay pattern); rollover: generous (up to 2x monthly) |
| — deliberately friendlier than Apollo's no-rollover recurring add-ons.                 |

**CONFIRMED (Romeo, round 8, 2026-07-07):** Pro = 500 credits/mo **plus top-up
purchases**; top-up credits never expire. Settings UI (Plan & Billing) shows the
balance with a working **Buy Top-Up Credits** action.

**CONFIRMED (Romeo, round 14, 2026-07-08):** Free trial starts with **100 credits**. The
**Buy Top-Up Credits** action must open package selection and create a billing checkout
session through our billing API; it must not be a dead button. Ledger credits are granted
only after verified payment status. HubSpot Marketplace is the distribution/install
surface, not the billing processor for these credits.

## Per-contact pricing logic (round 8 — the "Manage by app" contact math)

Contact-based actions are charged **per accepted usable contact**, not per broad preview
run, because vendor COGS and product value scale with usable contacts:

- **People prospecting/enrichment**: `credits = accepted_usable_contacts × 4` — the UI
  shows max contacts and projected credit range BEFORE the run and asks confirm above a
  config-driven threshold (default 10 contacts). Apollo People Search preview does not
  return email/phone and does not consume Apollo credits; Apollo People/Bulk Enrichment is
  the explicit shortlisted-contact reveal step. HarvestAPI can add LinkedIn lead-search
  candidates and LinkedIn profile/post evidence, but it is not treated as a silent CRM
  write or a replacement source of truth.
- **Buying-group generation** (3 credits flat) covers up to a config cap of candidate
  contacts read from HubSpot (default 25); beyond the cap the UI proposes narrowing or
  confirms the extra per-contact enrichment cost.
- **Outreach cadence** (8 credits) is per PERSON in the cadence — 3 stakeholders =
  3 cadences = 24 credits; the Outreach tab shows the total before Generate.
- **Campaign angle change after drafts exist** uses the same per-person outreach cadence
  generation price because it regenerates copy and QA. Formula:
  `included_people x 8 credits` by the current table. Selecting the current angle costs
  0 and must not trigger a rebuild.
- Warm-intro scoring rides on research credits (no separate per-connection charge).
  All multipliers/caps/thresholds live in the config-driven credit table (per-tenant
  overridable on Enterprise), never hardcoded in UI.

## Rep-initiated account generation (round 11, revised round 13)

The primary usage journey is now **ad hoc from a company record**, not only a superadmin
preselecting target accounts in settings or workflows. A rep with app access opens
**Build this account workspace**, chooses exactly which modules to run, and proceeds only
when tenant credits and that rep's configured daily, weekly, and monthly caps allow it.

Every credit-metered CTA must show, before the run:

- projected action cost or range;
- current rep's used / cap / remaining daily, weekly, and monthly credits where caps are
  configured;
- tenant pool remaining;
- whether any provider/setup blocker prevents the run.

**Round 13 credit rule:** clicking generate never debits by itself. Debits occur only when
useful output is returned/saved:

- HubSpot-source reads, existing HubSpot contacts, and direct HubSpot property fixes: **0
  credits**.
- HubSpot Recent Intent Signals (`hs_recent_intent_signals`) reads: **0 credits** when
  HubSpot is already tracking the company; if tracking is off, the UI shows a
  tracking-required state rather than spending app credits.
- Custom HubSpot signal rules from fetched properties, lists, behavioral events, or
  record-created events also remain **0 credits** because they use CRM-owned data.
- Account research: low-cost Context output (1-2 credits by default) when saved.
- Buying-group mapping/regenerate: low cost (1 credit by default; 0.5 only if fractional
  credits are later supported).
- People prospecting/enrichment: per accepted returned usable contact, not per search or
  preview click. Apollo is the structured people-search/enrichment path; HarvestAPI is the
  LinkedIn lead-search/evidence path.
- Outreach: per generated stakeholder draft/cadence.
- Trigify signal monitoring/fetching: separate from account research because it is the
  recurring spend driver.

The first-run account-workspace estimate is displayed as an itemized, selectable preview.
Default example:

| Component                              | Credits |
| -------------------------------------- | ------- |
| Account research run                   | 1-2     |
| Buying-group mapping/regenerate        | 1       |
| People prospecting/enrichment (up to 5 accepted contacts) | 0-20 |
| Outreach draft for 3 stakeholders      | 24      |
| Optional company + 2 person monitors   | 54/mo   |
| **One-time subtotal without monitors** | **2-47** |
| **First-month total with monitors**    | **56-101** |

The app records every debit and blocked attempt with the acting HubSpot user, company or
contact target, action type, projected credits, debited credits, and result. Superadmins
set per-rep caps in Team & access; reps see their own remaining budget in the workspace
where the action happens.

## LLM default (managed tier) — IMPORTANT correction

Gemini "Flash" is NO LONGER the budget tier (3.5 Flash = $1.50/$9.00 per 1M — repriced
2026). Cheapest-still-good for prose: **GPT-5-mini** (~~$0.010/job) ≈ **Gemini 3.1
Flash-Lite** (~$0.008/job); quality fallback **Claude Haiku 4.5** (~~$0.03/job).
Job basis: ~15k in + 3k out. Sonnet 5 rises to $3/$15 on 2026-09-01. BYO tenants pick
anything. Provider cost table = config, refreshed quarterly.

## Billing rails

HubSpot Marketplace: NO listing fee, NO rev share; apps run their own billing →
**Stripe subscriptions**, portal identified via OAuth, credits gated server-side.

## Vendor cost anchors (official, 2026-07-07)

- Apollo: $49–149/seat/mo; ~$25/1k extra credits; enrichment 1–8 credits/contact.
- HarvestAPI: LinkedIn lead/profile/post endpoints are plan/vendor-metered; verify live
  unit costs before GA and keep provider-cost table config-driven.
- Trigify: Starter $40/mo (4k credits) / Max $199/mo (40k) / $0.012 overage;
  per-action: person enrich 4, company enrich 10, post 1, copywriter 5.
- Exa: search $7/1k, deep $12/1k, contents $1/1k pages, monitors $15/1k, 20k free/mo.

## RISKS (ranked)

1. **HIGH — Apollo ToS forbids the naive managed model** (no embedding, no third-party
   access via our credentials). Official path: Apollo **API Reseller Program**
   (negotiated, ~1 week). DO NOT ship managed-Apollo without the agreement. BYO-Apollo
   is compliant today.
2. **MED-HIGH — Trigify redistribution terms unverified** — contact Trigify before
   committing managed-tier signal pricing.
3. **MED — Apollo per-contact credit cost varies (1–8)** — re-verify via live API tests.
4. **MED — LLM prices move quarterly** — config-driven cost table, quarterly refresh.
5. **LOW-MED — Exa ToS redistribution** not pulled (target market = AI apps; verify).

## Open decision

Show underlying API sources on managed tier — **recommendation: YES always**
(consistent with verify-everything trust principle; provenance already names sources).
