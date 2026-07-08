import type { Database } from "@hap/db";
import { creditLedger, outreachAngles, outreachDrafts, tenantUsers, usageEvents } from "@hap/db";
import { and, eq, gte } from "drizzle-orm";
import type { Context } from "hono";
import { Hono } from "hono";
import type { TenantVariables } from "../middleware/tenant.js";

type Vars = TenantVariables & { userId?: string };

const OUTREACH_CADENCE_CREDIT_COST = 8;
const MAX_INCLUDED_PEOPLE = 50;

type AngleRebuildBody = {
  currentAngleKey?: unknown;
  nextAngleKey?: unknown;
  includedPeople?: unknown;
  includedPeopleCount?: unknown;
  draftId?: unknown;
};

type ParsedAngleRebuildBody = {
  currentAngleKey: string;
  nextAngleKey: string;
  includedPeopleCount: number;
  draftId?: string;
};

export const outreachRoutes = new Hono<{ Variables: Vars }>();

function normalizeCompanyId(raw: string): string | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > 128) return null;
  if (!/^[A-Za-z0-9._-]+$/.test(trimmed)) return null;
  return trimmed;
}

function isValidKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._-]{1,128}$/.test(value.trim());
}

function includedPeopleCount(body: AngleRebuildBody): number | null {
  if (Array.isArray(body.includedPeople)) {
    if (body.includedPeople.length > MAX_INCLUDED_PEOPLE) return null;
    for (const person of body.includedPeople) {
      if (!person || typeof person !== "object") return null;
      const id = (person as { id?: unknown }).id;
      if (typeof id !== "string" || id.trim().length === 0 || id.length > 128) return null;
    }
    return body.includedPeople.length;
  }
  if (Number.isInteger(body.includedPeopleCount)) {
    const count = Number(body.includedPeopleCount);
    if (count < 0 || count > MAX_INCLUDED_PEOPLE) return null;
    return count;
  }
  return null;
}

async function parseJson(c: Context) {
  try {
    return (await c.req.json()) as AngleRebuildBody;
  } catch {
    return null;
  }
}

function parseAngleRebuildBody(body: AngleRebuildBody): ParsedAngleRebuildBody | null {
  if (!isValidKey(body.currentAngleKey) || !isValidKey(body.nextAngleKey)) return null;
  const count = includedPeopleCount(body);
  if (count === null) return null;
  const draftId =
    typeof body.draftId === "string" && body.draftId.length > 0 ? body.draftId : undefined;
  return {
    currentAngleKey: body.currentAngleKey.trim(),
    nextAngleKey: body.nextAngleKey.trim(),
    includedPeopleCount: count,
    draftId,
  };
}

function buildQuote(companyId: string, parsed: ParsedAngleRebuildBody) {
  const requiresRebuild = parsed.currentAngleKey !== parsed.nextAngleKey;
  const projectedCredits = requiresRebuild
    ? parsed.includedPeopleCount * OUTREACH_CADENCE_CREDIT_COST
    : 0;
  return {
    companyId,
    currentAngleKey: parsed.currentAngleKey,
    nextAngleKey: parsed.nextAngleKey,
    includedPeopleCount: parsed.includedPeopleCount,
    unitCredits: OUTREACH_CADENCE_CREDIT_COST,
    projectedCredits,
    requiresRebuild,
    debitRequired: projectedCredits > 0,
  };
}

async function getCurrentBalance(db: Database, tenantId: string): Promise<number> {
  const rows = await db.select().from(creditLedger).where(eq(creditLedger.tenantId, tenantId));
  return rows.reduce((sum, row) => sum + row.deltaCredits, 0);
}

