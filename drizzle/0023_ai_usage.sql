
CREATE TABLE IF NOT EXISTS "ai_usage" (
    "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "userEmail" varchar(255) NOT NULL,
    "route" varchar(255) NOT NULL,
    "model" varchar(255) NOT NULL,
    "tokensUsed" integer NOT NULL,
    "timestamp" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_user_timestamp_idx"
    ON "ai_usage" ("userEmail", "timestamp");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_timestamp_idx"
    ON "ai_usage" ("timestamp");
