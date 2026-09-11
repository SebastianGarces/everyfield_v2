-- Reuse is a first-class durable conversation operation. Like create, its
-- destination conversation is unknown until the owned operation commits.
--
-- ROLLBACK (isolated database only):
--   ALTER TABLE "evry_active_runs" DROP CONSTRAINT "evry_active_runs_operation_check";
--   ALTER TABLE "evry_active_runs" DROP CONSTRAINT "evry_active_runs_shape_check";
--   ALTER TABLE "evry_active_runs" ADD CONSTRAINT "evry_active_runs_operation_check" CHECK ("operation" in ('create', 'continue', 'execute', 'retry'));
--   ALTER TABLE "evry_active_runs" ADD CONSTRAINT "evry_active_runs_shape_check" CHECK (("kind" = 'conversation' and "operation" in ('create', 'continue') and "plan_id" is null and "plan_fingerprint" is null and ("operation" <> 'create' or "status" <> 'active' or "conversation_id" is null) and ("operation" = 'create' or "conversation_id" is not null) and "stage" <> 'executing') or ("kind" = 'execution' and "operation" in ('execute', 'retry') and "conversation_id" is not null and "plan_id" is not null and "plan_fingerprint" is not null and "stage" = 'executing'));
--   DELETE FROM drizzle.__drizzle_migrations WHERE created_at = 1788120711774;

ALTER TABLE "evry_active_runs" DROP CONSTRAINT "evry_active_runs_operation_check";--> statement-breakpoint
ALTER TABLE "evry_active_runs" DROP CONSTRAINT "evry_active_runs_shape_check";--> statement-breakpoint
ALTER TABLE "evry_active_runs" ADD CONSTRAINT "evry_active_runs_operation_check" CHECK ("evry_active_runs"."operation" in ('create', 'continue', 'reuse', 'execute', 'retry'));--> statement-breakpoint
ALTER TABLE "evry_active_runs" ADD CONSTRAINT "evry_active_runs_shape_check" CHECK ((
        "evry_active_runs"."kind" = 'conversation'
        and "evry_active_runs"."operation" in ('create', 'continue', 'reuse')
        and "evry_active_runs"."plan_id" is null
        and "evry_active_runs"."plan_fingerprint" is null
        and ("evry_active_runs"."operation" not in ('create', 'reuse') or "evry_active_runs"."status" <> 'active' or "evry_active_runs"."conversation_id" is null)
        and ("evry_active_runs"."operation" in ('create', 'reuse') or "evry_active_runs"."conversation_id" is not null)
        and "evry_active_runs"."stage" <> 'executing'
      ) or (
        "evry_active_runs"."kind" = 'execution'
        and "evry_active_runs"."operation" in ('execute', 'retry')
        and "evry_active_runs"."conversation_id" is not null
        and "evry_active_runs"."plan_id" is not null
        and "evry_active_runs"."plan_fingerprint" is not null
        and "evry_active_runs"."stage" = 'executing'
      ));
