# Credit Economics & Sizing — is 500/mo right? (source of truth, mirrors ChatPRD doc)

**ChatPRD doc:** `faa0a41d-407b-4fe9-83b9-e7a6845a2a86`

**ChatPRD sync markers:**
- `ChatPRD sync addendum — round 11 overview/data gaps/ad hoc credits — 2026-07-07`
- `ChatPRD sync correction — round 11 single executive summary and This Outreach — 2026-07-07`

**Written 2026-07-07 (round 9, Romeo asked: "think about this 500 credits… is it enough
to use that or not, and how do we do it").** This doc answers three questions: (1) does
500 credits/mo cover our COGS, (2) is 500 enough for a customer to get value, (3) how do
we decide the number. Companion to `PRICING_AND_PACKAGING.md` (tiers + credit table).

## TL;DR

- **Margin is NOT the risk.** At 500 credits fully burned, worst-case COGS is ~$7–$20/mo
  against $99 revenue → **80–93% gross margin**. We can afford 500.
- **The real risk is RECURRING monitor credits.** Trigify monitors cost credits every
  month they stay active (18/mo each in the current table). They accumulate. A customer
  who tracks 20 accounts + their people burns most of the 500 just _maintaining
  monitoring_, leaving little for research/outreach. That is the binding constraint, not
  one-time research.
- **500 is enough for ~4–6 actively-worked NEW accounts/mo plus light monitoring — NOT
  for a rep running 15–20 accounts with full monitoring.** The earlier "20–25 cycles"
  estimate assumed a much lighter cycle (no per-person cadences, few enrichments, no
  recurring monitors) and is optimistic once round-8 multi-stakeholder outreach + tracking
  are in play.
- **Recommendation:** (a) DECOUPLE "tracked accounts" (monitors) from the research/
  outreach credit pool — meter monitoring as a separate "active monitors" count per tier,
  or charge it far lower; (b) ship per-rep budgets + the Usage & logs tab and INSTRUMENT
  real usage before hard-committing 500; (c) keep the number config-driven so we can move
  it without a code change.

## The unit: a "full account cycle" (round-8 realistic, multi-stakeholder)

| Action                                | Credits      | Notes                                 |
| ------------------------------------- | ------------ | ------------------------------------- |
| Account research run                  | 12           | one-time per account                  |
| Buying-group generation               | 3            | one-time                              |
| Apollo enrichment                     | ~20          | ~5 contacts × 4                       |
| Outreach cadence (per person)         | 24           | 3 stakeholders × 8                    |
| **One-time subtotal**                 | **~59**      | first touch of an account             |
| Trigify monitors (company + 2 people) | **54 / mo**  | 3 × 18 — **RECURRING**                |
| **First-month total**                 | **~113**     |                                       |
| **Ongoing (monitors only)**           | **~54 / mo** | persists until the monitor is removed |

So 500 credits/mo buys roughly:

- **First month:** ~4 brand-new full cycles (4 × 113 = 452), or
- **Steady state:** the recurring monitor load of ~9 fully-tracked accounts (9 × 54 = 486)
  leaves ~14 credits for anything else — i.e. monitoring saturates the allowance fast.

## Does 500 cover COGS? (yes, comfortably)

Worst-case COGS if a customer burns all 500 in the most expensive way:

- All Apollo enrichment: 500/4 = 125 contacts × up to $0.16 = **~$20/mo**
- All research: 500/12 = 41 runs × $0.17 = **~$7/mo**
- All monitors: 500/18 = 27 monitors × up to $0.40 = **~$11/mo recurring**

Against $99 revenue that is **80–93% gross margin**. Even a heavy month is safe. Margin
does not constrain the number — customer sufficiency and runaway monitor cost do.

## Why the monitor line is the whole ballgame

Monitors are the ONLY recurring credit sink. Research/buying-group/cadence/enrichment are
one-time per account. If a rep tracks accounts and never removes monitors, monitor credits
compound month over month until they crowd out real work — the customer perceives "I ran
out of credits and I barely did anything," which reads as the product being stingy even
though our COGS is trivial.

**Options (pick in the pricing decision, all config-driven):**

1. **Separate monitor allowance / "tracked accounts" count per tier** (recommended): e.g.
   Pro includes N active monitors, credits are only for research + outreach + enrichment.
   Cleanly matches how customers think ("I track X accounts, I research Y").
2. **Price monitors much lower** (e.g. 4–6/mo) so tracking 20 accounts is affordable.
3. **Cap active monitors per tier** and force cleanup — worst UX, avoid.

## How we decide the real number (methodology, not a guess)

We should NOT hard-lock 500 from a spreadsheet. Instead:

1. Ship **per-rep credit budgets** + the **Usage & logs tab** (round 9) so every debit is
   attributed to a user + action.
2. Run the trial cohort + design partners for a few weeks; read actual credits/account,
   monitors/customer, and research-vs-monitor split from the ledger.
3. Set Pro's allowance to cover the **P75 customer's monthly real usage** with headroom,
   and expose **top-ups** (already confirmed: 500/mo + never-expiring top-ups) for the
   heavy tail.
4. Revisit quarterly alongside the provider cost table (LLM/Apollo/Trigify move).

## Confirmed decisions (Romeo, round 9)

- Pro = **500 credits/mo + top-ups (never expire)** stays as the launch number, but flagged
  as **provisional pending real-usage instrumentation** (the Usage & logs tab exists partly
  to answer this).
- **Per-rep budgets** cap individual spend so one rep can't drain the shared pool.
- **Open decision for pricing sign-off:** decouple monitoring from the credit pool
  (recommended option 1) vs. keep monitors in-pool at a lower per-monitor cost. Needs
  Romeo's call before GA pricing locks.

## Round 11 update — workspace-visible rep budgets

Romeo clarified that generation should be **rep-initiated ad hoc from the company record**,
not primarily a superadmin-curated target-account batch. Pricing/credits UX therefore must
show the rep's personal monthly cap and remaining credits at the point of action:

- blank/no-data account → **Generate full account plan** shows the itemized projected
  credit cost before debit;
- no-open-deal account → generation still works, with no-deal treated as a planning state,
  not an error;
- blocked runs (rep cap, tenant pool, missing provider setup) are explicit states and are
  logged like successful debits;
- Usage & logs remains the admin/superadmin reporting surface, but reps see their own
  remaining budget in the workspace.

## Open questions to resolve before GA pricing lock

1. Monitor metering model (separate allowance vs in-pool cheaper) — **needs decision**.
2. Real credits-per-account from trial data — **needs instrumentation** (round-9 logs).
3. Top-up pack sizes + price (e.g. +250 / +1000) — draft from COGS + 30% Clay-style premium.
4. Per-rep default budget (e.g. Pro = pooled with optional per-rep caps; Enterprise = caps
   standard) — **needs decision**.
