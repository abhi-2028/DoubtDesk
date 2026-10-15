import { and, eq, gte, gt, lt, sql } from "drizzle-orm";
import { db } from "@/configs/db";
import {
  aiUsageReservationsTable,
  aiUsageTable,
} from "@/configs/schema";

type UsagePeriod = "daily" | "monthly";
type QueryDb = Pick<typeof db, "select">;

export type AiUsageIdentity =
  | { userEmail: string }
  | { anonymousId: string };

export type AiUsageReservation = {
  id: number;
  identity: AiUsageIdentity;
};

const DEFAULT_DAILY_TOKEN_LIMIT = 50_000;
const DEFAULT_MONTHLY_TOKEN_LIMIT = 500_000;
const DEFAULT_RESERVATION_TOKENS = 5_000;

function getLimit(name: string, fallback: number): number | null {
  const value = process.env[name]?.trim().toLowerCase();
  if (value === "0" || value === "unlimited") return null;
  const parsed = Number(value ?? fallback);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function getPeriodBounds(period: UsagePeriod, now = new Date()) {
  const start = new Date(now);
  if (period === "daily") {
    start.setUTCHours(0, 0, 0, 0);
  } else {
    start.setUTCDate(1);
    start.setUTCHours(0, 0, 0, 0);
  }

  const end = new Date(start);
  if (period === "daily") end.setUTCDate(end.getUTCDate() + 1);
  else end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

function identityCondition(table: typeof aiUsageTable | typeof aiUsageReservationsTable, identity: AiUsageIdentity) {
  return "userEmail" in identity
    ? eq(table.userEmail, identity.userEmail)
    : eq(table.anonymousId, identity.anonymousId);
}

async function sumUsage(queryDb: QueryDb, identity: AiUsageIdentity, period: UsagePeriod, now: Date) {
  const { start, end } = getPeriodBounds(period, now);
  const [result] = await queryDb
    .select({ total: sql<number>`coalesce(sum(${aiUsageTable.tokensUsed}), 0)` })
    .from(aiUsageTable)
    .where(and(
      identityCondition(aiUsageTable, identity),
      gte(aiUsageTable.timestamp, start),
      lt(aiUsageTable.timestamp, end),
    ));
  return Number(result?.total ?? 0);
}

async function sumReservations(queryDb: QueryDb, identity: AiUsageIdentity, period: UsagePeriod, now: Date) {
  const { start, end } = getPeriodBounds(period, now);
  const [result] = await queryDb
    .select({ total: sql<number>`coalesce(sum(${aiUsageReservationsTable.reservedTokens}), 0)` })
    .from(aiUsageReservationsTable)
    .where(and(
      identityCondition(aiUsageReservationsTable, identity),
      gte(aiUsageReservationsTable.createdAt, start),
      lt(aiUsageReservationsTable.createdAt, end),
      gt(aiUsageReservationsTable.expiresAt, now),
    ));
  return Number(result?.total ?? 0);
}

function identityKey(identity: AiUsageIdentity) {
  return "userEmail" in identity
    ? `user:${identity.userEmail}`
    : `anonymous:${identity.anonymousId}`;
}

export async function reserveAiUsage(
  identity: AiUsageIdentity,
  estimatedTokens = Number(process.env.AI_RESERVATION_TOKENS ?? DEFAULT_RESERVATION_TOKENS),
) {
  if (!Number.isSafeInteger(estimatedTokens) || estimatedTokens <= 0) {
    throw new Error("Invalid AI reservation token estimate");
  }

  const dailyLimit = getLimit("AI_DAILY_TOKEN_LIMIT", DEFAULT_DAILY_TOKEN_LIMIT);
  const monthlyLimit = getLimit("AI_MONTHLY_TOKEN_LIMIT", DEFAULT_MONTHLY_TOKEN_LIMIT);
  const now = new Date();

  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${identityKey(identity)}))`);
    await tx.delete(aiUsageReservationsTable).where(lt(aiUsageReservationsTable.expiresAt, now));

    for (const [period, limit] of [["daily", dailyLimit], ["monthly", monthlyLimit]] as const) {
      if (limit === null) continue;
      const used = await sumUsage(tx, identity, period, now);
      const reserved = await sumReservations(tx, identity, period, now);
      if (used + reserved + estimatedTokens > limit) {
        return { allowed: false as const, period, used: used + reserved, limit };
      }
    }

    const [row] = await tx.insert(aiUsageReservationsTable).values({
      ...identity,
      reservedTokens: estimatedTokens,
      expiresAt: new Date(now.getTime() + 5 * 60 * 1000),
    }).returning({ id: aiUsageReservationsTable.id });

    if (!row) throw new Error("Failed to create AI usage reservation");
    return {
      allowed: true as const,
      reservation: { id: row.id, identity },
    };
  });
}

export async function recordAiUsage(
  reservation: AiUsageReservation,
  details: { route: string; model: string; tokensUsed: number },
) {
  if (!Number.isSafeInteger(details.tokensUsed) || details.tokensUsed <= 0) {
    throw new Error("Missing or invalid AI token usage metadata");
  }

  await db.transaction(async (tx) => {
    const [active] = await tx.select({ id: aiUsageReservationsTable.id })
      .from(aiUsageReservationsTable)
      .where(eq(aiUsageReservationsTable.id, reservation.id))
      .limit(1);
    if (!active) throw new Error("AI usage reservation is no longer active");

    await tx.insert(aiUsageTable).values({
      ...reservation.identity,
      route: details.route,
      model: details.model,
      tokensUsed: details.tokensUsed,
    });
    await tx.delete(aiUsageReservationsTable)
      .where(eq(aiUsageReservationsTable.id, reservation.id));
  });
}

export async function releaseAiUsageReservation(reservation: AiUsageReservation) {
  await db.delete(aiUsageReservationsTable)
    .where(eq(aiUsageReservationsTable.id, reservation.id));
}

export async function checkAiUsageQuota(identity: AiUsageIdentity) {
  const dailyLimit = getLimit("AI_DAILY_TOKEN_LIMIT", DEFAULT_DAILY_TOKEN_LIMIT);
  const monthlyLimit = getLimit("AI_MONTHLY_TOKEN_LIMIT", DEFAULT_MONTHLY_TOKEN_LIMIT);
  const now = new Date();
  const dailyUsed = await sumUsage(db, identity, "daily", now);
  if (dailyLimit !== null && dailyUsed >= dailyLimit) {
    return { allowed: false as const, period: "daily" as const, used: dailyUsed, limit: dailyLimit };
  }
  const monthlyUsed = await sumUsage(db, identity, "monthly", now);
  if (monthlyLimit !== null && monthlyUsed >= monthlyLimit) {
    return { allowed: false as const, period: "monthly" as const, used: monthlyUsed, limit: monthlyLimit };
  }
  return { allowed: true as const };
}

export async function logAiUsage(args: {
  identity: AiUsageIdentity;
  route: string;
  model: string;
  tokensUsed: number;
}) {
  if (!Number.isFinite(args.tokensUsed) || args.tokensUsed < 0) {
    throw new Error("Invalid AI token usage");
  }
  await db.insert(aiUsageTable).values({
    ...args.identity,
    route: args.route,
    model: args.model,
    tokensUsed: Math.floor(args.tokensUsed),
  });
}
