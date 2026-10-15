// One limitation to address later: this first version checks existing usage before a request, so concurrent requests can race, and a single request can push usage beyond the limit. Strict quota enforcement requires reserving usage atomically before calling Groq.
import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/configs/db";
import { aiUsageTable } from "@/configs/schema";

const DAILY_TOKEN_LIMIT = Number(
  process.env.AI_DAILY_TOKEN_LIMIT ?? 50_000,
);

const MONTHLY_TOKEN_LIMIT = Number(
  process.env.AI_MONTHLY_TOKEN_LIMIT ?? 500_000,
);

type UsagePeriod = "daily" | "monthly";

function getPeriodStart(period: UsagePeriod): Date {
  const now = new Date();
  const start = new Date(now);

  if (period === "daily") {
    start.setHours(0, 0, 0, 0);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
  }

  return start;
}

async function getTokensUsed(
  userEmail: string,
  period: UsagePeriod,
): Promise<number> {
  const start = getPeriodStart(period);

  const [result] = await db
    .select({
      total: sql<number>`coalesce(sum(${aiUsageTable.tokensUsed}), 0)`,
    })
    .from(aiUsageTable)
    .where(
      and(
        eq(aiUsageTable.userEmail, userEmail),
        gte(aiUsageTable.timestamp, start),
        lt(aiUsageTable.timestamp, new Date()),
      ),
    );

  return Number(result?.total ?? 0);
}

export async function checkAiUsageQuota(userEmail: string) {
  const [dailyUsed, monthlyUsed] = await Promise.all([
    getTokensUsed(userEmail, "daily"),
    getTokensUsed(userEmail, "monthly"),
  ]);

  if (dailyUsed >= DAILY_TOKEN_LIMIT) {
    return {
      allowed: false,
      period: "daily" as const,
      used: dailyUsed,
      limit: DAILY_TOKEN_LIMIT,
    };
  }

  if (monthlyUsed >= MONTHLY_TOKEN_LIMIT) {
    return {
      allowed: false,
      period: "monthly" as const,
      used: monthlyUsed,
      limit: MONTHLY_TOKEN_LIMIT,
    };
  }

  return { allowed: true as const };
}

export async function logAiUsage({
  userEmail,
  route,
  model,
  tokensUsed,
}: {
  userEmail: string;
  route: string;
  model: string;
  tokensUsed: number;
}) {
  if (!Number.isFinite(tokensUsed) || tokensUsed < 0) {
    throw new Error("Invalid AI token usage");
  }

  await db.insert(aiUsageTable).values({
    userEmail,
    route,
    model,
    tokensUsed: Math.floor(tokensUsed),
  });
}
