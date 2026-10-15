import { db } from "@/configs/db";
import { aiUsageTable } from "@/configs/schema";
import { requireAdmin } from "@/lib/auth/requireAdmin";
import { buildErrorResponse, successResponse } from "@/lib/errors/error-handler";
import { count, desc, gte, sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

const MAX_DAYS = 365;

function parseDays(value: string | null): number {
  const days = Number(value ?? 30);
  if (!Number.isInteger(days) || days < 1) return 30;
  return Math.min(days, MAX_DAYS);
}

export async function GET(request: Request) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(request.url);
    const days = parseDays(searchParams.get("days"));
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const [summary, byUser, byRoute, byModel] = await Promise.all([
      db
        .select({
          calls: count(),
          tokens: sql<number>`coalesce(sum(${aiUsageTable.tokensUsed}), 0)`,
        })
        .from(aiUsageTable)
        .where(gte(aiUsageTable.timestamp, since)),
      db
        .select({
          userEmail: aiUsageTable.userEmail,
          calls: count(),
          tokens: sql<number>`coalesce(sum(${aiUsageTable.tokensUsed}), 0)`,
        })
        .from(aiUsageTable)
        .where(gte(aiUsageTable.timestamp, since))
        .groupBy(aiUsageTable.userEmail)
        .orderBy(desc(sql`sum(${aiUsageTable.tokensUsed})`)),
      db
        .select({
          route: aiUsageTable.route,
          calls: count(),
          tokens: sql<number>`coalesce(sum(${aiUsageTable.tokensUsed}), 0)`,
        })
        .from(aiUsageTable)
        .where(gte(aiUsageTable.timestamp, since))
        .groupBy(aiUsageTable.route)
        .orderBy(desc(sql`sum(${aiUsageTable.tokensUsed})`)),
      db
        .select({
          model: aiUsageTable.model,
          calls: count(),
          tokens: sql<number>`coalesce(sum(${aiUsageTable.tokensUsed}), 0)`,
        })
        .from(aiUsageTable)
        .where(gte(aiUsageTable.timestamp, since))
        .groupBy(aiUsageTable.model)
        .orderBy(desc(sql`sum(${aiUsageTable.tokensUsed})`)),
    ]);

    return successResponse({
      period: { days, since: since.toISOString() },
      summary: {
        calls: summary[0]?.calls ?? 0,
        tokens: Number(summary[0]?.tokens ?? 0),
      },
      byUser,
      byRoute,
      byModel,
    });
  } catch (error) {
    console.error("Error generating AI usage metrics:", error);
    if (error instanceof Error && error.message === "NEXT_REDIRECT") {
      throw error;
    }
    const { status, body } = buildErrorResponse(error);
    return new Response(JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
