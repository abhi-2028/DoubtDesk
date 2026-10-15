ALTER TABLE "ai_usage"
    ALTER COLUMN "userEmail" DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE "ai_usage"
    ADD COLUMN IF NOT EXISTS "anonymousId" varchar(255);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_anonymous_timestamp_idx"
    ON "ai_usage" ("anonymousId", "timestamp");
