/**
 * Tests for Trigify company matching (Stage A Task 5).
 *
 * `company-match.ts` resolves a normalized signal's LinkedIn company
 * URL/domain -> a HubSpot `hs_company_id`, via the `company_signal_map`
 * alias table first, then a HubSpot company search fallback (by domain).
 * A successful fallback match writes the alias back with a confidence so
 * subsequent polls skip the HubSpot search. NEVER fabricates a match —
 * unresolved stays `null`.
 */

import { describe, expect, it, vi } from "vitest";
import { type CompanyMatchDeps, matchCompany } from "../company-match";

const TENANT_ID = "tenant-1";

function makeDeps(overrides: Partial<CompanyMatchDeps> = {}): CompanyMatchDeps {
  return {
    lookupAlias: vi.fn(async () => null),
    searchCompanyByDomain: vi.fn(async () => null),
    writeAlias: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("matchCompany", () => {
  it("returns the existing alias without calling HubSpot search when found by linkedinUrl", async () => {
    const deps = makeDeps({
      lookupAlias: vi.fn(async () => ({
        hsCompanyId: "co-42",
        confidence: 0.95,
      })),
    });
    const result = await matchCompany(deps, TENANT_ID, {
      linkedinUrl: "https://www.linkedin.com/company/acme-corp/",
      domain: null,
    });
    expect(result).toEqual({
      hsCompanyId: "co-42",
      confidence: 0.95,
      source: "alias",
    });
    expect(deps.searchCompanyByDomain).not.toHaveBeenCalled();
    expect(deps.writeAlias).not.toHaveBeenCalled();
  });

  it("falls back to HubSpot domain search when no alias exists, and writes the alias back", async () => {
    const deps = makeDeps({
      lookupAlias: vi.fn(async () => null),
      searchCompanyByDomain: vi.fn(async () => ({ hsCompanyId: "co-99" })),
    });
    const result = await matchCompany(deps, TENANT_ID, {
      linkedinUrl: "https://www.linkedin.com/company/acme-corp/",
      domain: "acme.com",
    });
    expect(result?.hsCompanyId).toBe("co-99");
    expect(result?.source).toBe("domain-search");
    expect(deps.searchCompanyByDomain).toHaveBeenCalledWith("acme.com");
    expect(deps.writeAlias).toHaveBeenCalledTimes(1);
    const [tenantId, alias] = (deps.writeAlias as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(tenantId).toBe(TENANT_ID);
    expect(alias.hsCompanyId).toBe("co-99");
    expect(alias.linkedinUrl).toBe("https://www.linkedin.com/company/acme-corp/");
    expect(alias.domain).toBe("acme.com");
    expect(alias.confidence).toBeGreaterThan(0);
  });

  it("never fabricates a match: returns null when no alias and no domain search hit", async () => {
    const deps = makeDeps();
    const result = await matchCompany(deps, TENANT_ID, {
      linkedinUrl: "https://www.linkedin.com/company/unknown-co/",
      domain: null,
    });
    expect(result).toBeNull();
    expect(deps.writeAlias).not.toHaveBeenCalled();
  });

  it("does not attempt a domain search when no domain is available", async () => {
    const deps = makeDeps();
    await matchCompany(deps, TENANT_ID, {
      linkedinUrl: "https://www.linkedin.com/company/no-domain-co/",
      domain: null,
    });
    expect(deps.searchCompanyByDomain).not.toHaveBeenCalled();
  });

  it("looks up the alias by domain when no linkedinUrl is available", async () => {
    const deps = makeDeps({
      lookupAlias: vi.fn(async (_tenantId, key) =>
        key.domain === "acme.com" ? { hsCompanyId: "co-1", confidence: 0.9 } : null,
      ),
    });
    const result = await matchCompany(deps, TENANT_ID, {
      linkedinUrl: null,
      domain: "acme.com",
    });
    expect(result?.hsCompanyId).toBe("co-1");
  });

  it("returns null and does not throw when both linkedinUrl and domain are absent", async () => {
    const deps = makeDeps();
    const result = await matchCompany(deps, TENANT_ID, {
      linkedinUrl: null,
      domain: null,
    });
    expect(result).toBeNull();
    expect(deps.lookupAlias).not.toHaveBeenCalled();
    expect(deps.searchCompanyByDomain).not.toHaveBeenCalled();
  });
});
