import { randomUUID } from "node:crypto";
import {
  createDatabase,
  creditLedger,
  outreachAngles,
  outreachDrafts,
  tenants,
  tenantUsers,
  usageEvents,
} from "@hap/db";
import { and, eq, like } from "drizzle-orm";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { outreachRoutes } from "../outreach";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db = createDatabase(DATABASE_URL);
const PORTAL_PREFIX = `outreachroute-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

function required<T>(value: T | undefined, label: string): T {
  if (value === undefined) throw new Error(`Expected ${label} to be defined`);
  return value;
}

async function seedTenant(name = "Outreach Route Tenant") {
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

describe("POST /api/outreach/:companyId/angle-rebuild/quote", () => {
  it("quotes included_people x 8 credits when the selected angle changes", async () => {
    const tenant = await seedTenant();
    await db.insert(outreachAngles).values({
      tenantId: tenant.id,
      angleKey: "interview",
      name: "Interview",
      goal: "Invite feedback.",
      channels: ["email"],
      frameworks: ["problem_interview"],
      enabled: true,
      enabledForReps: true,
    });

    const app = buildRouteOnlyApp(tenant.id);
    const res = await app.request("/api/outreach/co-123/angle-rebuild/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAngleKey: "direct",
        nextAngleKey: "interview",
        includedPeople: [{ id: "p-1" }, { id: "p-2" }, { id: "p-3" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      companyId: "co-123",
      currentAngleKey: "direct",
      nextAngleKey: "interview",
      includedPeopleCount: 3,
      unitCredits: 8,
      projectedCredits: 24,
      requiresRebuild: true,
      debitRequired: true,
    });
  });

  it("quotes zero credits and no rebuild when the selected angle is unchanged", async () => {
    const tenant = await seedTenant();
    await db.insert(outreachAngles).values({
      tenantId: tenant.id,
      angleKey: "direct",
      name: "Direct",
      goal: "Direct pitch.",
      channels: ["email"],
      frameworks: ["direct"],
      enabled: true,
      enabledForReps: true,
    });

    const app = buildRouteOnlyApp(tenant.id);
    const res = await app.request("/api/outreach/co-123/angle-rebuild/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAngleKey: "direct",
        nextAngleKey: "direct",
        includedPeopleCount: 3,
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      projectedCredits: 0,
      requiresRebuild: false,
      debitRequired: false,
    });
  });
});

describe("POST /api/outreach/:companyId/angle-rebuild/confirm", () => {
  it("debits credits, writes a usage event, and marks the draft rebuild_requested", async () => {
    const tenant = await seedTenant();
    await db.insert(tenantUsers).values({
      tenantId: tenant.id,
      hubspotUserId: "u-1",
      email: "rep@example.com",
      appRole: "rep",
      dailyCreditCap: 50,
      weeklyCreditCap: 100,
      monthlyCreditCap: 100,
    });
    await db.insert(creditLedger).values({
      tenantId: tenant.id,
      hubspotUserId: "u-1",
      actionType: "topup",
      entityRef: "billing:test",
      deltaCredits: 100,
      balanceAfter: 100,
    });
    await db.insert(outreachAngles).values({
      tenantId: tenant.id,
      angleKey: "interview",
      name: "Interview",
      goal: "Invite feedback.",
      channels: ["email"],
      frameworks: ["problem_interview"],
      enabled: true,
      enabledForReps: true,
    });
    const [draft] = await db
      .insert(outreachDrafts)
      .values({
        tenantId: tenant.id,
        companyId: "co-123",
        angleKey: "direct",
        includedPeople: [{ id: "p-1" }, { id: "p-2" }, { id: "p-3" }],
        envelope: {},
        cadence: {},
        copy: {},
        qa: {},
      })
      .returning();

    const app = buildRouteOnlyApp(tenant.id);
    const res = await app.request("/api/outreach/co-123/angle-rebuild/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAngleKey: "direct",
        nextAngleKey: "interview",
        draftId: required(draft, "draft").id,
        includedPeople: [{ id: "p-1" }, { id: "p-2" }, { id: "p-3" }],
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      projectedCredits: 24,
      debitedCredits: 24,
      status: "rebuild_requested",
    });

    const debitRows = await db
      .select()
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, tenant.id),
          eq(creditLedger.actionType, "outreach_angle_rebuild"),
        ),
      );
    expect(debitRows).toHaveLength(1);
    expect(debitRows[0]?.deltaCredits).toBe(-24);
    expect(debitRows[0]?.metadata).toMatchObject({
      oldAngle: "direct",
      newAngle: "interview",
      includedPeopleCount: 3,
    });

    const usageRows = await db
      .select()
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.tenantId, tenant.id),
          eq(usageEvents.actionType, "outreach_angle_rebuild"),
        ),
      );
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]?.credits).toBe(24);
    expect(usageRows[0]?.result).toBe("debited");

    const drafts = await db
      .select()
      .from(outreachDrafts)
      .where(eq(outreachDrafts.id, required(draft, "draft").id));
    expect(drafts[0]?.angleKey).toBe("interview");
    expect(drafts[0]?.status).toBe("rebuild_requested");
  });

  it("blocks disabled angles before any debit", async () => {
    const tenant = await seedTenant();
    await db.insert(tenantUsers).values({
      tenantId: tenant.id,
      hubspotUserId: "u-1",
      appRole: "rep",
      monthlyCreditCap: 100,
    });
    await db.insert(creditLedger).values({
      tenantId: tenant.id,
      hubspotUserId: "u-1",
      actionType: "topup",
      entityRef: "billing:test",
      deltaCredits: 100,
    });
    await db.insert(outreachAngles).values({
      tenantId: tenant.id,
      angleKey: "disabled-angle",
      name: "Disabled",
      goal: "Should not run.",
      channels: ["email"],
      frameworks: ["direct"],
      enabled: false,
      enabledForReps: false,
    });

    const app = buildRouteOnlyApp(tenant.id);
    const res = await app.request("/api/outreach/co-123/angle-rebuild/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAngleKey: "direct",
        nextAngleKey: "disabled-angle",
        includedPeopleCount: 1,
      }),
    });

    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe("angle_disabled");

    const debitRows = await db
      .select()
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, tenant.id),
          eq(creditLedger.actionType, "outreach_angle_rebuild"),
        ),
      );
    expect(debitRows).toHaveLength(0);
  });

  it("confirms unchanged angles without a credit debit or usage event", async () => {
    const tenant = await seedTenant();
    await db.insert(outreachAngles).values({
      tenantId: tenant.id,
      angleKey: "direct",
      name: "Direct",
      goal: "Direct pitch.",
      channels: ["email"],
      frameworks: ["direct"],
      enabled: true,
      enabledForReps: true,
    });

    const app = buildRouteOnlyApp(tenant.id);
    const res = await app.request("/api/outreach/co-123/angle-rebuild/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAngleKey: "direct",
        nextAngleKey: "direct",
        includedPeopleCount: 3,
      }),
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      projectedCredits: 0,
      debitedCredits: 0,
      status: "unchanged",
    });

    const debitRows = await db
      .select()
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, tenant.id),
          eq(creditLedger.actionType, "outreach_angle_rebuild"),
        ),
      );
    expect(debitRows).toHaveLength(0);

    const usageRows = await db
      .select()
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.tenantId, tenant.id),
          eq(usageEvents.actionType, "outreach_angle_rebuild"),
        ),
      );
    expect(usageRows).toHaveLength(0);
  });

  it("blocks insufficient tenant credit balance with an audit event and no debit", async () => {
    const tenant = await seedTenant();
    await db.insert(tenantUsers).values({
      tenantId: tenant.id,
      hubspotUserId: "u-1",
      appRole: "rep",
      monthlyCreditCap: 100,
    });
    await db.insert(creditLedger).values({
      tenantId: tenant.id,
      hubspotUserId: "u-1",
      actionType: "topup",
      entityRef: "billing:test",
      deltaCredits: 8,
      balanceAfter: 8,
    });
    await db.insert(outreachAngles).values({
      tenantId: tenant.id,
      angleKey: "interview",
      name: "Interview",
      goal: "Invite feedback.",
      channels: ["email"],
      frameworks: ["problem_interview"],
      enabled: true,
      enabledForReps: true,
    });

    const app = buildRouteOnlyApp(tenant.id);
    const res = await app.request("/api/outreach/co-123/angle-rebuild/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAngleKey: "direct",
        nextAngleKey: "interview",
        includedPeopleCount: 2,
      }),
    });

    expect(res.status).toBe(402);
    expect(await res.json()).toMatchObject({
      error: "insufficient_credits",
      currentBalance: 8,
    });

    const debitRows = await db
      .select()
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, tenant.id),
          eq(creditLedger.actionType, "outreach_angle_rebuild"),
        ),
      );
    expect(debitRows).toHaveLength(0);

    const usageRows = await db
      .select()
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.tenantId, tenant.id),
          eq(usageEvents.actionType, "outreach_angle_rebuild"),
        ),
      );
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]?.credits).toBe(0);
    expect(usageRows[0]?.projectedCredits).toBe(16);
    expect(usageRows[0]?.result).toBe("insufficient_credits");
  });

  it("blocks rep cap overages with an audit event and no debit", async () => {
    const tenant = await seedTenant();
    await db.insert(tenantUsers).values({
      tenantId: tenant.id,
      hubspotUserId: "u-1",
      appRole: "rep",
      dailyCreditCap: 8,
      weeklyCreditCap: 100,
      monthlyCreditCap: 100,
    });
    await db.insert(creditLedger).values({
      tenantId: tenant.id,
      hubspotUserId: "u-1",
      actionType: "topup",
      entityRef: "billing:test",
      deltaCredits: 100,
      balanceAfter: 100,
    });
    await db.insert(outreachAngles).values({
      tenantId: tenant.id,
      angleKey: "interview",
      name: "Interview",
      goal: "Invite feedback.",
      channels: ["email"],
      frameworks: ["problem_interview"],
      enabled: true,
      enabledForReps: true,
    });

    const app = buildRouteOnlyApp(tenant.id);
    const res = await app.request("/api/outreach/co-123/angle-rebuild/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        currentAngleKey: "direct",
        nextAngleKey: "interview",
        includedPeopleCount: 2,
      }),
    });

    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: "rep_credit_cap_exceeded",
      detail: "daily credit cap exceeded",
    });

    const debitRows = await db
      .select()
      .from(creditLedger)
      .where(
        and(
          eq(creditLedger.tenantId, tenant.id),
          eq(creditLedger.actionType, "outreach_angle_rebuild"),
        ),
      );
    expect(debitRows).toHaveLength(0);

    const usageRows = await db
      .select()
      .from(usageEvents)
      .where(
        and(
          eq(usageEvents.tenantId, tenant.id),
          eq(usageEvents.actionType, "outreach_angle_rebuild"),
        ),
      );
    expect(usageRows).toHaveLength(1);
    expect(usageRows[0]?.credits).toBe(0);
    expect(usageRows[0]?.projectedCredits).toBe(16);
    expect(usageRows[0]?.result).toBe("rep_credit_cap_exceeded");
  });
});
