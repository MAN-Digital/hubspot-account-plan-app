/**
 * Database role safety guard (C1 — RLS enforcement).
 *
 * Row Level Security policies (migration `0007_rls_policies.sql`) are the
 * database-level backstop for tenant isolation. They are ONLY enforced when
 * the connecting role neither is a superuser nor carries the `BYPASSRLS`
 * attribute:
 *   - A superuser bypasses RLS unconditionally (even with rolbypassrls=false).
 *   - A `BYPASSRLS` role bypasses every policy regardless of `FORCE ROW LEVEL
 *     SECURITY`.
 *
 * The Supabase project-level `postgres.<ref>` pooler role is BOTH a superuser
 * and BYPASSRLS, so connecting the production app as that role silently
 * defeats every tenant-isolation policy. This guard fails the process closed
 * in production when it detects such a role, turning a silent, invisible
 * security hole into a loud, un-missable boot failure.
 *
 * Break-glass override: set `HAP_ALLOW_DB_SUPERUSER=true` to downgrade the
 * production hard-stop to a warning (e.g. a one-off migration run).
 */

import { type Database, sql as drizzleSql } from "@hap/db";

export type DbRoleAttributes = {
  rolsuper: boolean;
  rolbypassrls: boolean;
};

export class DbRoleSecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DbRoleSecurityError";
  }
}

/**
 * A role enforces RLS only when it is neither a superuser nor BYPASSRLS.
 */
export function roleEnforcesRls(attrs: DbRoleAttributes): boolean {
  return !attrs.rolsuper && !attrs.rolbypassrls;
}

/**
 * Read the connected role's `rolsuper` / `rolbypassrls` attributes.
 */
export async function fetchCurrentRoleAttributes(db: Database): Promise<DbRoleAttributes> {
  const rows = await db.execute<DbRoleAttributes>(
    drizzleSql`select rolsuper, rolbypassrls from pg_roles where rolname = current_user`,
  );
  const row = rows[0];
  if (!row) {
    throw new DbRoleSecurityError(
      "could not resolve current database role attributes from pg_roles",
    );
  }
  return {
    rolsuper: row.rolsuper === true,
    rolbypassrls: row.rolbypassrls === true,
  };
}

export interface AssertDbRoleOptions {
  /**
   * Whether to enforce (throw) rather than warn. Defaults to:
   *   NODE_ENV === "production" && HAP_ALLOW_DB_SUPERUSER !== "true".
   */
  enforce?: boolean;
  /** Injectable logger for the non-enforcing warning path. */
  logger?: (message: string) => void;
}

/**
 * Fail-closed check that the connected role actually enforces RLS.
 *
 * In production (unless `HAP_ALLOW_DB_SUPERUSER=true`) a bypass role throws
 * {@link DbRoleSecurityError}. In dev/test the local role is typically a
 * superuser, so the default is warn-only to avoid breaking local workflows.
 */
export async function assertDbRoleEnforcesRls(
  db: Database,
  options: AssertDbRoleOptions = {},
): Promise<void> {
  const enforce =
    options.enforce ??
    (process.env.NODE_ENV === "production" && process.env.HAP_ALLOW_DB_SUPERUSER !== "true");
  const warn = options.logger ?? ((message: string) => console.warn(message));

  const attrs = await fetchCurrentRoleAttributes(db);
  if (roleEnforcesRls(attrs)) {
    return;
  }

  const detail =
    "database role bypasses Row Level Security " +
    `(rolsuper=${attrs.rolsuper}, rolbypassrls=${attrs.rolbypassrls}); ` +
    "tenant-isolation policies are INERT under this role";

  if (enforce) {
    throw new DbRoleSecurityError(detail);
  }
  warn(`db-role-guard: ${detail} — allowed because RLS-role enforcement is disabled`);
}
