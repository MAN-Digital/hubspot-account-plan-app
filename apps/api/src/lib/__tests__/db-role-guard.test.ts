import { createDatabase, type Database } from "@hap/db";
import { describe, expect, it, vi } from "vitest";
import {
  assertDbRoleEnforcesRls,
  DbRoleSecurityError,
  fetchCurrentRoleAttributes,
  roleEnforcesRls,
} from "../db-role-guard";

const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://hap:hap_local_dev@localhost:5433/hap_dev";

const db: Database = createDatabase(DATABASE_URL);

describe("roleEnforcesRls (pure predicate)", () => {
  it("is true only when the role is neither superuser nor BYPASSRLS", () => {
    expect(roleEnforcesRls({ rolsuper: false, rolbypassrls: false })).toBe(true);
  });

  it("is false for a superuser (superusers bypass RLS unconditionally)", () => {
    // A superuser bypasses RLS even when rolbypassrls is false — this is the
    // exact trap the production `postgres.<ref>` role falls into.
    expect(roleEnforcesRls({ rolsuper: true, rolbypassrls: false })).toBe(false);
  });

  it("is false for an explicit BYPASSRLS role", () => {
    expect(roleEnforcesRls({ rolsuper: false, rolbypassrls: true })).toBe(false);
  });

  it("is false when both attributes are set", () => {
    expect(roleEnforcesRls({ rolsuper: true, rolbypassrls: true })).toBe(false);
  });
});

describe("fetchCurrentRoleAttributes (DB-backed)", () => {
  it("reads rolsuper/rolbypassrls for the connected role", async () => {
    const attrs = await fetchCurrentRoleAttributes(db);
    // The local/CI dev role is a superuser, so the guard must see it as
    // non-enforcing. This is the whole point of the guard.
    expect(typeof attrs.rolsuper).toBe("boolean");
    expect(typeof attrs.rolbypassrls).toBe("boolean");
    expect(roleEnforcesRls(attrs)).toBe(false);
  });
});

describe("assertDbRoleEnforcesRls", () => {
  it("throws DbRoleSecurityError when enforcing under a bypass role", async () => {
    await expect(assertDbRoleEnforcesRls(db, { enforce: true })).rejects.toBeInstanceOf(
      DbRoleSecurityError,
    );
  });

  it("does not throw but warns when enforcement is disabled", async () => {
    const logger = vi.fn();
    await expect(assertDbRoleEnforcesRls(db, { enforce: false, logger })).resolves.toBeUndefined();
    expect(logger).toHaveBeenCalledOnce();
    expect(logger.mock.calls[0]?.[0]).toContain("bypasses Row Level Security");
  });
});
