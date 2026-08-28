-- EV-012: immutable, redacted product audit and execution evidence.
-- Request-level facts retain actor and plant while their plan pair is null.
-- Lifecycle/execution facts bind the exact immutable plan tuple; attempts also
-- bind its confirmation. No JSON, prompts, recipients, or raw errors fit here.
--
-- Manual rollback, in dependency order:
--   DROP VIEW "evry_redacted_telemetry";
--   DROP TRIGGER "evry_action_plans_no_truncate" ON "evry_action_plans";
--   DROP TRIGGER "evry_plan_confirmations_no_truncate" ON "evry_plan_confirmations";
--   DROP TABLE "evry_execution_outcomes";
--   DROP TABLE "evry_execution_attempts";
--   DROP TABLE "evry_product_audit_events";
--   DROP FUNCTION "evry_validate_execution_outcome_step"();
--   ALTER TABLE "evry_plan_confirmations" DROP CONSTRAINT "evry_plan_confirmations_church_id_churches_id_fk";
--   ALTER TABLE "evry_plan_confirmations" DROP CONSTRAINT "evry_plan_confirmations_actor_user_id_users_id_fk";
--   DROP INDEX "evry_plan_confirmations_exact_identity_unique_idx";

CREATE TABLE "evry_execution_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"plan_fingerprint" varchar(64) NOT NULL,
	"confirmation_id" uuid NOT NULL,
	"proposal_event_id" uuid NOT NULL,
	"proposal_event_type" varchar(32) DEFAULT 'plan_proposed' NOT NULL,
	"correlation_id" uuid NOT NULL,
	"attempt_key" varchar(64) NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_execution_attempts_fingerprint_check" CHECK ("evry_execution_attempts"."plan_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_execution_attempts_key_check" CHECK ("evry_execution_attempts"."attempt_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_execution_attempts_proposal_type_check" CHECK ("evry_execution_attempts"."proposal_event_type" = 'plan_proposed')
);
--> statement-breakpoint
CREATE TABLE "evry_execution_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"plan_fingerprint" varchar(64) NOT NULL,
	"correlation_id" uuid NOT NULL,
	"outcome_key" varchar(64) NOT NULL,
	"effect_key" varchar(64),
	"subject" varchar(16) NOT NULL,
	"step_id" varchar(64),
	"capability_identity" varchar(160),
	"status" varchar(32) NOT NULL,
	"result_code" varchar(32) NOT NULL,
	"affected_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_execution_outcomes_subject_check" CHECK ("evry_execution_outcomes"."subject" in ('attempt', 'step')),
	CONSTRAINT "evry_execution_outcomes_status_check" CHECK ("evry_execution_outcomes"."status" in ('completed', 'partially_failed', 'failed', 'refused', 'skipped')),
	CONSTRAINT "evry_execution_outcomes_result_code_check" CHECK ("evry_execution_outcomes"."result_code" in ('noop_completed', 'precondition_refused', 'effect_failed', 'dependency_skipped')),
	CONSTRAINT "evry_execution_outcomes_fingerprint_check" CHECK ("evry_execution_outcomes"."plan_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_execution_outcomes_keys_check" CHECK ("evry_execution_outcomes"."outcome_key" ~ '^[0-9a-f]{64}$' and ("evry_execution_outcomes"."effect_key" is null or "evry_execution_outcomes"."effect_key" ~ '^[0-9a-f]{64}$')),
	CONSTRAINT "evry_execution_outcomes_counts_check" CHECK ("evry_execution_outcomes"."affected_count" >= 0 and "evry_execution_outcomes"."excluded_count" >= 0),
	CONSTRAINT "evry_execution_outcomes_subject_fields_check" CHECK ((
        "evry_execution_outcomes"."subject" = 'attempt'
        and "evry_execution_outcomes"."step_id" is null
        and "evry_execution_outcomes"."capability_identity" is null
        and "evry_execution_outcomes"."status" in ('completed', 'partially_failed', 'failed', 'refused')
      ) or (
        "evry_execution_outcomes"."subject" = 'step'
        and "evry_execution_outcomes"."step_id" is not null
        and "evry_execution_outcomes"."step_id" ~ '^[a-z][a-z0-9_.-]{0,63}$'
        and "evry_execution_outcomes"."capability_identity" is not null
        and length("evry_execution_outcomes"."capability_identity") > 0
        and "evry_execution_outcomes"."status" in ('completed', 'failed', 'refused', 'skipped')
      )),
	CONSTRAINT "evry_execution_outcomes_effect_check" CHECK (("evry_execution_outcomes"."status" = 'completed' and "evry_execution_outcomes"."effect_key" is not null) or ("evry_execution_outcomes"."status" <> 'completed' and "evry_execution_outcomes"."effect_key" is null)),
	CONSTRAINT "evry_execution_outcomes_status_result_check" CHECK (("evry_execution_outcomes"."status" = 'completed' and "evry_execution_outcomes"."result_code" = 'noop_completed')
        or ("evry_execution_outcomes"."status" = 'refused' and "evry_execution_outcomes"."result_code" = 'precondition_refused')
        or ("evry_execution_outcomes"."status" in ('failed', 'partially_failed') and "evry_execution_outcomes"."result_code" = 'effect_failed')
        or ("evry_execution_outcomes"."status" = 'skipped' and "evry_execution_outcomes"."result_code" = 'dependency_skipped'))
);
--> statement-breakpoint
CREATE TABLE "evry_product_audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"plan_fingerprint" varchar(64),
	"correlation_id" uuid NOT NULL,
	"event_key" varchar(64) NOT NULL,
	"event_type" varchar(32) NOT NULL,
	"result_code" varchar(32),
	"occurred_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_product_audit_events_type_check" CHECK ("evry_product_audit_events"."event_type" in ('request_read_completed', 'request_refused', 'request_failed', 'plan_proposed', 'plan_approved', 'plan_cancelled', 'plan_expired', 'plan_superseded')),
	CONSTRAINT "evry_product_audit_events_fingerprint_check" CHECK ("evry_product_audit_events"."plan_fingerprint" is null or "evry_product_audit_events"."plan_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_product_audit_events_key_check" CHECK ("evry_product_audit_events"."event_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_product_audit_events_shape_check" CHECK ((
        "evry_product_audit_events"."event_type" in ('request_read_completed', 'request_refused', 'request_failed')
        and "evry_product_audit_events"."plan_id" is null
        and "evry_product_audit_events"."plan_fingerprint" is null
        and (
          ("evry_product_audit_events"."event_type" = 'request_read_completed' and "evry_product_audit_events"."result_code" = 'read_completed')
          or ("evry_product_audit_events"."event_type" = 'request_refused' and "evry_product_audit_events"."result_code" in ('policy_refused', 'request_invalid'))
          or ("evry_product_audit_events"."event_type" = 'request_failed' and "evry_product_audit_events"."result_code" = 'request_failed')
        )
      ) or (
        "evry_product_audit_events"."event_type" in ('plan_proposed', 'plan_approved', 'plan_cancelled', 'plan_expired', 'plan_superseded')
        and "evry_product_audit_events"."plan_id" is not null
        and "evry_product_audit_events"."plan_fingerprint" is not null
        and "evry_product_audit_events"."result_code" is null
      ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX "evry_plan_confirmations_exact_identity_unique_idx" ON "evry_plan_confirmations" USING btree ("id","plan_id","church_id","actor_user_id","plan_fingerprint");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_execution_attempts_exact_identity_unique_idx" ON "evry_execution_attempts" USING btree ("id","plan_id","church_id","actor_user_id","plan_fingerprint","correlation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_product_audit_events_exact_identity_unique_idx" ON "evry_product_audit_events" USING btree ("id","plan_id","church_id","actor_user_id","plan_fingerprint","correlation_id","event_type");--> statement-breakpoint
ALTER TABLE "evry_execution_attempts" ADD CONSTRAINT "evry_execution_attempts_exact_plan_fk" FOREIGN KEY ("plan_id","church_id","actor_user_id","plan_fingerprint") REFERENCES "public"."evry_action_plans"("id","church_id","actor_user_id","fingerprint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_execution_attempts" ADD CONSTRAINT "evry_execution_attempts_exact_confirmation_fk" FOREIGN KEY ("confirmation_id","plan_id","church_id","actor_user_id","plan_fingerprint") REFERENCES "public"."evry_plan_confirmations"("id","plan_id","church_id","actor_user_id","plan_fingerprint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_execution_attempts" ADD CONSTRAINT "evry_execution_attempts_exact_proposal_fk" FOREIGN KEY ("proposal_event_id","plan_id","church_id","actor_user_id","plan_fingerprint","correlation_id","proposal_event_type") REFERENCES "public"."evry_product_audit_events"("id","plan_id","church_id","actor_user_id","plan_fingerprint","correlation_id","event_type") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_execution_outcomes" ADD CONSTRAINT "evry_execution_outcomes_exact_attempt_fk" FOREIGN KEY ("attempt_id","plan_id","church_id","actor_user_id","plan_fingerprint","correlation_id") REFERENCES "public"."evry_execution_attempts"("id","plan_id","church_id","actor_user_id","plan_fingerprint","correlation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_product_audit_events" ADD CONSTRAINT "evry_product_audit_events_exact_plan_fk" FOREIGN KEY ("plan_id","church_id","actor_user_id","plan_fingerprint") REFERENCES "public"."evry_action_plans"("id","church_id","actor_user_id","fingerprint") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_plan_confirmations" ADD CONSTRAINT "evry_plan_confirmations_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_plan_confirmations" ADD CONSTRAINT "evry_plan_confirmations_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_product_audit_events" ADD CONSTRAINT "evry_product_audit_events_church_id_churches_id_fk" FOREIGN KEY ("church_id") REFERENCES "public"."churches"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "evry_product_audit_events" ADD CONSTRAINT "evry_product_audit_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evry_execution_attempts_key_unique_idx" ON "evry_execution_attempts" USING btree ("church_id","attempt_key");--> statement-breakpoint
CREATE INDEX "evry_execution_attempts_plan_time_idx" ON "evry_execution_attempts" USING btree ("plan_id","started_at","id");--> statement-breakpoint
CREATE INDEX "evry_execution_attempts_correlation_idx" ON "evry_execution_attempts" USING btree ("correlation_id","started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_execution_outcomes_key_unique_idx" ON "evry_execution_outcomes" USING btree ("church_id","outcome_key");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_execution_outcomes_attempt_unique_idx" ON "evry_execution_outcomes" USING btree ("attempt_id") WHERE "evry_execution_outcomes"."subject" = 'attempt';--> statement-breakpoint
CREATE UNIQUE INDEX "evry_execution_outcomes_step_unique_idx" ON "evry_execution_outcomes" USING btree ("attempt_id","step_id") WHERE "evry_execution_outcomes"."subject" = 'step';--> statement-breakpoint
CREATE UNIQUE INDEX "evry_execution_outcomes_effect_unique_idx" ON "evry_execution_outcomes" USING btree ("church_id","effect_key") WHERE "evry_execution_outcomes"."effect_key" is not null;--> statement-breakpoint
CREATE INDEX "evry_execution_outcomes_plan_time_idx" ON "evry_execution_outcomes" USING btree ("plan_id","occurred_at","id");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_product_audit_events_key_unique_idx" ON "evry_product_audit_events" USING btree ("church_id","event_key");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_product_audit_events_plan_type_unique_idx" ON "evry_product_audit_events" USING btree ("plan_id","event_type") WHERE "evry_product_audit_events"."plan_id" is not null;--> statement-breakpoint
CREATE INDEX "evry_product_audit_events_plan_time_idx" ON "evry_product_audit_events" USING btree ("plan_id","occurred_at","id");--> statement-breakpoint
CREATE INDEX "evry_product_audit_events_correlation_idx" ON "evry_product_audit_events" USING btree ("correlation_id","occurred_at");--> statement-breakpoint
INSERT INTO "evry_product_audit_events" (
	"plan_id", "church_id", "actor_user_id", "plan_fingerprint",
	"correlation_id", "event_key", "event_type", "occurred_at"
)
SELECT
	p."id", p."church_id", p."actor_user_id", p."fingerprint",
	p."request_key",
	encode(sha256(convert_to(
		'evry-audit-v1' || chr(31) || 'plan-event' || chr(31) ||
		p."id"::text || chr(31) || 'plan_proposed',
		'UTF8'
	)), 'hex'),
	'plan_proposed', p."created_at"
FROM "evry_action_plans" p;--> statement-breakpoint

INSERT INTO "evry_product_audit_events" (
	"plan_id", "church_id", "actor_user_id", "plan_fingerprint",
	"correlation_id", "event_key", "event_type", "occurred_at"
)
SELECT
	p."id", p."church_id", p."actor_user_id", p."fingerprint",
	p."request_key",
	encode(sha256(convert_to(
		'evry-audit-v1' || chr(31) || 'plan-event' || chr(31) ||
		p."id"::text || chr(31) || 'plan_approved',
		'UTF8'
	)), 'hex'),
	'plan_approved', c."decided_at"
FROM "evry_plan_confirmations" c
JOIN "evry_action_plans" p
	ON p."id" = c."plan_id"
	AND p."church_id" = c."church_id"
	AND p."actor_user_id" = c."actor_user_id"
	AND p."fingerprint" = c."plan_fingerprint";--> statement-breakpoint

INSERT INTO "evry_product_audit_events" (
	"plan_id", "church_id", "actor_user_id", "plan_fingerprint",
	"correlation_id", "event_key", "event_type", "occurred_at"
)
SELECT
	p."id", p."church_id", p."actor_user_id", p."fingerprint",
	p."request_key",
	encode(sha256(convert_to(
		'evry-audit-v1' || chr(31) || 'plan-event' || chr(31) ||
		p."id"::text || chr(31) ||
		CASE s."status"
			WHEN 'cancelled' THEN 'plan_cancelled'
			WHEN 'expired' THEN 'plan_expired'
			ELSE 'plan_superseded'
		END,
		'UTF8'
	)), 'hex'),
	CASE s."status"
		WHEN 'cancelled' THEN 'plan_cancelled'
		WHEN 'expired' THEN 'plan_expired'
		ELSE 'plan_superseded'
	END,
	s."changed_at"
FROM "evry_action_plan_states" s
JOIN "evry_action_plans" p
	ON p."id" = s."plan_id" AND p."church_id" = s."church_id"
WHERE s."status" IN ('cancelled', 'expired', 'superseded');--> statement-breakpoint

CREATE FUNCTION "evry_validate_execution_outcome_step"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."subject" <> 'step' THEN
		RETURN NEW;
	END IF;

	IF NOT EXISTS (
		SELECT 1
		FROM "evry_action_plans" p
		CROSS JOIN LATERAL jsonb_array_elements(p."document" -> 'steps') step
		WHERE p."id" = NEW."plan_id"
			AND p."church_id" = NEW."church_id"
			AND p."actor_user_id" = NEW."actor_user_id"
			AND p."fingerprint" = NEW."plan_fingerprint"
			AND step ->> 'id' = NEW."step_id"
			AND step ->> 'capabilityIdentity' = NEW."capability_identity"
	) THEN
		RAISE EXCEPTION 'Evry execution outcome is not an exact approved plan step'
			USING ERRCODE = '23514',
				CONSTRAINT = 'evry_execution_outcomes_exact_step_check';
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "evry_execution_outcomes_exact_step"
BEFORE INSERT ON "evry_execution_outcomes"
FOR EACH ROW EXECUTE FUNCTION "evry_validate_execution_outcome_step"();--> statement-breakpoint

CREATE TRIGGER "evry_product_audit_events_immutable"
BEFORE UPDATE OR DELETE ON "evry_product_audit_events"
FOR EACH ROW EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint
CREATE TRIGGER "evry_execution_attempts_immutable"
BEFORE UPDATE OR DELETE ON "evry_execution_attempts"
FOR EACH ROW EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint
CREATE TRIGGER "evry_execution_outcomes_immutable"
BEFORE UPDATE OR DELETE ON "evry_execution_outcomes"
FOR EACH ROW EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint
CREATE TRIGGER "evry_action_plans_no_truncate"
BEFORE TRUNCATE ON "evry_action_plans"
FOR EACH STATEMENT EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint
CREATE TRIGGER "evry_plan_confirmations_no_truncate"
BEFORE TRUNCATE ON "evry_plan_confirmations"
FOR EACH STATEMENT EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint
CREATE TRIGGER "evry_product_audit_events_no_truncate"
BEFORE TRUNCATE ON "evry_product_audit_events"
FOR EACH STATEMENT EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint
CREATE TRIGGER "evry_execution_attempts_no_truncate"
BEFORE TRUNCATE ON "evry_execution_attempts"
FOR EACH STATEMENT EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint
CREATE TRIGGER "evry_execution_outcomes_no_truncate"
BEFORE TRUNCATE ON "evry_execution_outcomes"
FOR EACH STATEMENT EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint

CREATE VIEW "evry_redacted_telemetry" AS
SELECT
	correlation_id,
	'audit_event'::varchar(24) AS record_kind,
	event_type::varchar(32) AS event_name,
	NULL::varchar(160) AS capability_identity,
	result_code::varchar(32) AS status,
	result_code::varchar(32) AS result_code,
	NULL::integer AS affected_count,
	NULL::integer AS excluded_count,
	occurred_at
FROM evry_product_audit_events
UNION ALL
SELECT
	correlation_id,
	'execution_attempt'::varchar(24),
	'attempt_started'::varchar(32),
	NULL::varchar(160),
	NULL::varchar(32),
	NULL::varchar(32),
	NULL::integer,
	NULL::integer,
	started_at
FROM evry_execution_attempts
UNION ALL
SELECT
	correlation_id,
	'execution_outcome'::varchar(24),
	subject::varchar(32),
	capability_identity,
	status,
	result_code,
	affected_count,
	excluded_count,
	occurred_at
FROM evry_execution_outcomes;
