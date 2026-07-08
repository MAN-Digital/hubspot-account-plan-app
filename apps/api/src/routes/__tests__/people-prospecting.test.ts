import { randomUUID } from "node:crypto";
import {
  createDatabase,
  creditLedger,
  peopleProspectingCandidates,
  peopleProspectingRuns,
  tenants,
  tenantUsers,
  usageEvents,
} from "@hap/db";
import { and, eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createPeopleProspectingRoutes,
  type PeopleProspectingPreviewer,
} from "../people-prospecting";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);
const PORTAL_PREFIX = `peopleroute-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label} to be defined`);
  return value;
}

async function seedTenant(name = "People Prospecting Tenant") {
  const [tenant] = await db
    .insert(tenants)
    .values({ hubspotPortalId: portalId(), name })
    .returning();
  return required(tenant, "tenant");
}

function buildRouteOnlyApp(
  tenantId: string,
  previewer: PeopleProspectingPreviewer,
  userId = "u-1",
) {
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
  app.route("/api/people", createPeopleProspectingRoutes({ previewer }));
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

describe("POST /api/people/:companyId/prospect/preview", () => {
  it("creates a zero-credit preview run and stores Apollo/Harvest candidate drafts", async () => {
    const tenant = await seedTenant();
    const previewer: PeopleProspectingPreviewer = async () => ({
      providerRequests: {
        apollo: { endpoint: "POST /api/v1/mixed_people/api_search" },
        harvest: { endpoint: "GET /linkedin/profile-search" },
      },
      blockers: {},
      candidates: [
        {
          provider: "apollo",
          providerPersonId: "apollo-person-1",
          firstName: "Ada",
          lastName: "Buyer",
          title: "VP Revenue",
          company: "ExampleCo",
          location: "New York, US",
          linkedinUrl: "https://www.linkedin.com/in/ada-buyer/",
          emailStatus: "verified",
          requiredFieldCompleteness: { firstName: true, lastName: true, title: true },
        },
        {
          provider: "harvest",
          providerPersonId: "harvest-profile-1",
          firstName: "Harper",
          lastName: "Signal",
          title: "Director of Sales",
          linkedinUrl: "https://www.linkedin.com/in/harper-signal/",
          evidenceRefs: [{ type: "linkedin_profile", url: "https://linkedin.com/in/harper" }],
        },
      ],
    });

    const app = buildRouteOnlyApp(tenant.id, previewer);
    const res = await app.request("/api/people/co-123/prospect/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        sourceMode: "apollo_harvest",
        maxContacts: 5,
        filters: {
          titles: ["VP Revenue", "Director Sales"],
          personLocations: ["New York"],
          organizationDomains: ["example.com"],
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      runId: string;
      projectedCredits: { min: number; max: number };
      candidates: Array<{ provider: string; firstName?: string }>;
    };
    expect(body.projectedCredits).toEqual({ min: 0, max: 20 });
    expect(body.candidates).toHaveLength(2);
    expect(body.candidates.map((candidate) => candidate.provider)).toEqual(["apollo", "harvest"]);

    const runs = await db
      .select()
      .from(peopleProspectingRuns)
      .where(eq(peopleProspectingRuns.id, body.runId));
    expect(runs[0]?.status).toBe("previewed");
    expect(runs[0]?.debitedCredits).toBe(0);
    expect(runs[0]?.projectedCreditMax).toBe(20);

    const usageRows = await db
      .select()
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.tenantId, tenant.id),
          eq(usageEvents.actionType, "people_prospecting_preview"),
        ),
      );
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]?.credits).toBe(0);
  });
});

describe("POST /api/people/:companyId/prospect/accept", () => {
  it("debits only accepted usable candidates and marks them accepted", async () => {
    const tenant = await seedTenant();
    await db.insert(tenantUsers).values({
      tenantId: tenant.id,
      hubspotUserId: "u-1",
      email: "rep@example.com",
      appRole: "rep",
      dailyCreditCap: 20,
      weeklyCreditCap: 50,
      monthlyCreditCap: 100,
    });
    await db.insert(creditLedger).values({
      tenantId: tenant.id,
      hubspotUserId: "u-1",
      actionType: "topup",
      entityRef: "billing:test",
      deltaCredits: 50,
      balanceAfter: 50,
    });
    const [run] = await db
      .insert(peopleProspectingRuns)
      .values({
        tenantId: tenant.id,
        companyId: "co-123",
        requestedByHubspotUserId: "u-1",
        sourceMode: "apollo_harvest",
        maxContacts: 5,
        status: "previewed",
        projectedCreditMax: 20,
      })
      .returning();
    const [firstCandidate] = await db
      .insert(peopleProspectingCandidates)
      .values({
        tenantId: tenant.id,
        runId: required(run, "run").id,
        provider: "apollo",
        providerPersonId: "apollo-person-1",
        firstName: "Ada",
        lastName: "Buyer",
        title: "VP Revenue",
        linkedinUrl: "https://www.linkedin.com/in/ada-buyer/",
      })
      .returning();
    const [secondCandidate] = await db
      .insert(peopleProspectingCandidates)
      .values({
        tenantId: tenant.id,
        runId: required(run, "run").id,
        provider: "harvest",
        providerPersonId: "harvest-profile-1",
        firstName: "Harper",
        lastName: "Signal",
        title: "Director of Sales",
        linkedinUrl: "https://www.linkedin.com/in/harper-signal/",
      })
      .returning();

    const app = buildRouteOnlyApp(tenant.id, async () => ({
      providerRequests: {},
      blockers: {},
      candidates: [],
    }));
    const res = await app.request("/api/people/co-123/prospect/accept", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        runId: required(run, "run").id,
        candidateIds: [
          required(firstCandidate, "firstCandidate").id,
          required(secondCandidate, "secondCandidate").id,
        ],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      runId: required(run, "run").id,
      acceptedCount: 2,
      debitedCredits: 8,
      balanceAfter: 42,
    });

    const debitRows = await db
      .select()
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, tenant.id),
          eq(creditLedger.actionType, "people_prospecting_accept"),
        ),
      );
    expect(debitRows).toHaveLength(1);
    expect(debitRows[0]?.deltaCredits).toBe(-8);

    const acceptedRows = await db
      .select()
      .from(peopleProspectingCandidates)
      .where(eq(peopleProspectingCandidates.runId, required(run, "run").id));
    expect(acceptedRows.every((candidate) => candidate.status === "accepted")).toBe(true);
  });
});
