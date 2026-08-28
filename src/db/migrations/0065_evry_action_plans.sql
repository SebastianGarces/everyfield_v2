-- EV-010 / EV-011: immutable action plans and exact human confirmations.
--
-- DDL delta: three tables, two immutable-row triggers, and one trigger
-- function. Plans and confirmations reject UPDATE/DELETE in Postgres; only the
-- separate lifecycle row may change. Composite foreign keys bind lifecycle,
-- lineage, and approval to their exact plant tuple. Every plan has the one
-- server policy lifetime: created_at + 15 minutes. A stable server request key
-- is the creation/revision retry arbiter; a fresh key permits an intentional
-- later plan with otherwise identical content.
--
-- Manual rollback, in dependency order:
--   DROP TABLE "evry_plan_confirmations";
--   DROP TABLE "evry_action_plan_states";
--   DROP TABLE "evry_action_plans";
--   DROP FUNCTION "evry_reject_immutable_row_mutation"();

CREATE TABLE "evry_action_plan_states" (
	"plan_id" uuid PRIMARY KEY NOT NULL,
	"church_id" uuid NOT NULL,
	"status" varchar(32) NOT NULL,
	"version" integer DEFAULT 0 NOT NULL,
	"changed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_action_plan_states_status_check" CHECK ("evry_action_plan_states"."status" in ('draft', 'awaiting_confirmation', 'approved', 'executing', 'completed', 'partially_failed', 'failed', 'cancelled', 'superseded', 'expired')),
	CONSTRAINT "evry_action_plan_states_version_check" CHECK ("evry_action_plan_states"."version" >= 0)
);
--> statement-breakpoint
CREATE TABLE "evry_action_plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"request_key" uuid NOT NULL,
	"intent_fingerprint" varchar(64) NOT NULL,
	"fingerprint" varchar(64) NOT NULL,
	"document" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"supersedes_plan_id" uuid,
	CONSTRAINT "evry_action_plans_fingerprint_check" CHECK ("evry_action_plans"."fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_action_plans_intent_fingerprint_check" CHECK ("evry_action_plans"."intent_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_action_plans_document_object_check" CHECK (jsonb_typeof("evry_action_plans"."document") = 'object'),
	CONSTRAINT "evry_action_plans_expiration_check" CHECK ("evry_action_plans"."expires_at" = "evry_action_plans"."created_at" + interval '15 minutes'),
	CONSTRAINT "evry_action_plans_no_self_supersede_check" CHECK ("evry_action_plans"."supersedes_plan_id" is null or "evry_action_plans"."supersedes_plan_id" <> "evry_action_plans"."id")
);
--> statement-breakpoint
CREATE TABLE "evry_plan_confirmations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"plan_fingerprint" varchar(64) NOT NULL,
	"decided_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_plan_confirmations_fingerprint_check" CHECK ("evry_plan_confirmations"."plan_fingerprint" ~ '^[0-9a-f]{64}$')
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evry_action_plans_id_church_unique_idx" ON "evry_action_plans" USING btree ("id","church_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_action_plans_exact_identity_unique_idx" ON "evry_action_plans" USING btree ("id","church_id","actor_user_id","fingerprint");--> statement-breakpoint
ALTER TABLE "evry_action_plan_states" ADD CONSTRAINT "evry_action_plan_states_plan_church_fk" FOREIGN KEY ("plan_id","church_id") REFERENCES "public"."evry_action_plans"("id","church_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_action_plans" ADD CONSTRAINT "evry_action_plans_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_action_plans" ADD CONSTRAINT "evry_action_plans_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_action_plans" ADD CONSTRAINT "evry_action_plans_supersedes_fk" FOREIGN KEY ("supersedes_plan_id","church_id") REFERENCES "public"."evry_action_plans"("id","church_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_plan_confirmations" ADD CONSTRAINT "evry_plan_confirmations_exact_plan_fk" FOREIGN KEY ("plan_id","church_id","actor_user_id","plan_fingerprint") REFERENCES "public"."evry_action_plans"("id","church_id","actor_user_id","fingerprint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "evry_action_plan_states_church_status_idx" ON "evry_action_plan_states" USING btree ("church_id","status");--> statement-breakpoint
CREATE INDEX "evry_action_plans_church_created_idx" ON "evry_action_plans" USING btree ("church_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_action_plans_actor_request_unique_idx" ON "evry_action_plans" USING btree ("church_id","actor_user_id","request_key");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_action_plans_supersedes_unique_idx" ON "evry_action_plans" USING btree ("supersedes_plan_id") WHERE "evry_action_plans"."supersedes_plan_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "evry_plan_confirmations_plan_unique_idx" ON "evry_plan_confirmations" USING btree ("plan_id");--> statement-breakpoint
CREATE INDEX "evry_plan_confirmations_church_decided_idx" ON "evry_plan_confirmations" USING btree ("church_id","decided_at");--> statement-breakpoint
CREATE FUNCTION "evry_reject_immutable_row_mutation"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	RAISE EXCEPTION 'immutable Evry row on % cannot be %', TG_TABLE_NAME, TG_OP
		USING ERRCODE = '55000';
END;
$$;--> statement-breakpoint
CREATE TRIGGER "evry_action_plans_immutable"
BEFORE UPDATE OR DELETE ON "evry_action_plans"
FOR EACH ROW EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint
CREATE TRIGGER "evry_plan_confirmations_immutable"
BEFORE UPDATE OR DELETE ON "evry_plan_confirmations"
FOR EACH ROW EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();
