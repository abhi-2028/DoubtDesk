CREATE TABLE IF NOT EXISTS "ai_usage_reservations" (
    "id" integer PRIMARY KEY GENERATED ALWAYS AS IDENTITY,
    "userEmail" varchar(255),
    "anonymousId" varchar(255),
    "reservedTokens" integer NOT NULL CHECK ("reservedTokens" > 0),
    "expiresAt" timestamptz NOT NULL,
    "createdAt" timestamptz DEFAULT now() NOT NULL,
    CONSTRAINT "ai_usage_reservations_identity_check"
        CHECK (("userEmail" IS NOT NULL)::int + ("anonymousId" IS NOT NULL)::int = 1)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_reservations_identity_idx"
    ON "ai_usage_reservations" ("userEmail", "anonymousId");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "ai_usage_reservations_expires_at_idx"
    ON "ai_usage_reservations" ("expiresAt");
