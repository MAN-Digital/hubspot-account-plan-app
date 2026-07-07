import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Supabase advisor fix (2026-07-07): `tenants` was the only public table with
 * RLS disabled (deliberately skipped in 0007 as the bootstrap lookup), which
 * left it exposed through PostgREST's default anon/authenticated grants.
 *
 * Migration 0012 contract:
 *  - RLS ENABLED on tenants (no FORCE: the owner runs migrations and the
 *    pre-context bootstrap path; hap_app gets a role-scoped allow policy).
 *  - hap_app can still read tenants WITHOUT app.tenant_id set (bootstrap).
 *  - anon/authenticated hold NO table grants in public (PostgREST dark).
 *    Locally those roles may not exist — the assertion is then vacuous, the
 *    real check runs against the Supabase database.
 */

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const sql = postgres(DATABASE_URL, { max: 2 });

beforeAll(async () => {
  await sql`SELECT 1`;
});

afterAll(async () => {
  await sql.end();
});

describe("tenants RLS + REST grant revocation (migration 0012)", () => {
  it("tenants has row-level security enabled", async () => {
    const rows = await sql`
      SELECT c.relrowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname = 'tenants'`;
    expect(rows[0]?.relrowsecurity).toBe(true);
  });

  it("tenants has a role-scoped allow policy for hap_app", async () => {
    const rows = await sql`
      SELECT policyname, roles::text AS roles FROM pg_policies
      WHERE schemaname = 'public' AND tablename = 'tenants'`;
    const hapPolicy = rows.find((r) => r.roles.includes("hap_app"));
    expect(hapPolicy).toBeDefined();
  });

  it("hap_app reads tenants WITHOUT tenant context (bootstrap path)", async () => {
    await sql.begin(async (tx) => {
      await tx`SET LOCAL ROLE hap_app`;
      const rows = await tx`SELECT count(*)::int AS n FROM tenants`;
      expect(Number(rows[0]?.n)).toBeGreaterThanOrEqual(0);
    });
  });

  it("anon/authenticated hold no table grants in public schema", async () => {
    const rows = await sql`
      SELECT count(*)::int AS n FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')`;
    expect(Number(rows[0]?.n)).toBe(0);
  });
});
