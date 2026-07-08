import { randomUUID } from "node:crypto";
import { createDatabase, outreachCampaignMembers, outreachCampaigns, tenants } from "@hap/db";
import { and, eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { outreachRoutes } from "../outreach";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);
const PORTAL_PREFIX = `woodpeckerroute-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label} to be defined`);
  return value;
}

async function seedTenant(name = "Woodpecker Route Tenant") {
  const [tenant] = await db
    .insert(tenants)
    .values({ hubspotPortalId: portalId(), name })
    .returning();
  return required(tenant, "tenant");
}

function buildRouteOnlyApp(tenantId: string, userId = "u-1") {
  const app = new Hono<{
    Variables: {
      tenantId?: string;
      userId?: string;
      db?: ReturnType<typeof createDatabase>;
    };
  }>();
  app.use("*", async (c, next) => {
    c.set("tenantId", tenantId);
    c.set("userId", userId);
    c.set("db", db);
    await next();
  });
  app.route("/api/outreach", outreachRoutes);
  return app;
}

beforeAll(() => {
  process.env.NODE_ENV = "test";
  process.env.DATABASE_URL = DATABASE_URL;
});

afterAll(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

beforeEach(async () => {
  await db.delete(tenants).where(like(tenants.hubspotPortalId, `${PORTAL_PREFIX}%`));
});

describe("POST /api/outreach/:companyId/woodpecker/campaigns/suggestions", () => {
  it("suggests existing same account + angle + signal campaigns before any create path", async () => {
    const tenant = await seedTenant();
    const [matchingCampaign] = await db
      .insert(outreachCampaigns)
      .values({
        tenantId: tenant.id,
        companyId: "co-123",
        provider: "woodpecker",
        externalCampaignId: "wp-1",
        angleKey: "direct",
        primarySignalKey: "hiring-spike",
        primarySignalHeadline: "Hiring spike in RevOps",
        channelVariant: "email_linkedin",
        name: "ExampleCo - Direct - Hiring spike",
        status: "ready",
      })
      .returning();
    await db.insert(outreachCampaigns).values({
      tenantId: tenant.id,
      companyId: "co-123",
      provider: "woodpecker",
      externalCampaignId: "wp-2",
      angleKey: "interview",
      primarySignalKey: "event",
      channelVariant: "email",
      name: "ExampleCo - Interview",
      status: "ready",
    });

    const app = buildRouteOnlyApp(tenant.id);
    const res = await app.request("/api/outreach/co-123/woodpecker/campaigns/suggestions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        angleKey: "direct",
        signalKey: "hiring-spike",
        channelVariant: "email_linkedin",
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      recommendedCampaignId: required(matchingCampaign, "matchingCampaign").id,
      campaigns: [
        {
          id: required(matchingCampaign, "matchingCampaign").id,
          externalCampaignId: "wp-1",
          matchReason: "same_account_angle_signal_channel",
        },
      ],
    });
  });
});

describe("POST /api/outreach/:companyId/woodpecker/campaign-members", () => {
  it("adds a person to the selected existing campaign without creating another campaign", async () => {
    const tenant = await seedTenant();
    const [campaign] = await db
      .insert(outreachCampaigns)
      .values({
        tenantId: tenant.id,
        companyId: "co-123",
        provider: "woodpecker",
        externalCampaignId: "wp-1",
        angleKey: "direct",
        primarySignalKey: "hiring-spike",
        channelVariant: "email",
        name: "ExampleCo - Direct - Hiring spike",
        status: "ready",
      })
      .returning();

    const app = buildRouteOnlyApp(tenant.id);
    const res = await app.request("/api/outreach/co-123/woodpecker/campaign-members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        campaignId: required(campaign, "campaign").id,
        personKey: "contact-123",
        contactId: "123",
        snippets: { first_line: "Saw the RevOps hiring spike." },
        customFields: { signal: "Hiring spike" },
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      campaignId: required(campaign, "campaign").id,
      reusedExistingCampaign: true,
      createdCampaign: false,
      exportStatus: "pending",
    });

    const campaignRows = await db
      .select()
      .from(outreachCampaigns)
      .where(
        and(eq(outreachCampaigns.tenantId, tenant.id), eq(outreachCampaigns.companyId, "co-123")),
      );
    expect(campaignRows).toHaveLength(1);

    const memberRows = await db
      .select()
      .from(outreachCampaignMembers)
      .where(eq(outreachCampaignMembers.campaignId, required(campaign, "campaign").id));
    expect(memberRows).toHaveLength(1);
    expect(memberRows[0]?.personKey).toBe("contact-123");
  });

  it("requires explicit createNewCampaign=true before creating a campaign", async () => {
    const tenant = await seedTenant();
    const app = buildRouteOnlyApp(tenant.id);

    const blocked = await app.request("/api/outreach/co-123/woodpecker/campaign-members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        personKey: "contact-123",
      }),
    });
    expect(blocked.status).toBe(400);
    expect(await blocked.json()).toMatchObject({ error: "campaign_selection_required" });

    const created = await app.request("/api/outreach/co-123/woodpecker/campaign-members", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        createNewCampaign: true,
        newCampaign: {
          name: "ExampleCo - Direct - Hiring spike",
          angleKey: "direct",
          signalKey: "hiring-spike",
          signalHeadline: "Hiring spike in RevOps",
          channelVariant: "email",
        },
        personKey: "contact-123",
      }),
    });
    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({
      reusedExistingCampaign: false,
      createdCampaign: true,
      exportStatus: "pending",
    });
  });
});