function windowStart(period: "daily" | "weekly" | "monthly"): Date {
  const now = new Date();
  if (period === "daily") {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  }
  if (period === "weekly") {
    const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    const day = start.getUTCDay();
    const diff = day === 0 ? 6 : day - 1;
    start.setUTCDate(start.getUTCDate() - diff);
    return start;
  }
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

async function creditsUsedSince(
  db: Database,
  tenantId: string,
  hubspotUserId: string,
  since: Date,
): Promise<number> {
  const rows = await db
    .select()
    .from(usageEvents)
    .where(
      and(
        eq(usageEvents.tenantId, tenantId),
        eq(usageEvents.hubspotUserId, hubspotUserId),
        gte(usageEvents.createdAt, since),
      ),
    );
  return rows.reduce((sum, row) => sum + row.credits, 0);
}

async function validateActorBudget(
  db: Database,
  tenantId: string,
  hubspotUserId: string,
  projectedCredits: number,
): Promise<{ ok: true } | { ok: false; error: string; detail?: string }> {
  const [user] = await db
    .select()
    .from(tenantUsers)
    .where(and(eq(tenantUsers.tenantId, tenantId), eq(tenantUsers.hubspotUserId, hubspotUserId)))
    .limit(1);

  if (!user) {
    return { ok: false, error: "app_user_not_configured", detail: "tenant user is not configured" };
  }
  if (!user.appAccessEnabled) {
    return { ok: false, error: "app_access_disabled", detail: "tenant user access is disabled" };
  }
  if (user.uncapped || projectedCredits === 0) return { ok: true };

  const caps = [
    { period: "daily" as const, cap: user.dailyCreditCap },
    { period: "weekly" as const, cap: user.weeklyCreditCap },
    { period: "monthly" as const, cap: user.monthlyCreditCap },
  ];

  for (const { period, cap } of caps) {
    if (cap === null || cap === undefined) continue;
    const used = await creditsUsedSince(db, tenantId, hubspotUserId, windowStart(period));
    if (used + projectedCredits > cap) {
      return {
        ok: false,
        error: "rep_credit_cap_exceeded",
        detail: `${period} credit cap exceeded`,
      };
    }
  }
  return { ok: true };
}

async function resolveEnabledAngle(db: Database, tenantId: string, angleKey: string) {
  const [angle] = await db
    .select()
    .from(outreachAngles)
    .where(and(eq(outreachAngles.tenantId, tenantId), eq(outreachAngles.angleKey, angleKey)))
    .limit(1);
  return angle ?? null;
}

outreachRoutes.post("/:companyId/angle-rebuild/quote", async (c) => {
  const tenantId = c.get("tenantId");
  const db = c.get("db");
  const companyId = normalizeCompanyId(c.req.param("companyId"));
  if (!tenantId || !db) return c.json({ error: "tenant_context_missing" }, 500);
  if (!companyId) return c.json({ error: "invalid_company_id" }, 400);

  const raw = await parseJson(c);
  if (!raw) return c.json({ error: "invalid_json" }, 400);
  const parsed = parseAngleRebuildBody(raw);
  if (!parsed) return c.json({ error: "invalid_angle_rebuild_request" }, 400);

  const angle = await resolveEnabledAngle(db, tenantId, parsed.nextAngleKey);
  if (!angle) return c.json({ error: "angle_not_found" }, 404);
  if (!angle.enabled || !angle.enabledForReps) return c.json({ error: "angle_disabled" }, 403);

  return c.json(buildQuote(companyId, parsed), 200);
});

outreachRoutes.post("/:companyId/angle-rebuild/confirm", async (c) => {
  const tenantId = c.get("tenantId");
  const hubspotUserId = c.get("userId");
  const db = c.get("db");
  const companyId = normalizeCompanyId(c.req.param("companyId"));
  if (!tenantId || !db) return c.json({ error: "tenant_context_missing" }, 500);
  if (!hubspotUserId) return c.json({ error: "user_context_missing" }, 401);
  if (!companyId) return c.json({ error: "invalid_company_id" }, 400);

  const raw = await parseJson(c);
  if (!raw) return c.json({ error: "invalid_json" }, 400);
  const parsed = parseAngleRebuildBody(raw);
  if (!parsed) return c.json({ error: "invalid_angle_rebuild_request" }, 400);

  const angle = await resolveEnabledAngle(db, tenantId, parsed.nextAngleKey);
  if (!angle) return c.json({ error: "angle_not_found" }, 404);
  if (!angle.enabled || !angle.enabledForReps) return c.json({ error: "angle_disabled" }, 403);

  const quote = buildQuote(companyId, parsed);
  const metadata = {
    companyId,
    oldAngle: parsed.currentAngleKey,
    newAngle: parsed.nextAngleKey,
    includedPeopleCount: parsed.includedPeopleCount,
    draftId: parsed.draftId,
    unitCredits: OUTREACH_CADENCE_CREDIT_COST,
  };

  if (quote.projectedCredits === 0) {
    return c.json({ ...quote, debitedCredits: 0, status: "unchanged" }, 200);
  }

  const actorBudget = await validateActorBudget(
    db,
    tenantId,
    hubspotUserId,
    quote.projectedCredits,
  );
  if (!actorBudget.ok) {
    await db.insert(usageEvents).values({
      tenantId,
      hubspotUserId,
      actionType: "outreach_angle_rebuild",
      entityRef: `company:${companyId}`,
      projectedCredits: quote.projectedCredits,
      credits: 0,
      result: actorBudget.error,
      metadata,
    });
    return c.json(actorBudget, 403);
  }

  const currentBalance = await getCurrentBalance(db, tenantId);
  if (currentBalance < quote.projectedCredits) {
    await db.insert(usageEvents).values({
      tenantId,
      hubspotUserId,
      actionType: "outreach_angle_rebuild",
      entityRef: `company:${companyId}`,
      projectedCredits: quote.projectedCredits,
      credits: 0,
      result: "insufficient_credits",
      metadata: { ...metadata, currentBalance },
    });
    return c.json({ error: "insufficient_credits", currentBalance }, 402);
  }

  const balanceAfter = currentBalance - quote.projectedCredits;
  await db.insert(creditLedger).values({
    tenantId,
    hubspotUserId,
    actionType: "outreach_angle_rebuild",
    entityRef: `company:${companyId}`,
    deltaCredits: -quote.projectedCredits,
    balanceAfter,
    reason: "Campaign angle changed after outreach drafts existed",
    metadata,
  });
  await db.insert(usageEvents).values({
    tenantId,
    hubspotUserId,
    actionType: "outreach_angle_rebuild",
    entityRef: `company:${companyId}`,
    projectedCredits: quote.projectedCredits,
    credits: quote.projectedCredits,
    result: "debited",
    metadata: { ...metadata, balanceAfter },
  });

  if (parsed.draftId) {
    await db
      .update(outreachDrafts)
      .set({
        angleKey: parsed.nextAngleKey,
        status: "rebuild_requested",
        qa: {
          state: "stale",
          reason: "campaign_angle_changed",
          oldAngle: parsed.currentAngleKey,
          newAngle: parsed.nextAngleKey,
        },
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(outreachDrafts.tenantId, tenantId),
          eq(outreachDrafts.companyId, companyId),
          eq(outreachDrafts.id, parsed.draftId),
        ),
      );
  }

  return c.json(
    { ...quote, debitedCredits: quote.projectedCredits, balanceAfter, status: "rebuild_requested" },
    200,
  );
});
