import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import * as schema from "../../schema";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 2 });
drizzle(sql, { schema });

const V2_RLS_TABLES = [
  "account_research",
  "account_data_gaps",
  "account_generation_runs",
  "account_generation_line_items",
  "people_prospecting_runs",
  "people_prospecting_candidates",
  "outreach_drafts",
  "outreach_campaigns",
  "outreach_campaign_members",
  "outreach_config",
  "outreach_angles",
  "buying_groups",
  "hubspot_signal_rules",
  "tenant_users",
  "usage_events",
  "credit_ledger",
  "billing_topups",
  "warm_intros",
] as const;

const tableListSql = sql.unsafe(V2_RLS_TABLES.map((tableName) => `'${tableName}'`).join(", "));

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

describe("v2 workspace schema foundation: RLS catalog state", () => {
  it("enables and forces row level security on all V2 tenant-scoped tables", async () => {
    const rows = await sql<RlsCatalogRow[]>`
      SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c
      INNER JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public'
        AND c.relname IN (${tableListSql})
      ORDER BY c.relname
    `;

    expect(rows).toHaveLength(V2_RLS_TABLES.length);
    expect(rows.map((row) => row.relname)).toEqual([...V2_RLS_TABLES].sort());
    for (const row of rows) {
      expect(row.relrowsecurity, `${row.relname} should have RLS enabled`).toBe(true);
      expect(row.relforcerowsecurity, `${row.relname} should force RLS`).toBe(true);
    }
  });

  it("creates tenant-scoped ALL + INSERT policies for every V2 table", async () => {
    const rows = await sql<PolicyRow[]>`
      SELECT tablename, policyname, cmd, qual, with_check
      FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename IN (${tableListSql})
      ORDER BY tablename, policyname
    `;

    expect(rows).toHaveLength(V2_RLS_TABLES.length * 2);
    for (const tableName of V2_RLS_TABLES) {
      const tablePolicies = rows.filter((row) => row.tablename === tableName);
      expect(tablePolicies).toHaveLength(2);
      expect(tablePolicies.map((row) => row.cmd).sort()).toEqual(["ALL", "INSERT"]);
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

  it("grants hap_app DML on every V2 table", async () => {
    const rows = await sql<GrantRow[]>`
      SELECT table_name, privilege_type
      FROM information_schema.role_table_grants
      WHERE grantee = 'hap_app'
        AND table_schema = 'public'
        AND table_name IN (${tableListSql})
      ORDER BY table_name, privilege_type
    `;

    for (const tableName of V2_RLS_TABLES) {
      const tableGrants = rows
        .filter((row) => row.table_name === tableName)
        .map((row) => row.privilege_type);
      expect(tableGrants, `${tableName} should grant hap_app DML`).toEqual(
        expect.arrayContaining(["SELECT", "INSERT", "UPDATE", "DELETE"]),
      );
    }
  });
});
