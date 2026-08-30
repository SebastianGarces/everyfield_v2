-- Rollback (manual, before any later migration depends on this relation):
--   DROP TRIGGER "evry_execution_effect_claims_no_truncate" ON "evry_execution_effect_claims";
--   DROP TRIGGER "evry_execution_effect_claims_immutable" ON "evry_execution_effect_claims";
--   DROP TRIGGER "evry_execution_effect_claims_exact_step" ON "evry_execution_effect_claims";
--   DROP FUNCTION "evry_validate_execution_effect_claim_step"();
--   DROP TABLE "evry_execution_effect_claims";
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788059440428;

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
FOR EACH STATEMENT EXECUTE FUNCTION "evry_reject_immutable_row_mutation"();
