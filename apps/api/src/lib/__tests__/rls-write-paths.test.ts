/**
 * C1 regression proof — the two write paths that touch FORCE-RLS tables must
 * set `app.tenant_id`, otherwise they break (INSERT) or silently no-op
 * (DELETE) the moment production stops connecting as a BYPASSRLS role.
 *
 * Unlike oauth.test.ts / tenant-tx.test.ts (which connect as the superuser dev
 * role and therefore never exercise RLS), this suite spins up a dedicated
 * LOGIN role with NOSUPERUSER NOBYPASSRLS and connects a second Drizzle handle
 * as that role — reproducing the production least-privilege posture. If a write
 * path forgets `app.tenant_id`, these tests fail.
 */
import { randomUUID } from "node:crypto";
import {
  createDatabase,
  type Database,
  sql as drizzleSql,
  eq,
  tenantHubspotOauth,
  tenants,
} from "@hap/db";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { deactivateTenant } from "../tenant-lifecycle.js";
import { withTenantTx } from "../tenant-tx.js";

const SUPERUSER_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";
const RLS_ROLE = "hap_rls_login";
const RLS_PASSWORD = "hap_rls_login_pw";

// Parse the superuser URL and swap credentials to build the least-privilege URL.
function buildRoleUrl(base: string, user: string, password: string): string {
  const u = new URL(base);
  u.username = user;
  u.password = password;
  return u.toString();
}

const superuserDb: Database = createDatabase(SUPERUSER_URL);
const appDb: Database = createDatabase(buildRoleUrl(SUPERUSER_URL, RLS_ROLE, RLS_PASSWORD));

const PORTAL_PREFIX = `rlswp-${randomUUID().slice(0, 8)}-`;

function portalId() {
  return `${PORTAL_PREFIX}${randomUUID().slice(0, 8)}`;
}

async function seedTenant(): Promise<string> {
  const [row] = await superuserDb
    .insert(tenants)
    .values({ hubspotPortalId: portalId(), name: "RLS write-path tenant" })
    .returning({ id: tenants.id });
  if (!row) throw new Error("failed to seed tenant");
  return row.id;
}

async function seedOauth(tenantId: string): Promise<void> {
  await superuserDb.insert(tenantHubspotOauth).values({
    tenantId,
    accessTokenEncrypted: "v1:aa:bb:cc",
    refreshTokenEncrypted: "v1:dd:ee:ff",
    expiresAt: new Date(Date.now() + 3_600_000),
    scopes: ["oauth"],
  });
}

beforeAll(async () => {
  await superuserDb.execute(
    drizzleSql.raw(`
    DO $$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${RLS_ROLE}') THEN
        CREATE ROLE ${RLS_ROLE} LOGIN PASSWORD '${RLS_PASSWORD}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
      END IF;
    END
    $$;
  `),
  );
  await superuserDb.execute(drizzleSql.raw(`GRANT USAGE ON SCHEMA public TO ${RLS_ROLE};`));
  await superuserDb.execute(
    drizzleSql.raw(
      `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${RLS_ROLE};`,
    ),
  );
  await superuserDb.execute(
    drizzleSql.raw(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ${RLS_ROLE};`),
  );
});

afterAll(async () => {
  await superuserDb
    .delete(tenants)
    .where(drizzleSql`${tenants.hubspotPortalId} like ${`${PORTAL_PREFIX}%`}`);
});

describe("RLS enforcement under a non-bypass role (proves C1 is real)", () => {
  it("a bare INSERT into tenant_hubspot_oauth is rejected without app.tenant_id", async () => {
    const tenantId = await seedTenant();
    // Without app.tenant_id the FORCE-RLS WITH CHECK denies the write. The
    // exact failure is Postgres-version-dependent (a clean RLS-violation, or a
    // 22P02 from casting the empty `app.tenant_id` GUC to uuid) — either way it
    // MUST reject rather than silently write to a table it has no tenant scope
    // for. That rejection is the security-meaningful behavior.
    await expect(
      appDb.insert(tenantHubspotOauth).values({
        tenantId,
        accessTokenEncrypted: "v1:aa:bb:cc",
        refreshTokenEncrypted: "v1:dd:ee:ff",
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: ["oauth"],
      }),
    ).rejects.toThrow();
  });
});

describe("OAuth callback write path (INSERT)", () => {
  it("succeeds under a non-bypass role when wrapped in withTenantTx", async () => {
    const tenantId = await seedTenant();

    await withTenantTx(appDb, tenantId, async (tx) => {
      await tx.insert(tenantHubspotOauth).values({
        tenantId,
        accessTokenEncrypted: "v1:aa:bb:cc",
        refreshTokenEncrypted: "v1:dd:ee:ff",
        expiresAt: new Date(Date.now() + 3_600_000),
        scopes: ["oauth"],
      });
    });

    const rows = await superuserDb
      .select({ tenantId: tenantHubspotOauth.tenantId })
      .from(tenantHubspotOauth)
      .where(eq(tenantHubspotOauth.tenantId, tenantId));
    expect(rows).toHaveLength(1);
  });
});

describe("lifecycle uninstall write path (DELETE)", () => {
  it("deletes ONLY the target tenant's oauth row under a non-bypass role", async () => {
    const tenantA = await seedTenant();
    const tenantB = await seedTenant();
    await seedOauth(tenantA);
    await seedOauth(tenantB);

    await deactivateTenant({
      db: appDb,
      tenantId: tenantA,
      reason: "hubspot_app_uninstalled",
    });

    const remaining = await superuserDb
      .select({ tenantId: tenantHubspotOauth.tenantId })
      .from(tenantHubspotOauth)
      .where(drizzleSql`${tenantHubspotOauth.tenantId} in (${tenantA}::uuid, ${tenantB}::uuid)`);

    // Tenant A's token row must be gone; tenant B's must survive. If the
    // DELETE ran without app.tenant_id, RLS would match zero rows and A's
    // row would still be present — this assertion catches that regression.
    expect(remaining.map((r) => r.tenantId)).toEqual([tenantB]);

    const tenantARow = await superuserDb
      .select({ isActive: tenants.isActive })
      .from(tenants)
      .where(eq(tenants.id, tenantA));
    expect(tenantARow[0]?.isActive).toBe(false);
  });
});
