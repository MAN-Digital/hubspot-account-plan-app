import { fixtureEligibleStrong } from "@hap/config";
import { Button, LoadingButton, Select, Text } from "@hubspot/ui-extensions";
import { createRenderer } from "@hubspot/ui-extensions/testing";
import { describe, expect, it, vi } from "vitest";
import { PeopleProspectingAction, WoodpeckerCampaignAction } from "../account-actions";
import { collectAllText } from "./test-utils";

describe("PeopleProspectingAction", () => {
  it("previews candidates at zero credits and accepts returned candidate ids", async () => {
    const api = {
      previewPeople: vi.fn(async () => ({
        runId: "run-1",
        companyId: "co-1",
        projectedCredits: { min: 0, max: 20 },
        blockers: {},
        candidates: [
          {
            id: "cand-1",
            provider: "apollo",
            firstName: "Ada",
            lastName: "Buyer",
            title: "VP Revenue",
          },
        ],
      })),
      acceptPeople: vi.fn(async () => ({
        runId: "run-1",
        companyId: "co-1",
        acceptedCount: 1,
        debitedCredits: 4,
        balanceAfter: 96,
      })),
      suggestWoodpeckerCampaigns: vi.fn(),
      addWoodpeckerCampaignMember: vi.fn(),
    };
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<PeopleProspectingAction companyId="co-1" api={api} />);

    renderer.find(LoadingButton).trigger("onClick");

    await renderer.waitFor(() => {
      const text = collectAllText(renderer.getRootNode());
      expect(text).toContain("Ada Buyer");
      expect(text).toContain("Up to 20 credits");
    });

    const acceptButton = renderer
      .findAll(Button)
      .find((button) => collectAllText(button).includes("Accept shown people"));
    if (!acceptButton) throw new Error("accept button not found");
    acceptButton.trigger("onClick");

    await renderer.waitFor(() => {
      expect(api.acceptPeople).toHaveBeenCalledWith("co-1", {
        runId: "run-1",
        candidateIds: ["cand-1"],
      });
    });
    expect(api.previewPeople).toHaveBeenCalledWith("co-1", {
      sourceMode: "apollo_harvest",
      maxContacts: 5,
      filters: { titles: ["VP Revenue", "Head of Sales", "RevOps"] },
    });
  });
});

describe("WoodpeckerCampaignAction", () => {
  it("loads existing campaign suggestions and adds the first snapshot person to the selected campaign", async () => {
    const api = {
      previewPeople: vi.fn(),
      acceptPeople: vi.fn(),
      suggestWoodpeckerCampaigns: vi.fn(async () => ({
        companyId: "co-strong",
        recommendedCampaignId: "camp-1",
        campaigns: [
          {
            id: "camp-1",
            name: "Funding + champion",
            status: "active",
            channelVariant: "email",
            matchReason: "angle+signal",
            score: 6,
          },
        ],
        allCampaigns: [],
        defaultAction: "add_to_existing_campaign",
      })),
      addWoodpeckerCampaignMember: vi.fn(async () => ({
        campaignId: "camp-1",
        memberId: "member-1",
        reusedExistingCampaign: true,
        createdCampaign: false,
        exportStatus: "pending",
      })),
    };
    const snapshot = fixtureEligibleStrong("tenant-1");
    const renderer = createRenderer("crm.record.tab");
    renderer.render(<WoodpeckerCampaignAction snapshot={snapshot} api={api} />);

    renderer.find(LoadingButton).trigger("onClick");

    await renderer.waitFor(() => {
      expect(renderer.find(Select, { name: "woodpeckerCampaign" })).toBeTruthy();
    });
    const addButton = renderer
      .findAll(Button)
      .find((button) => collectAllText(button).includes("Add first person"));
    if (!addButton) throw new Error("add button not found");
    addButton.trigger("onClick");

    await renderer.waitFor(() => {
      expect(api.addWoodpeckerCampaignMember).toHaveBeenCalledWith(snapshot.companyId, {
        campaignId: "camp-1",
        personKey: snapshot.people[0]?.id,
        snippets: {
          reasonToTalk: snapshot.people[0]?.reasonToTalk,
          reasonToContact: snapshot.reasonToContact,
        },
      });
    });
    expect(
      renderer
        .findAll(Text)
        .map((node) => node.text ?? "")
        .join(" "),
    ).toContain("Person queued");
  });
});
