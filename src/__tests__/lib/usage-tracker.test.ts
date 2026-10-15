const selectResults: Array<{ total: number }> = [];
const insertValues = jest.fn().mockResolvedValue(undefined);

const createSelectQuery = (result: { total: number }) => {
  const query: any = {
    from: () => query,
    where: () => query,
    then: (resolve: (value: [{ total: number }]) => unknown) =>
      Promise.resolve(resolve([result])),
  };

  return query;
};

jest.mock("@/configs/db", () => ({
  db: {
    select: jest.fn(() => createSelectQuery(selectResults.shift() ?? { total: 0 })),
    insert: jest.fn(() => ({
      values: insertValues,
    })),
  },
}));

import { db } from "@/configs/db";
import { checkAiUsageQuota, logAiUsage } from "@/lib/ai/usage-tracker";

describe("AI usage tracker", () => {
  beforeEach(() => {
    selectResults.length = 0;
    insertValues.mockClear();
    (db.insert as jest.Mock).mockClear();
  });

  it("blocks an identity that has exhausted its daily quota", async () => {
    selectResults.push({ total: 50_000 }, { total: 50_000 });

    await expect(
      checkAiUsageQuota({ userEmail: "student@example.com" }),
    ).resolves.toEqual({
      allowed: false,
      period: "daily",
      used: 50_000,
      limit: 50_000,
    });
  });

  it("blocks an identity that has exhausted its monthly quota", async () => {
    selectResults.push({ total: 10_000 }, { total: 500_000 });

    await expect(
      checkAiUsageQuota({ userEmail: "student@example.com" }),
    ).resolves.toEqual({
      allowed: false,
      period: "monthly",
      used: 500_000,
      limit: 500_000,
    });
  });

  it("allows an anonymous identity below both quotas", async () => {
    selectResults.push({ total: 1_000 }, { total: 20_000 });

    await expect(
      checkAiUsageQuota({ anonymousId: "proxy:203.0.113.10" }),
    ).resolves.toEqual({ allowed: true });
  });

  it("records usage for an anonymous identity", async () => {
    await logAiUsage({
      identity: { anonymousId: "proxy:203.0.113.10" },
      route: "/api/doubts/check-similarity",
      model: "openai/gpt-oss-120b",
      tokensUsed: 123.9,
    });

    expect(insertValues).toHaveBeenCalledWith({
      anonymousId: "proxy:203.0.113.10",
      route: "/api/doubts/check-similarity",
      model: "openai/gpt-oss-120b",
      tokensUsed: 123,
    });
  });

  it("records usage for an authenticated identity", async () => {
    await logAiUsage({
      identity: { userEmail: "student@example.com" },
      route: "/api/ask-ai",
      model: "openai/gpt-oss-120b",
      tokensUsed: 250,
    });

    expect(insertValues).toHaveBeenCalledWith({
      userEmail: "student@example.com",
      route: "/api/ask-ai",
      model: "openai/gpt-oss-120b",
      tokensUsed: 250,
    });
  });

  it("rejects invalid token usage instead of writing a record", async () => {
    await expect(
      logAiUsage({
        identity: { userEmail: "student@example.com" },
        route: "/api/ask-ai",
        model: "openai/gpt-oss-120b",
        tokensUsed: Number.NaN,
      }),
    ).rejects.toThrow("Invalid AI token usage");

    expect(insertValues).not.toHaveBeenCalled();
    expect(db.insert).not.toHaveBeenCalled();
  });
});
