# Pricing & Packaging — Credits Model (source of truth, mirrors ChatPRD doc)

**ChatPRD doc:** `0b2aae63-a4de-4ebe-bf13-41124843cf2b`

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
| Free trial | $0              | **30 credits**     | managed                   | ≈ 1 full account cycle (research 12 + buying group 3 + cadence 8 + 2 enrichments 8); COGS ~$0.40 — cheap conversion cost |
| Pro        | **from $99/mo** | **500 credits/mo** | managed except Woodpecker | ~20–25 full account cycles/mo; GM 84% @20 accts, 76% @30, 68% stress-case floor                                          |
| Enterprise | custom          | custom             | BYO everything            | + custom cards/views + optional full-service (we run signals+outreach, train team) — retainer                            |

## Credit price table (config-driven, 1 credit ≈ $0.02 retail; Clay-style: don't hide COGS variance in one flat credit)

| Action                                                                                 | COGS est.                | Credits |
| -------------------------------------------------------------------------------------- | ------------------------ | ------- |
| Account research run (Exa + LLM synthesis)                                             | ~$0.17                   | 12      |
| Buying-group generation                                                                | ~$0.03                   | 3       |
| Outreach cadence gen (5 touches + QA)                                                  | ~$0.09                   | 8       |
| Apollo enrichment / contact                                                            | $0.02–0.16 (PROVISIONAL) | 4       |
| Trigify monitor (recurring, per account/mo)                                            | ~$0.20–0.40/mo           | 18/mo   |
| Standalone deep-research dossier                                                       | ~$0.15                   | 10      |
| Overage: top-ups at ~30% premium (Clay pattern); rollover: generous (up to 2x monthly) |
| — deliberately friendlier than Apollo's no-rollover recurring add-ons.                 |

**CONFIRMED (Romeo, round 8, 2026-07-07):** Pro = 500 credits/mo **plus top-up
purchases**; top-up credits never expire. Settings UI (Plan & Billing) shows the
balance with a "Buy top-up credits" action.

## Per-contact pricing logic (round 8 — the "Manage by app" contact math)

Contact-based actions are charged **per contact touched**, not per run, because vendor
COGS scales per contact (Apollo 1–8 credits/contact; Trigify person-enrich 4):

- **Enrichment** (Apollo/Harvest): `credits = contacts_enriched × 4` — the UI shows the
  count and the projected credit cost BEFORE the run and asks confirm above a
  config-driven threshold (default 10 contacts).
- **Buying-group generation** (3 credits flat) covers up to a config cap of candidate
  contacts read from HubSpot (default 25); beyond the cap the UI proposes narrowing or
  confirms the extra per-contact enrichment cost.
- **Outreach cadence** (8 credits) is per PERSON in the cadence — 3 stakeholders =
  3 cadences = 24 credits; the Outreach tab shows the total before Generate.
- Warm-intro scoring rides on research credits (no separate per-connection charge).
  All multipliers/caps/thresholds live in the config-driven credit table (per-tenant
  overridable on Enterprise), never hardcoded in UI.

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
