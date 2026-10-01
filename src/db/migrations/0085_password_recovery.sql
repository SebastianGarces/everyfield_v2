CREATE TABLE "password_reset_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_hash" varchar(64) NOT NULL,
  "email_snapshot" varchar(255) NOT NULL,
  "password_hash_snapshot" varchar(255) NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_requests_token_hash_unique_idx" ON "password_reset_requests"("token_hash");
--> statement-breakpoint
CREATE UNIQUE INDEX "password_reset_requests_live_user_unique_idx" ON "password_reset_requests"("user_id") WHERE "consumed_at" IS NULL;
