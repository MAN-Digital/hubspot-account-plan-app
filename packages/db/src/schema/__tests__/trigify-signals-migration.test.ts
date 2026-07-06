import { randomUUID } from "node:crypto";
import { eq, like } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as schema from "../../schema";
import { companySignalMap, signals, tenants, trigifyMonitors } from "../../schema";

/**
 * Stage A Task 1 — verifies the new Trigify signal substrate tables:
 * `signals`, `company_signal_map`, `trigify_monitors`.
 *
 * Mirrors the fixture/portal-prefix pattern from slice3-migrations.test.ts.
 * RLS catalog-state assertions mirror slice3-phase3-migrations.test.ts.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 4 });
const db = drizzle(sql, { schema });

const PORTAL_PREFIX = `trigifysig-${randomUUID().slice(0, 8)}-`;

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
  const [t] = await db.insert(tenants).values({ hubspotPortalId: portalId(), name }).returning();
  return required(t, "tenant").id;
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

describe("trigify signal substrate: signals table", () => {
  it("inserts a minimal observable signal row with expected defaults", async () => {
    const tenantId = await createTenant("Signals-Tenant-A");

    const [row] = await db
      .insert(signals)
      .values({
        tenantId,
        dedupeKey: "trigify:person:abc123:T_Role_Change",
        source: "trigify",
        stream: "linkedin-profile",
        signalType: "changed_role",
        signalClass: "observable",
        tier: "A",
        level: "person",
        targetId: "urn:li:member:abc123",
        headline: "Jane Doe changed role to VP Sales",
        confidence: 0.9,
        raw: { rawPayload: true },
      })
      .returning();

    expect(row?.tenantId).toBe(tenantId);
    expect(row?.dedupeKey).toBe("trigify:person:abc123:T_Role_Change");
    expect(row?.source).toBe("trigify");
    expect(row?.signalClass).toBe("observable");
    expect(row?.tier).toBe("A");
    expect(row?.level).toBe("person");
    expect(row?.copyAssertable).toBe(true); // default true
    expect(row?.confidence).toBe(0.9);
    expect(row?.linkedinUrl).toBeNull();
    expect(row?.hsContactId).toBeNull();
    expect(row?.hsCompanyId).toBeNull();
    expect(row?.evidenceUrl).toBeNull();
    expect(row?.evidenceDate).toBeNull();
    expect(row?.observedAt).toBeInstanceOf(Date);
    expect(row?.allowedClaims).toEqual([]);
    expect(row?.raw).toEqual({ rawPayload: true });
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("stores a derived signal with copy_assertable=false and no evidence url", async () => {
    const tenantId = await createTenant("Signals-Tenant-B");

    const [row] = await db
      .insert(signals)
      .values({
        tenantId,
        dedupeKey: "trigify:person:def456:T_Buying_Window",
        source: "trigify",
        stream: "linkedin-profile",
        signalType: "buying_window",
        signalClass: "derived",
        tier: "A",
        level: "person",
        targetId: "urn:li:member:def456",
        headline: "Buying window inferred",
        confidence: 0.2,
        copyAssertable: false,
        raw: {},
      })
      .returning();

    expect(row?.signalClass).toBe("derived");
    expect(row?.copyAssertable).toBe(false);
    expect(row?.evidenceUrl).toBeNull();
  });

  it("enforces dedupe_key uniqueness per tenant", async () => {
    const tenantId = await createTenant("Signals-Tenant-C");
    const dedupeKey = "trigify:person:dup:T_Topic_Post";

    await db.insert(signals).values({
      tenantId,
      dedupeKey,
      source: "trigify",
      stream: "linkedin-posts",
      signalType: "posted_about_tracked_topic",
      signalClass: "observable",
      tier: "A",
      level: "person",
      targetId: "urn:li:member:dup",
      headline: "Posted about tracked topic",
      confidence: 0.8,
      raw: {},
    });

    await expect(
      db.insert(signals).values({
        tenantId,
        dedupeKey,
        source: "trigify",
        stream: "linkedin-posts",
        signalType: "posted_about_tracked_topic",
        signalClass: "observable",
        tier: "A",
        level: "person",
        targetId: "urn:li:member:dup",
        headline: "Duplicate insert",
        confidence: 0.8,
        raw: {},
      }),
    ).rejects.toThrow();
  });

  it("allows the same dedupe_key across two different tenants", async () => {
    const tenantA = await createTenant("Signals-Tenant-D1");
    const tenantB = await createTenant("Signals-Tenant-D2");
    const dedupeKey = "trigify:person:shared:T_Topic_Post";

    await db.insert(signals).values({
      tenantId: tenantA,
      dedupeKey,
      source: "trigify",
      stream: "linkedin-posts",
      signalType: "posted_about_tracked_topic",
      signalClass: "observable",
      tier: "A",
      level: "person",
      targetId: "urn:li:member:shared",
      headline: "Tenant A copy",
      confidence: 0.8,
      raw: {},
    });

    await db.insert(signals).values({
      tenantId: tenantB,
      dedupeKey,
      source: "trigify",
      stream: "linkedin-posts",
      signalType: "posted_about_tracked_topic",
      signalClass: "observable",
      tier: "A",
      level: "person",
      targetId: "urn:li:member:shared",
      headline: "Tenant B copy",
      confidence: 0.8,
      raw: {},
    });

    const rows = await db.select().from(signals).where(eq(signals.dedupeKey, dedupeKey));
    expect(rows).toHaveLength(2);
  });

  it("cascades on tenant delete", async () => {
    const tenantId = await createTenant("Signals-Tenant-E");

    await db.insert(signals).values({
      tenantId,
      dedupeKey: "trigify:person:cascade:T_Role_Change",
      source: "trigify",
      stream: "linkedin-profile",
      signalType: "changed_role",
      signalClass: "observable",
      tier: "A",
      level: "person",
      targetId: "urn:li:member:cascade",
      headline: "Cascade test",
      confidence: 0.9,
      raw: {},
    });

    await db.delete(tenants).where(eq(tenants.id, tenantId));

    const remaining = await db.select().from(signals).where(eq(signals.tenantId, tenantId));
    expect(remaining).toHaveLength(0);
  });
});

describe("trigify signal substrate: company_signal_map table", () => {
  it("inserts a linkedin-url-to-company mapping with a confidence score", async () => {
    const tenantId = await createTenant("CompanyMap-Tenant-A");

    const [row] = await db
      .insert(companySignalMap)
      .values({
        tenantId,
        linkedinUrl: "https://www.linkedin.com/company/acme-inc",
        domain: "acme.com",
        hsCompanyId: "12345",
        confidence: 0.95,
      })
      .returning();

    expect(row?.tenantId).toBe(tenantId);
    expect(row?.linkedinUrl).toBe("https://www.linkedin.com/company/acme-inc");
    expect(row?.domain).toBe("acme.com");
    expect(row?.hsCompanyId).toBe("12345");
    expect(row?.confidence).toBe(0.95);
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("cascades on tenant delete", async () => {
    const tenantId = await createTenant("CompanyMap-Tenant-B");

    await db.insert(companySignalMap).values({
      tenantId,
      linkedinUrl: "https://www.linkedin.com/company/cascade-inc",
      hsCompanyId: "999",
      confidence: 0.5,
    });

    await db.delete(tenants).where(eq(tenants.id, tenantId));

    const remaining = await db
      .select()
      .from(companySignalMap)
      .where(eq(companySignalMap.tenantId, tenantId));
    expect(remaining).toHaveLength(0);
  });
});

describe("trigify signal substrate: trigify_monitors table", () => {
  it("inserts a monitor row with dry-run defaults", async () => {
    const tenantId = await createTenant("Monitors-Tenant-A");

    const [row] = await db
      .insert(trigifyMonitors)
      .values({
        tenantId,
        monitorType: "linkedin-profile",
        targetUrl: "https://www.linkedin.com/in/janedoe",
        status: "active",
      })
      .returning();

    expect(row?.tenantId).toBe(tenantId);
    expect(row?.monitorType).toBe("linkedin-profile");
    expect(row?.targetUrl).toBe("https://www.linkedin.com/in/janedoe");
    expect(row?.status).toBe("active");
    expect(row?.creditsSpent).toBe(0);
    expect(row?.createdAt).toBeInstanceOf(Date);
  });

  it("cascades on tenant delete", async () => {
    const tenantId = await createTenant("Monitors-Tenant-B");

    await db.insert(trigifyMonitors).values({
      tenantId,
      monitorType: "linkedin-posts",
      targetUrl: "https://www.linkedin.com/company/cascade-inc",
      status: "active",
    });

    await db.delete(tenants).where(eq(tenants.id, tenantId));

    const remaining = await db
      .select()
      .from(trigifyMonitors)
      .where(eq(trigifyMonitors.tenantId, tenantId));
    expect(remaining).toHaveLength(0);
  });
});
