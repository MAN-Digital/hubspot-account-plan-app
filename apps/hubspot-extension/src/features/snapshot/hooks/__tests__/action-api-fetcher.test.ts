import { afterEach, describe, expect, it, vi } from "vitest";

const { fetchMock } = vi.hoisted(() => ({
  fetchMock: vi.fn(),
}));
vi.mock("@hubspot/ui-extensions", () => ({
  hubspot: {
    fetch: fetchMock,
  },
}));

import { createAccountActionApi } from "../action-api-fetcher";

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: async () => body,
  } as Response;
}

describe("createAccountActionApi", () => {
  afterEach(() => {
    fetchMock.mockReset();
  });

  it("previews people through hubspot.fetch with no custom headers", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        runId: "run-1",
        companyId: "co-1",
        projectedCredits: { min: 0, max: 20 },
        blockers: {},
        candidates: [],
      }),
    );
    const api = createAccountActionApi({ baseUrl: "https://api.example.test", timeoutMs: 8_000 });

    await api.previewPeople("co-1", {
      sourceMode: "apollo_harvest",
      maxContacts: 5,
      filters: { titles: ["VP Revenue"] },
    });

    expect(fetchMock).toHaveBeenCalledWith(
      "https://api.example.test/api/people/co-1/prospect/preview",
      {
        method: "POST",
        body: {
          sourceMode: "apollo_harvest",
          maxContacts: 5,
          filters: { titles: ["VP Revenue"] },
        },
        timeout: 8_000,
      },
    );
    expect(fetchMock.mock.calls[0]?.[1]).not.toHaveProperty("headers");
  });

  it("accepts selected people through the accept endpoint", async () => {
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        runId: "run-1",
        companyId: "co-1",
        acceptedCount: 2,
        debitedCredits: 8,
        balanceAfter: 92,
      }),
    );
    const api = createAccountActionApi({ baseUrl: "https://api.example.test" });

    const result = await api.acceptPeople("co-1", {
      runId: "run-1",
      candidateIds: ["cand-1", "cand-2"],
    });

    expect(result.acceptedCount).toBe(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/api/people/co-1/prospect/accept",
    );
  });

  it("loads Woodpecker campaign suggestions and adds a member to an existing campaign", async () => {
    fetchMock
      .mockResolvedValueOnce(
        jsonResponse(200, {
          companyId: "co-1",
          recommendedCampaignId: "camp-1",
          campaigns: [{ id: "camp-1", name: "Security angle", status: "active", score: 6 }],
          allCampaigns: [],
          defaultAction: "add_to_existing_campaign",
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(200, {
          campaignId: "camp-1",
          memberId: "member-1",
          reusedExistingCampaign: true,
          createdCampaign: false,
          exportStatus: "pending",
        }),
      );
    const api = createAccountActionApi({ baseUrl: "https://api.example.test" });

    await api.suggestWoodpeckerCampaigns("co-1", {
      angleKey: "security",
      signalHeadline: "Funding event",
    });
    await api.addWoodpeckerCampaignMember("co-1", {
      campaignId: "camp-1",
      personKey: "person-1",
      snippets: { whyNow: "Funding event" },
    });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.example.test/api/outreach/co-1/woodpecker/campaigns/suggestions",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.example.test/api/outreach/co-1/woodpecker/campaign-members",
    );
  });
});
