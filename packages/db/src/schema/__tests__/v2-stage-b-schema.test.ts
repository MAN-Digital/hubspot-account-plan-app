import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../schema";
import {
  accountResearch,
  buyingGroups,
  creditLedger,
  notificationSettings,
  outreachConfig,
  outreachDrafts,
  snapshots,
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
  if (value === undefined) {
    throw new Error(`Expected ${label} to be defined`);
  }
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

describe("v2 stage-b schema foundation", () => {
  it("persists the account workspace, outreach, notification, team, usage, and warm-intro records", async () => {
    const tenantId = await createTenant("V2 Schema Tenant");

    const [snapshot] = await db
      .insert(snapshots)
      .values({
        tenantId,
        companyId: "company-123",
        eligibilityState: "eligible",
        reasonToContact: "New role-change signal",
        stateFlags: {},
      })
      .returning();
    const snapshotId = required(snapshot, "snapshot").id;

    const [research] = await db
      .insert(accountResearch)
      .values({
        tenantId,
        companyId: "company-123",
        status: "completed",
        sections: { initiative: "Modernization" },
        sources: [{ source: "exa", url: "https://example.com" }],
        generatedBy: { provider: "openai", model: "gpt-5-mini" },
      })
      .returning();
    expect(research?.tenantId).toBe(tenantId);
    expect(research?.sections).toEqual({ initiative: "Modernization" });
    expect(research?.sources).toEqual([{ source: "exa", url: "https://example.com" }]);
    expect(research?.createdAt).toBeInstanceOf(Date);

    const [draft] = await db
      .insert(outreachDrafts)
      .values({
        tenantId,
        companyId: "company-123",
        snapshotId,
        envelope: { account: "company-123" },
        cadence: { touches: [] },
        copy: { people: [] },
        qa: { status: "pending" },
      })
      .returning();
    expect(draft?.status).toBe("draft");
    expect(draft?.snapshotId).toBe(snapshotId);

    const [config] = await db
      .insert(outreachConfig)
      .values({
        tenantId,
        positioning: { valueProp: "Reduce risk" },
        vocabulary: { frameworks: ["direct"] },
        frameworks: { direct: { enabled: true } },
        angles: [{ id: "direct", enabled: true }],
        exportProvider: "woodpecker_email_linkedin",
      })
      .returning();
    expect(config?.tenantId).toBe(tenantId);
    expect(config?.settings).toEqual({});

    const [buyingGroup] = await db
      .insert(buyingGroups)
      .values({
        tenantId,
        companyId: "company-123",
        roles: [{ role: "economic_buyer", contactId: "contact-1" }],
        edits: [{ action: "assigned_role", by: "user-1" }],
      })
      .returning();
    expect(buyingGroup?.roles).toEqual([{ role: "economic_buyer", contactId: "contact-1" }]);

    const [notifications] = await db
      .insert(notificationSettings)
      .values({ tenantId, enabled: true, propertyWritesEnabled: false })
      .returning();
    expect(notifications?.minTier).toBe("A");
    expect(notifications?.propertyWritesEnabled).toBe(false);

    const [tenantUser] = await db
      .insert(tenantUsers)
      .values({
        tenantId,
        hubspotUserId: "101",
        email: "rep@example.com",
        firstName: "Ria",
        lastName: "Rep",
      })
      .returning();
    expect(tenantUser?.appRole).toBe("rep");
    expect(tenantUser?.appAccessEnabled).toBe(false);

    const [ledger] = await db
      .insert(creditLedger)
      .values({
        tenantId,
        hubspotUserId: "101",
        entryType: "debit",
        actionType: "account_research",
        entityRef: "company-123",
        credits: 12,
        result: "applied",
      })
      .returning();
    expect(ledger?.credits).toBe(12);

    const [usage] = await db
      .insert(usageEvents)
      .values({
        tenantId,
        hubspotUserId: "101",
        actionType: "account_research",
        entityType: "company",
        entityId: "company-123",
        credits: 12,
        result: "applied",
      })
      .returning();
    expect(usage?.metadata).toEqual({});

    const [warmIntro] = await db
      .insert(warmIntros)
      .values({
        tenantId,
        companyId: "company-123",
        targetContactId: "contact-1",
        mutualConnections: [
          { name: "Connector", linkedinUrl: "https://www.linkedin.com/in/connector" },
        ],
        introRequests: [{ connector: "Connector", status: "draft" }],
      })
      .returning();
    expect(warmIntro?.mutualConnections).toEqual([
      { name: "Connector", linkedinUrl: "https://www.linkedin.com/in/connector" },
    ]);
  });

  it("cascades every v2 tenant-owned table when the tenant is deleted", async () => {
    const tenantId = await createTenant("V2 Cascade Tenant");

    await db.insert(accountResearch).values({
      tenantId,
      companyId: "cascade-company",
      status: "completed",
      sections: {},
      sources: [],
      generatedBy: {},
    });
    await db.insert(outreachConfig).values({ tenantId });
    await db.insert(notificationSettings).values({ tenantId });
    await db.insert(tenantUsers).values({
      tenantId,
      hubspotUserId: "202",
      email: "cascade@example.com",
    });
    await db.insert(usageEvents).values({
      tenantId,
      hubspotUserId: "202",
      actionType: "blocked_action",
      entityType: "company",
      entityId: "cascade-company",
      result: "blocked",
    });

    await db.delete(tenants).where(eq(tenants.id, tenantId));

    await expect(
      db.select().from(accountResearch).where(eq(accountResearch.tenantId, tenantId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(outreachConfig).where(eq(outreachConfig.tenantId, tenantId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(notificationSettings).where(eq(notificationSettings.tenantId, tenantId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(tenantUsers).where(eq(tenantUsers.tenantId, tenantId)),
    ).resolves.toHaveLength(0);
    await expect(
      db.select().from(usageEvents).where(eq(usageEvents.tenantId, tenantId)),
    ).resolves.toHaveLength(0);
  });
});
