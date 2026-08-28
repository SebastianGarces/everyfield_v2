CREATE TABLE "evry_conversation_artifacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"conversation_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"ordinal" integer NOT NULL,
	"kind" varchar(32) NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_conversation_artifacts_ordinal_check" CHECK ("evry_conversation_artifacts"."ordinal" >= 0),
	CONSTRAINT "evry_conversation_artifacts_kind_check" CHECK ("evry_conversation_artifacts"."kind" in ('read', 'clarification', 'settings_handoff', 'confirmation', 'progress', 'result', 'boundary')),
	CONSTRAINT "evry_conversation_artifacts_document_check" CHECK (jsonb_typeof("evry_conversation_artifacts"."document") = 'object' and "evry_conversation_artifacts"."document"->>'kind' = "evry_conversation_artifacts"."kind")
);
--> statement-breakpoint
CREATE TABLE "evry_conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"body_fingerprint" varchar(64) NOT NULL,
	"request_fingerprint" varchar(64) NOT NULL,
	"sequence" integer NOT NULL,
	"author" varchar(16) NOT NULL,
	"body" text NOT NULL,
	"page_context" jsonb,
	"relevance_keys" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"delivery_status" varchar(16) DEFAULT 'complete' NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_conversation_messages_sequence_check" CHECK ("evry_conversation_messages"."sequence" >= 0),
	CONSTRAINT "evry_conversation_messages_author_check" CHECK ("evry_conversation_messages"."author" in ('user', 'assistant')),
	CONSTRAINT "evry_conversation_messages_body_check" CHECK (length("evry_conversation_messages"."body") <= 8000),
	CONSTRAINT "evry_conversation_messages_fingerprint_check" CHECK ("evry_conversation_messages"."body_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_conversation_messages_request_fingerprint_check" CHECK ("evry_conversation_messages"."request_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_conversation_messages_page_context_check" CHECK ("evry_conversation_messages"."page_context" is null or jsonb_typeof("evry_conversation_messages"."page_context") = 'object'),
	CONSTRAINT "evry_conversation_messages_relevance_check" CHECK (jsonb_typeof("evry_conversation_messages"."relevance_keys") = 'array'),
	CONSTRAINT "evry_conversation_messages_delivery_check" CHECK ("evry_conversation_messages"."delivery_status" in ('complete', 'interrupted'))
);
--> statement-breakpoint
CREATE TABLE "evry_conversation_states" (
	"conversation_id" uuid PRIMARY KEY NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"document" jsonb NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_conversation_states_version_check" CHECK ("evry_conversation_states"."version" >= 0),
	CONSTRAINT "evry_conversation_states_document_check" CHECK (jsonb_typeof("evry_conversation_states"."document") = 'object')
);
--> statement-breakpoint
CREATE TABLE "evry_conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"title" varchar(160) NOT NULL,
	"next_message_sequence" integer DEFAULT 0 NOT NULL,
	"active_plan_id" uuid,
	"active_plan_fingerprint" varchar(64),
	"created_at" timestamp with time zone NOT NULL,
	"last_activity_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_conversations_title_check" CHECK (length(btrim("evry_conversations"."title")) between 1 and 160),
	CONSTRAINT "evry_conversations_sequence_check" CHECK ("evry_conversations"."next_message_sequence" >= 0),
	CONSTRAINT "evry_conversations_activity_check" CHECK ("evry_conversations"."last_activity_at" >= "evry_conversations"."created_at"),
	CONSTRAINT "evry_conversations_active_plan_shape_check" CHECK (("evry_conversations"."active_plan_id" is null and "evry_conversations"."active_plan_fingerprint" is null)
        or ("evry_conversations"."active_plan_id" is not null and "evry_conversations"."active_plan_fingerprint" is not null and "evry_conversations"."active_plan_fingerprint" ~ '^[0-9a-f]{64}$'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evry_conversation_messages_exact_identity_unique_idx" ON "evry_conversation_messages" USING btree ("id","conversation_id","church_id","actor_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_conversations_exact_identity_unique_idx" ON "evry_conversations" USING btree ("id","church_id","actor_user_id");--> statement-breakpoint
ALTER TABLE "evry_conversation_artifacts" ADD CONSTRAINT "evry_conversation_artifacts_message_fk" FOREIGN KEY ("message_id","conversation_id","church_id","actor_user_id") REFERENCES "public"."evry_conversation_messages"("id","conversation_id","church_id","actor_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_conversation_messages" ADD CONSTRAINT "evry_conversation_messages_conversation_fk" FOREIGN KEY ("conversation_id","church_id","actor_user_id") REFERENCES "public"."evry_conversations"("id","church_id","actor_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_conversation_states" ADD CONSTRAINT "evry_conversation_states_conversation_fk" FOREIGN KEY ("conversation_id","church_id","actor_user_id") REFERENCES "public"."evry_conversations"("id","church_id","actor_user_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_conversations" ADD CONSTRAINT "evry_conversations_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_conversations" ADD CONSTRAINT "evry_conversations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_conversations" ADD CONSTRAINT "evry_conversations_active_plan_fk" FOREIGN KEY ("active_plan_id","church_id","actor_user_id","active_plan_fingerprint") REFERENCES "public"."evry_action_plans"("id","church_id","actor_user_id","fingerprint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evry_conversation_artifacts_message_ordinal_unique_idx" ON "evry_conversation_artifacts" USING btree ("message_id","ordinal");--> statement-breakpoint
CREATE INDEX "evry_conversation_artifacts_scope_idx" ON "evry_conversation_artifacts" USING btree ("church_id","actor_user_id","conversation_id","message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_conversation_messages_sequence_unique_idx" ON "evry_conversation_messages" USING btree ("conversation_id","sequence");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_conversation_messages_request_unique_idx" ON "evry_conversation_messages" USING btree ("church_id","actor_user_id","request_key");--> statement-breakpoint
CREATE INDEX "evry_conversation_messages_scope_time_idx" ON "evry_conversation_messages" USING btree ("church_id","actor_user_id","conversation_id","created_at");--> statement-breakpoint
CREATE INDEX "evry_conversations_actor_activity_idx" ON "evry_conversations" USING btree ("church_id","actor_user_id","last_activity_at");
