-- #783 EV-028 — immutable domain-effect claims separated from terminal Evry
-- outcomes. Claims are the crash-recovery ledger and intentionally retain only
-- exact execution identity, capability identity and safe counts; no arguments,
-- recipient data, content or error text are copied here.
--
-- ROLLBACK (isolated database only, after proving no unreconciled claim exists):
--   BEGIN;
--   DROP VIEW IF EXISTS evry_redacted_telemetry;
--   DROP TRIGGER IF EXISTS evry_execution_outcomes_claim_consistency ON evry_execution_outcomes;
--   DROP FUNCTION IF EXISTS evry_reject_outcome_claim_contradiction();
--   DROP TABLE IF EXISTS evry_execution_effect_claims;
--   DROP FUNCTION IF EXISTS evry_validate_execution_effect_claim_step();
--   -- Recreate the 0066 evry_redacted_telemetry view, then remove this exact
--   -- migration hash from drizzle.__drizzle_migrations before reapplying.
--   COMMIT;

CREATE TABLE "evry_execution_effect_claims" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"attempt_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"church_id" uuid NOT NULL,
	"actor_user_id" uuid NOT NULL,
	"plan_fingerprint" varchar(64) NOT NULL,
	"correlation_id" uuid NOT NULL,
	"effect_key" varchar(64) NOT NULL,
	"step_id" varchar(64) NOT NULL,
	"capability_identity" varchar(160) NOT NULL,
	"affected_count" integer DEFAULT 0 NOT NULL,
	"excluded_count" integer DEFAULT 0 NOT NULL,
	"claimed_at" timestamp with time zone NOT NULL,
	CONSTRAINT "evry_execution_effect_claims_fingerprint_check" CHECK ("evry_execution_effect_claims"."plan_fingerprint" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_execution_effect_claims_effect_key_check" CHECK ("evry_execution_effect_claims"."effect_key" ~ '^[0-9a-f]{64}$'),
	CONSTRAINT "evry_execution_effect_claims_step_check" CHECK ("evry_execution_effect_claims"."step_id" ~ '^[a-z][a-z0-9_.-]{0,63}$' and length("evry_execution_effect_claims"."capability_identity") > 0),
	CONSTRAINT "evry_execution_effect_claims_counts_check" CHECK ("evry_execution_effect_claims"."affected_count" >= 0 and "evry_execution_effect_claims"."excluded_count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "evry_execution_effect_claims" ADD CONSTRAINT "evry_execution_effect_claims_exact_attempt_fk" FOREIGN KEY ("attempt_id","plan_id","church_id","actor_user_id","plan_fingerprint","correlation_id") REFERENCES "public"."evry_execution_attempts"("id","plan_id","church_id","actor_user_id","plan_fingerprint","correlation_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "evry_execution_effect_claims_effect_unique_idx" ON "evry_execution_effect_claims" USING btree ("church_id","effect_key");--> statement-breakpoint
CREATE UNIQUE INDEX "evry_execution_effect_claims_step_unique_idx" ON "evry_execution_effect_claims" USING btree ("attempt_id","step_id");--> statement-breakpoint
CREATE INDEX "evry_execution_effect_claims_plan_time_idx" ON "evry_execution_effect_claims" USING btree ("plan_id","claimed_at","id");--> statement-breakpoint

CREATE FUNCTION "evry_validate_execution_effect_claim_step"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
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
		RAISE EXCEPTION 'Evry execution effect claim is not an exact approved plan step'
			USING ERRCODE = '23514',
				CONSTRAINT = 'evry_execution_effect_claims_exact_step_check';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "evry_execution_effect_claims_exact_step"
BEFORE INSERT ON "evry_execution_effect_claims"
FOR EACH ROW EXECUTE FUNCTION "evry_validate_execution_effect_claim_step"();--> statement-breakpoint
CREATE TRIGGER "evry_execution_effect_claims_immutable"
BEFORE UPDATE OR DELETE ON "evry_execution_effect_claims"
FOR EACH ROW EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint
CREATE TRIGGER "evry_execution_effect_claims_no_truncate"
BEFORE TRUNCATE ON "evry_execution_effect_claims"
FOR EACH STATEMENT EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();--> statement-breakpoint

CREATE FUNCTION "evry_reject_outcome_claim_contradiction"() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
	IF NEW."subject" = 'step' AND NEW."status" <> 'completed' AND EXISTS (
		SELECT 1 FROM "evry_execution_effect_claims" c
		WHERE c."attempt_id" = NEW."attempt_id"
			AND c."plan_id" = NEW."plan_id"
			AND c."church_id" = NEW."church_id"
			AND c."actor_user_id" = NEW."actor_user_id"
			AND c."plan_fingerprint" = NEW."plan_fingerprint"
			AND c."correlation_id" = NEW."correlation_id"
			AND c."step_id" = NEW."step_id"
			AND c."capability_identity" = NEW."capability_identity"
	) THEN
		RAISE EXCEPTION 'Evry claimed effect cannot have a non-completed step outcome'
			USING ERRCODE = '23514',
				CONSTRAINT = 'evry_execution_outcomes_claim_status_check';
	END IF;
	IF NEW."subject" = 'attempt' AND EXISTS (
		SELECT 1 FROM "evry_execution_effect_claims" c
		WHERE c."attempt_id" = NEW."attempt_id"
		AND NOT EXISTS (
			SELECT 1 FROM "evry_execution_outcomes" o
			WHERE o."attempt_id" = c."attempt_id"
				AND o."step_id" = c."step_id"
				AND o."capability_identity" = c."capability_identity"
				AND o."status" = 'completed'
				AND o."effect_key" = c."effect_key"
		)
	) THEN
		RAISE EXCEPTION 'Evry execution attempt has an unreconciled effect claim'
			USING ERRCODE = '23514',
				CONSTRAINT = 'evry_execution_outcomes_claim_completion_check';
	END IF;
	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "evry_execution_outcomes_claim_consistency"
BEFORE INSERT ON "evry_execution_outcomes"
FOR EACH ROW EXECUTE FUNCTION "evry_reject_outcome_claim_contradiction"();--> statement-breakpoint

CREATE OR REPLACE VIEW "evry_redacted_telemetry" AS
SELECT correlation_id, 'audit_event'::varchar(24) AS record_kind,
       event_type::varchar(32) AS event_name,
       NULL::varchar(160) AS capability_identity,
       result_code::varchar(32) AS status,
       result_code::varchar(32) AS result_code,
       NULL::integer AS affected_count, NULL::integer AS excluded_count,
       occurred_at
FROM evry_product_audit_events
UNION ALL
SELECT correlation_id, 'execution_attempt'::varchar(24),
       'attempt_started'::varchar(32), NULL::varchar(160), NULL::varchar(32),
       NULL::varchar(32), NULL::integer, NULL::integer, started_at
FROM evry_execution_attempts
UNION ALL
SELECT correlation_id, 'effect_claim'::varchar(24), 'domain_mutation_claimed'::varchar(32),
       capability_identity, 'reconciling'::varchar(32),
       NULL::varchar(32), affected_count, excluded_count, claimed_at
FROM evry_execution_effect_claims
UNION ALL
SELECT correlation_id, 'execution_outcome'::varchar(24), subject::varchar(32),
       capability_identity, status, result_code, affected_count,
       excluded_count, occurred_at
FROM evry_execution_outcomes;
