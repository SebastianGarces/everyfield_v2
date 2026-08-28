-- Split durable effect completion from aggregate execution completion.
--
-- Manual rollback (new completed rows use their unique outcome key as the
-- legacy non-null effect key so the 0066 checks can be restored safely):
--   BEGIN;
--   ALTER TABLE evry_execution_outcomes DROP CONSTRAINT evry_execution_outcomes_attempt_counts_check;
--   ALTER TABLE evry_execution_outcomes DROP CONSTRAINT evry_execution_outcomes_result_code_check;
--   ALTER TABLE evry_execution_outcomes DROP CONSTRAINT evry_execution_outcomes_effect_check;
--   ALTER TABLE evry_execution_outcomes DROP CONSTRAINT evry_execution_outcomes_status_result_check;
--   ALTER TABLE evry_execution_outcomes DISABLE TRIGGER evry_execution_outcomes_immutable;
--   UPDATE evry_execution_outcomes SET result_code = 'noop_completed', effect_key = CASE WHEN subject = 'attempt' THEN outcome_key ELSE effect_key END WHERE status = 'completed';
--   ALTER TABLE evry_execution_outcomes ENABLE TRIGGER evry_execution_outcomes_immutable;
--   ALTER TABLE evry_execution_outcomes ADD CONSTRAINT evry_execution_outcomes_result_code_check CHECK (result_code in ('noop_completed', 'precondition_refused', 'effect_failed', 'dependency_skipped'));
--   ALTER TABLE evry_execution_outcomes ADD CONSTRAINT evry_execution_outcomes_effect_check CHECK ((status = 'completed' and effect_key is not null) or (status <> 'completed' and effect_key is null));
--   ALTER TABLE evry_execution_outcomes ADD CONSTRAINT evry_execution_outcomes_status_result_check CHECK ((status = 'completed' and result_code = 'noop_completed') or (status = 'refused' and result_code = 'precondition_refused') or (status in ('failed', 'partially_failed') and result_code = 'effect_failed') or (status = 'skipped' and result_code = 'dependency_skipped'));
--   COMMIT;

ALTER TABLE "evry_execution_outcomes" DROP CONSTRAINT "evry_execution_outcomes_result_code_check";--> statement-breakpoint
ALTER TABLE "evry_execution_outcomes" DROP CONSTRAINT "evry_execution_outcomes_effect_check";--> statement-breakpoint
ALTER TABLE "evry_execution_outcomes" DROP CONSTRAINT "evry_execution_outcomes_status_result_check";--> statement-breakpoint
ALTER TABLE "evry_execution_outcomes" DISABLE TRIGGER "evry_execution_outcomes_immutable";--> statement-breakpoint
UPDATE "evry_execution_outcomes"
SET "result_code" = CASE
      WHEN "subject" = 'step' THEN 'effect_completed'
      ELSE 'execution_completed'
    END,
    "effect_key" = CASE
      WHEN "subject" = 'step' THEN "effect_key"
      ELSE NULL
    END
WHERE "status" = 'completed';--> statement-breakpoint
UPDATE "evry_execution_outcomes"
SET "affected_count" = 0, "excluded_count" = 0
WHERE "subject" = 'attempt';--> statement-breakpoint
ALTER TABLE "evry_execution_outcomes" ENABLE TRIGGER "evry_execution_outcomes_immutable";--> statement-breakpoint
ALTER TABLE "evry_execution_outcomes" ADD CONSTRAINT "evry_execution_outcomes_result_code_check" CHECK ("evry_execution_outcomes"."result_code" in ('effect_completed', 'execution_completed', 'precondition_refused', 'effect_failed', 'dependency_skipped'));--> statement-breakpoint
ALTER TABLE "evry_execution_outcomes" ADD CONSTRAINT "evry_execution_outcomes_attempt_counts_check" CHECK ("evry_execution_outcomes"."subject" <> 'attempt' or ("evry_execution_outcomes"."affected_count" = 0 and "evry_execution_outcomes"."excluded_count" = 0));--> statement-breakpoint
ALTER TABLE "evry_execution_outcomes" ADD CONSTRAINT "evry_execution_outcomes_effect_check" CHECK (("evry_execution_outcomes"."subject" = 'step' and "evry_execution_outcomes"."status" = 'completed' and "evry_execution_outcomes"."effect_key" is not null)
        or (not ("evry_execution_outcomes"."subject" = 'step' and "evry_execution_outcomes"."status" = 'completed') and "evry_execution_outcomes"."effect_key" is null));--> statement-breakpoint
ALTER TABLE "evry_execution_outcomes" ADD CONSTRAINT "evry_execution_outcomes_status_result_check" CHECK (("evry_execution_outcomes"."subject" = 'step' and "evry_execution_outcomes"."status" = 'completed' and "evry_execution_outcomes"."result_code" = 'effect_completed')
        or ("evry_execution_outcomes"."subject" = 'attempt' and "evry_execution_outcomes"."status" = 'completed' and "evry_execution_outcomes"."result_code" = 'execution_completed')
        or ("evry_execution_outcomes"."status" = 'refused' and "evry_execution_outcomes"."result_code" = 'precondition_refused')
        or ("evry_execution_outcomes"."status" in ('failed', 'partially_failed') and "evry_execution_outcomes"."result_code" = 'effect_failed')
        or ("evry_execution_outcomes"."status" = 'skipped' and "evry_execution_outcomes"."result_code" = 'dependency_skipped'));
