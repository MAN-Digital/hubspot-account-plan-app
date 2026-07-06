import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../schema";

/**
 * Stage A Task 1 — verifies the Trigify signal substrate migration enables
 * and forces RLS on `signals`, `company_signal_map`, `trigify_monitors`,
 * mirroring the catalog-state assertions in slice3-phase3-migrations.test.ts
 * for the original 7 tenant-scoped tables (migration 0007).
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 2 });
drizzle(sql, { schema });

const RLS_TABLES = ["signals", "company_signal_map", "trigify_monitors"] as const;
const rlsTableListSql = sql.unsafe(RLS_TABLES.map((tableName) => `'${tableName}'`).join(", "));

type RlsCatalogRow = {
  relname: string;
  relrowsecurity: boolean;
  relforcerowsecurity: boolean;
};

type PolicyRow = {
  tablename: string;
  policyname: string;
  cmd: string;
  qual: string | null;
  with_check: string | null;
};

type GrantRow = {
  table_name: string;
  privilege_type: string;
};

beforeAll(async () => {
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end({ timeout: 5 });
});

describe("trigify signal substrate: RLS catalog state", () => {
  it("enables and forces row level security on all three new tables", async () => {
    const rows = await sql<RlsCatalogRow[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (${rlsTableListSql})
      ORDER BY c.relname
    `;

    expect(rows).toHaveLength(RLS_TABLES.length);
    expect(rows.map((row) => row.relname)).toEqual([...RLS_TABLES].sort());

    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} should have RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} should force RLS for owner`).toBe(true);
    }
  });

  it("creates tenant-scoped ALL + INSERT policies for every new table", async () => {
    const rows = await sql<PolicyRow[]>`
      SELECT tablename, policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (${rlsTableListSql})
      ORDER BY tablename, policyname
    `;

    expect(rows).toHaveLength(RLS_TABLES.length * 2);

    for (const tableName of RLS_TABLES) {
      const tablePolicies = rows.filter((row) => row.tablename === tableName);
      expect(tablePolicies).toHaveLength(2);

      const commands = tablePolicies.map((row) => row.cmd).sort();
      expect(commands).toEqual(["ALL", "INSERT"]);

      for (const policy of tablePolicies) {
        if (policy.cmd === "ALL") {
          expect(policy.qual).toContain("current_setting('app.tenant_id'");
        }
        if (policy.cmd === "INSERT") {
          expect(policy.with_check).toContain("current_setting('app.tenant_id'");
        }
      }
    }
  });

  it("grants the least-privilege hap_app role DML on all three new tables", async () => {
    const rows = await sql<GrantRow[]>`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'hap_app'
        AND table_schema = 'public'
        AND table_name IN (${rlsTableListSql})
      ORDER BY table_name, privilege_type
    `;

    for (const tableName of RLS_TABLES) {
      const tableGrants = rows
        .filter((row) => row.table_name === tableName)
        .map((r) => r.privilege_type);
      expect(tableGrants, `${tableName} should grant hap_app DML`).toEqual(
        expect.arrayContaining(["SELECT", "INSERT", "UPDATE", "DELETE"]),
      );
    }
  });
});
