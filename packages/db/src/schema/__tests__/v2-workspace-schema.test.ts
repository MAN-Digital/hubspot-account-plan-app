import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../schema";
import {
  accountDataGaps,
  accountGenerationLineItems,
  accountGenerationRuns,
  accountResearch,
  billingTopups,
  buyingGroups,
  creditLedger,
  hubspotSignalRules,
  outreachAngles,
  outreachCampaignMembers,
  outreachCampaigns,
  outreachConfig,
  outreachDrafts,
  peopleProspectingCandidates,
  peopleProspectingRuns,
  tenants,
  tenantUsers,
  usageEvents,
  warmIntros,
} from "../../schema";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 4 });
const db = drizzle(sql, { schema });

const PORTAL_PREFIX = `v2schema-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label} to be defined`);
  return value;
}

async function createTenant(name: string) {
  const [tenant] = await db
    .insert(tenants)
    .values({ hubspotPortalId: portalId(), name })
    .returning();
  return required(tenant, "tenant").id;
}

beforeAll(async () => {
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

beforeEach(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

describe("v2 workspace schema foundation", () => {
  it("stores the tenant user, credit, usage, outreach, prospecting, research, and settings rows V2 needs", async () => {
    const tenantId = await createTenant("V2 Workspace Tenant");

    const [tenantUser] = await db
      .insert(tenantUsers)
      .values({
        tenantId,
        hubspotUserId: "u-1",
        email: "rep@example.com",
        name: "Riley Rep",
        appRole: "rep",
        dailyCreditCap: 20,
        weeklyCreditCap: 80,
        monthlyCreditCap: 100,
      })
      .returning();
    expect(tenantUser?.appAccessEnabled).toBe(true);
    expect(tenantUser?.uncapped).toBe(false);

    const [credit] = await db
      .insert(creditLedger)
      .values({
        tenantId,
        hubspotUserId: "u-1",
        actionType: "topup",
        entityRef: "billing:seed",
        deltaCredits: 100,
        balanceAfter: 100,
        reason: "development seed",
        metadata: { packKey: "dev-100" },
      })
      .returning();
    expect(credit?.deltaCredits).toBe(100);

    const [usage] = await db
      .insert(usageEvents)
      .values({
        tenantId,
        hubspotUserId: "u-1",
        actionType: "outreach_angle_rebuild",
        entityRef: "company:co-1",
        projectedCredits: 24,
        credits: 24,
        result: "debited",
        metadata: { oldAngle: "direct", newAngle: "interview" },
      })
      .returning();
    expect(usage?.credits).toBe(24);

    const [angle] = await db
      .insert(outreachAngles)
      .values({
        tenantId,
        angleKey: "interview",
        name: "Interview",
        goal: "Invite expert feedback without pitching.",
        channels: ["email", "linkedin"],
        frameworks: ["problem_interview"],
        targetPersonas: ["decision_maker"],
        tone: "consultative",
        guardrails: { noPitch: true },
        enabledForReps: true,
        createdByHubspotUserId: "u-1",
      })
      .returning();
    expect(angle?.enabled).toBe(true);

    const [draft] = await db
      .insert(outreachDrafts)
      .values({
        tenantId,
        companyId: "co-1",
        angleKey: "direct",
        includedPeople: [{ id: "p-1" }, { id: "p-2" }, { id: "p-3" }],
        envelope: {},
        cadence: {},
        copy: {},
        qa: {},
      })
      .returning();
    expect(draft?.status).toBe("draft");

    const [campaign] = await db
      .insert(outreachCampaigns)
      .values({
        tenantId,
        companyId: "co-1",
        provider: "woodpecker",
        angleKey: "interview",
        channelVariant: "email_linkedin",
        name: "Acme - Interview - Expansion",
        status: "draft",
        createdByHubspotUserId: "u-1",
      })
      .returning();

    const [member] = await db
      .insert(outreachCampaignMembers)
      .values({
        tenantId,
        campaignId: required(campaign, "campaign").id,
        personKey: "p-1",
        draftId: required(draft, "draft").id,
        snippets: { opener: "saw your post" },
        addedByHubspotUserId: "u-1",
      })
      .returning();
    expect(member?.personKey).toBe("p-1");

    const [research] = await db
      .insert(accountResearch)
      .values({
        tenantId,
        companyId: "co-1",
        status: "ready",
        sections: { context: "tested" },
        sources: [{ source: "exa" }],
        generatedByHubspotUserId: "u-1",
      })
      .returning();
    expect(research?.sections).toEqual({ context: "tested" });

    const [gap] = await db
      .insert(accountDataGaps)
      .values({
        tenantId,
        companyId: "co-1",
        gapType: "company_property",
        label: "Missing industry",
        propertyName: "industry",
        severity: "high",
        ownerName: "Riley Rep",
        suggestedAction: "Update CRM property",
      })
      .returning();
    expect(gap?.status).toBe("open");

    const [run] = await db
      .insert(accountGenerationRuns)
      .values({
        tenantId,
        companyId: "co-1",
        requestedByHubspotUserId: "u-1",
        trigger: "workspace",
        requestedScopeItems: ["research", "people"],
        peopleConstraints: { maxContacts: 5, roles: ["decision_maker"] },
        projectedCreditMin: 1,
        projectedCreditMax: 42,
        status: "completed",
      })
      .returning();

    const [lineItem] = await db
      .insert(accountGenerationLineItems)
      .values({
        tenantId,
        runId: required(run, "run").id,
        module: "research",
        projectedCreditMin: 1,
        projectedCreditMax: 2,
        debitedCredits: 1,
        outputRef: required(research, "research").id,
        outputCount: 1,
      })
      .returning();
    expect(lineItem?.module).toBe("research");

    const [prospectingRun] = await db
      .insert(peopleProspectingRuns)
      .values({
        tenantId,
        companyId: "co-1",
        requestedByHubspotUserId: "u-1",
        sourceMode: "apollo_harvest",
        maxContacts: 5,
        filters: { titles: ["VP Sales"] },
        providerRequests: { apollo: "preview" },
        status: "previewed",
        projectedCreditMin: 0,
        projectedCreditMax: 40,
      })
      .returning();

    const [candidate] = await db
      .insert(peopleProspectingCandidates)
      .values({
        tenantId,
        runId: required(prospectingRun, "prospectingRun").id,
        provider: "apollo",
        providerPersonId: "apollo-person-1",
        firstName: "Alex",
        lastName: "Buyer",
        title: "VP Sales",
        company: "Acme",
        location: "Boston, MA",
        linkedinUrl: "https://www.linkedin.com/in/alexbuyer",
        emailStatus: "verified",
        requiredFieldCompleteness: { linkedinUrl: true },
        evidenceRefs: [],
        duplicateMatch: {},
      })
      .returning();
    expect(candidate?.status).toBe("previewed");

    const [buyingGroup] = await db
      .insert(buyingGroups)
      .values({
        tenantId,
        companyId: "co-1",
        roleSlots: [{ role: "decision_maker", personKey: "p-1" }],
        edits: [],
      })
      .returning();
    expect(buyingGroup?.roleSlots).toEqual([{ role: "decision_maker", personKey: "p-1" }]);

    const [rule] = await db
      .insert(hubspotSignalRules)
      .values({
        tenantId,
        name: "Recent intent property",
        eventType: "property_change",
        objectType: "company",
        propertyName: "recent_intent_signal",
        condition: { operator: "is_known" },
        signalType: "hubspot_signal",
        level: "company",
        createdByHubspotUserId: "u-1",
      })
      .returning();
    expect(rule?.enabled).toBe(true);

    const [topup] = await db
      .insert(billingTopups)
      .values({
        tenantId,
        requestedByHubspotUserId: "u-1",
        packKey: "topup-100",
        credits: 100,
        amount: 49,
        currency: "USD",
        provider: "stripe",
        status: "pending",
      })
      .returning();
    expect(topup?.credits).toBe(100);

    const [config] = await db
      .insert(outreachConfig)
      .values({
        tenantId,
        positioning: { promise: "account planning" },
        vocabulary: { avoid: ["guaranteed"] },
        frameworks: { direct: true },
        exportProvider: "woodpecker_email",
        settings: { outreachCadenceCreditCost: 8 },
      })
      .returning();
    expect(config?.exportProvider).toBe("woodpecker_email");

    const [warmIntro] = await db
      .insert(warmIntros)
      .values({
        tenantId,
        companyId: "co-1",
        mutualConnections: [{ name: "Morgan Connector" }],
        introRequests: [],
      })
      .returning();
    expect(warmIntro?.mutualConnections).toEqual([{ name: "Morgan Connector" }]);
  });

  it("cascades all V2 tenant-scoped rows on tenant delete", async () => {
    const tenantId = await createTenant("V2 Cascade Tenant");

    await db.insert(tenantUsers).values({
      tenantId,
      hubspotUserId: "u-cascade",
      appRole: "rep",
    });
    await db.insert(creditLedger).values({
      tenantId,
      hubspotUserId: "u-cascade",
      actionType: "seed",
      entityRef: "seed",
      deltaCredits: 10,
    });

    await db.delete(tenants).where(eq(tenants.id, tenantId));

    const users = await db.select().from(tenantUsers).where(eq(tenantUsers.tenantId, tenantId));
    const credits = await db.select().from(creditLedger).where(eq(creditLedger.tenantId, tenantId));
    expect(users).toHaveLength(0);
    expect(credits).toHaveLength(0);
  });
});
