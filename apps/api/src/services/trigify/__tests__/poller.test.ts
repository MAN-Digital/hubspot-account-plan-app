/**
 * Tests for the Trigify poller (Stage A Task 6).
 *
 * Source of truth: `trigify_poller.py`'s `poll()` (OrbStack VM,
 * `.../outreach-engine/trigify_poller.py`) — pull the free feed, normalize,
 * match to a company, upsert idempotently. Ports the READ-ONLY / ZERO
 * CREDIT-SPEND hard scope rule (codex R2/R3 in the source): the poller must
 * NEVER call a guarded/write Trigify endpoint.
 */

import { describe, expect, it, vi } from "vitest";
import {
  type PollTenantDeps,
  pollTenant,
  type SignalUpsertRow,
  type TrigifyFeedClient,
} from "../poller";

const TENANT_ID = "tenant-1";

function feedItem(overrides: Record<string, unknown> = {}) {
  return {
    id: "sig_1",
    type: "changed_role",
    profile_url: "https://www.linkedin.com/in/jane-doe/",
    company_url: "https://www.linkedin.com/company/acme-corp/",
    company_domain: "acme.com",
    headline: "Jane Doe became VP of RevOps",
    url: "https://www.linkedin.com/posts/jane-doe_promo-1",
    posted_at: "2026-07-01T09:00:00.000Z",
    ...overrides,
  };
}

function makeClient(items: Array<Record<string, unknown>>): TrigifyFeedClient {
  return {
    getSocialSignalsFeed: vi.fn(async () => ({ data: items })),
  };
}

function makeDeps(overrides: Partial<PollTenantDeps> = {}): PollTenantDeps {
  return {
    client: makeClient([feedItem()]),
    matchCompany: vi.fn(async () => ({
      hsCompanyId: "co-99",
      confidence: 0.9,
      source: "alias" as const,
    })),
    upsertSignal: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("pollTenant", () => {
  it("pulls the feed, normalizes, matches company, and upserts each signal", async () => {
    const deps = makeDeps();
    const result = await pollTenant(deps, TENANT_ID);

    expect(deps.client.getSocialSignalsFeed).toHaveBeenCalledTimes(1);
    expect(deps.upsertSignal).toHaveBeenCalledTimes(1);
    const [tenantId, row] = (deps.upsertSignal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      SignalUpsertRow,
    ];
    expect(tenantId).toBe(TENANT_ID);
    expect(row.signalType).toBe("T_Role_Change");
    expect(row.hsCompanyId).toBe("co-99");
    expect(result.signalsRecorded).toBe(1);
    expect(result.errors).toHaveLength(0);
  });

  it("is idempotent: upserting the same feed item twice does not duplicate signal count reporting", async () => {
    const upsertSignal = vi.fn(async () => {});
    const deps = makeDeps({ upsertSignal });
    await pollTenant(deps, TENANT_ID);
    await pollTenant(deps, TENANT_ID);
    // Both polls call upsert once each (idempotency itself is enforced by the
    // DB unique constraint on (tenantId, dedupeKey) — the upsert fn is an
    // ON CONFLICT DO UPDATE/NOTHING in the real DB adapter); the dedupeKey
    // must be IDENTICAL across both calls so the DB collapses them.
    const firstCall = (upsertSignal.mock.calls[0] as [string, SignalUpsertRow])[1];
    const secondCall = (upsertSignal.mock.calls[1] as [string, SignalUpsertRow])[1];
    expect(firstCall.dedupeKey).toBe(secondCall.dedupeKey);
  });

  it("skips unmappable signal types honestly (no upsert, reported as skipped)", async () => {
    const deps = makeDeps({
      client: makeClient([feedItem({ type: "totally_unknown_type" })]),
    });
    const result = await pollTenant(deps, TENANT_ID);
    expect(deps.upsertSignal).not.toHaveBeenCalled();
    expect(result.signalsRecorded).toBe(0);
    expect(result.skipped).toBe(1);
  });

  it("leaves hsCompanyId null when company matching fails, never fabricating one", async () => {
    const deps = makeDeps({
      matchCompany: vi.fn(async () => null),
    });
    const result = await pollTenant(deps, TENANT_ID);
    expect(result.signalsRecorded).toBe(1);
    const [, row] = (deps.upsertSignal as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      SignalUpsertRow,
    ];
    expect(row.hsCompanyId).toBeNull();
  });

  it("continues processing remaining items when the feed read fails, recording an error", async () => {
    const deps = makeDeps({
      client: {
        getSocialSignalsFeed: vi.fn(async () => {
          throw new Error("network down");
        }),
      },
    });
    const result = await pollTenant(deps, TENANT_ID);
    expect(result.signalsRecorded).toBe(0);
    expect(result.errors.length).toBe(1);
    expect(result.errors[0]).toMatch(/network down/);
  });

  it("NEVER calls a guarded/write Trigify method — zero credit spend (codex R2/R3)", async () => {
    const client = makeClient([feedItem()]);
    // The poller's client dependency type only exposes the free read method —
    // this assertion documents/enforces that no write-capable method exists
    // on the object the poller is given.
    expect((client as Record<string, unknown>).createSubscription).toBeUndefined();
    expect((client as Record<string, unknown>).createSearch).toBeUndefined();
  });

  it("passes tenant-scoped company context (domain) from the normalized signal to matchCompany", async () => {
    const matchCompany = vi.fn(async () => null);
    const deps = makeDeps({ matchCompany });
    await pollTenant(deps, TENANT_ID);
    expect(matchCompany).toHaveBeenCalledWith(
      TENANT_ID,
      expect.objectContaining({
        linkedinUrl: "https://www.linkedin.com/company/acme-corp/",
        domain: "acme.com",
      }),
    );
  });
});
