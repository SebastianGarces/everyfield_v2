-- #776 EV-046 — durable active-run claims.
--
-- APPLY: normal `pnpm db:migrate` creates this metadata-only registry. It does
-- not copy conversation text, plan arguments, provider payloads, or results.
--
-- RETENTION: terminal rows are the request-key replay ledger and remain until
-- their owning user, plant, conversation, or plan is deleted. All four owning
-- foreign keys cascade, so the registry never blocks an owning-record delete.
-- Conversation expiry ends reconnect eligibility. Execution expiry is a
-- renewable version-fenced lease; neither permits request-key reuse.
-- No time-based cleanup removes this replay ledger.
--
-- ROLLBACK (run against an isolated database, in one transaction):
--   BEGIN;
--   DROP TABLE IF EXISTS evry_active_runs;
--   DELETE FROM drizzle.__drizzle_migrations
--   WHERE hash = '<sha256 of this exact migration file>';
--   COMMIT;
-- Never remove the journal entry to roll back an applied database. Reapplying
-- this migration after the rollback recreates only the empty registry.

CREATE TABLE "evry_active_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"kind" varchar(16) NOT NULL,
	"operation" varchar(16) NOT NULL,
	"status" varchar(16) NOT NULL,
	"stage" varchar(32) NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"conversation_id" uuid,
	"plan_id" uuid,
	"plan_fingerprint" varchar(64),
	"started_at" timestamp with time zone NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"completed_at" timestamp with time zone,
	CONSTRAINT "evry_active_runs_fingerprint_check" CHECK ("evry_active_runs"."request_fingerprint" ~ '^[0-9a-f]{64}$' and ("evry_active_runs"."plan_fingerprint" is null or "evry_active_runs"."plan_fingerprint" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "evry_active_runs_kind_check" CHECK ("evry_active_runs"."kind" in ('conversation', 'execution')),
	CONSTRAINT "evry_active_runs_operation_check" CHECK ("evry_active_runs"."operation" in ('create', 'continue', 'execute', 'retry')),
	CONSTRAINT "evry_active_runs_status_check" CHECK ("evry_active_runs"."status" in ('active', 'completed', 'failed')),
	CONSTRAINT "evry_active_runs_stage_check" CHECK ("evry_active_runs"."stage" in ('accepted', 'resolving_references', 'revalidating_plan', 'compiling_response', 'executing')),
	CONSTRAINT "evry_active_runs_version_check" CHECK ("evry_active_runs"."version" >= 0),
	CONSTRAINT "evry_active_runs_time_check" CHECK ("evry_active_runs"."changed_at" >= "evry_active_runs"."started_at" and (("evry_active_runs"."kind" = 'conversation' and "evry_active_runs"."expires_at" = "evry_active_runs"."started_at" + interval '15 minutes') or ("evry_active_runs"."kind" = 'execution' and "evry_active_runs"."expires_at" >= "evry_active_runs"."started_at" and ("evry_active_runs"."status" <> 'active' or "evry_active_runs"."expires_at" >= "evry_active_runs"."changed_at"))) and ("evry_active_runs"."completed_at" is null or "evry_active_runs"."completed_at" >= "evry_active_runs"."started_at")),
	CONSTRAINT "evry_active_runs_terminal_check" CHECK (("evry_active_runs"."status" = 'active' and "evry_active_runs"."completed_at" is null) or ("evry_active_runs"."status" in ('completed', 'failed') and "evry_active_runs"."completed_at" is not null)),
	CONSTRAINT "evry_active_runs_shape_check" CHECK ((
        "evry_active_runs"."kind" = 'conversation'
        and "evry_active_runs"."operation" in ('create', 'continue')
        and "evry_active_runs"."plan_id" is null
        and "evry_active_runs"."plan_fingerprint" is null
        and ("evry_active_runs"."operation" <> 'create' or "evry_active_runs"."status" <> 'active' or "evry_active_runs"."conversation_id" is null)
        and ("evry_active_runs"."operation" = 'create' or "evry_active_runs"."conversation_id" is not null)
        and "evry_active_runs"."stage" <> 'executing'
      ) or (
        "evry_active_runs"."kind" = 'execution'
        and "evry_active_runs"."operation" in ('execute', 'retry')
        and "evry_active_runs"."conversation_id" is not null
        and "evry_active_runs"."plan_id" is not null
        and "evry_active_runs"."plan_fingerprint" is not null
        and "evry_active_runs"."stage" = 'executing'
      )),
	CONSTRAINT "evry_active_runs_completed_conversation_check" CHECK ("evry_active_runs"."status" <> 'completed' or "evry_active_runs"."conversation_id" is not null)
);
--> statement-breakpoint
ALTER TABLE "evry_active_runs" ADD CONSTRAINT "evry_active_runs_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_active_runs" ADD CONSTRAINT "evry_active_runs_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_active_runs" ADD CONSTRAINT "evry_active_runs_conversation_fk" FOREIGN KEY ("conversation_id","church_id","actor_user_id") REFERENCES "public"."evry_conversations"("id","church_id","actor_user_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_active_runs" ADD CONSTRAINT "evry_active_runs_plan_fk" FOREIGN KEY ("plan_id","church_id","actor_user_id","plan_fingerprint") REFERENCES "public"."evry_action_plans"("id","church_id","actor_user_id","fingerprint") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evry_active_runs_scope_request_unique_idx" ON "evry_active_runs" USING btree ("church_id","actor_user_id","request_key");--> statement-breakpoint
CREATE INDEX "evry_active_runs_scope_status_idx" ON "evry_active_runs" USING btree ("church_id","actor_user_id","status","expires_at");
