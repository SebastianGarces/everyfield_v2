import { and, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { evryExecutionOutcomes } from "@/db/schema";
import {
  executionStepOutcomeKey,
  type EvryAuditKey,
} from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";
import { taskStructureLockStatement } from "@/lib/tasks/structure-lock";

import { TASK_ACTION_CONTRACTS } from "./contracts";
import {
  TASKS_EFFECT_ARGUMENT_SCHEMAS,
  type AnyTaskEffectArguments,
  type TaskEffectExport,
} from "./effect-contracts";

type Execution = EvryEffectInput["execution"];
interface CompletedEffectRow extends Record<string, unknown> {
  affected_count: number;
  excluded_count: number;
}

const EXPORT_BY_IDENTITY = new Map(
  Object.entries(TASK_ACTION_CONTRACTS).flatMap(([exportName, contract]) =>
    contract.operationKind === "effect"
      ? [[contract.operationId, exportName as TaskEffectExport] as const]
      : []
  )
);

const OWN_DUTY_EXPORTS = new Set<TaskEffectExport>([
  "addSubtaskAction",
  "bulkCompleteTasksAction",
  "completeTaskAction",
  "reopenTaskAction",
  "setSubtaskCompletionAction",
  "updateTaskStatusAction",
]);

function exactTuple(input: EvryEffectInput, identity: string): boolean {
  const actor = input.authorization.actor;
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === actor.userId &&
    input.execution.plantId === actor.plantId
  );
}

async function exactCompletedOutcome(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
}): Promise<EvryEffectResult | null> {
  const [row] = await db
    .select({
      affectedCount: evryExecutionOutcomes.affectedCount,
      excludedCount: evryExecutionOutcomes.excludedCount,
    })
    .from(evryExecutionOutcomes)
    .where(
      and(
        eq(evryExecutionOutcomes.attemptId, input.execution.attemptId),
        eq(evryExecutionOutcomes.planId, input.execution.planId),
        eq(evryExecutionOutcomes.churchId, input.execution.plantId),
        eq(evryExecutionOutcomes.actorUserId, input.execution.actorUserId),
        eq(evryExecutionOutcomes.planFingerprint, input.execution.fingerprint),
        eq(evryExecutionOutcomes.correlationId, input.execution.correlationId),
        eq(evryExecutionOutcomes.stepId, input.execution.stepId),
        eq(
          evryExecutionOutcomes.capabilityIdentity,
          input.execution.capabilityIdentity
        ),
        eq(evryExecutionOutcomes.effectKey, input.effectKey),
        eq(evryExecutionOutcomes.subject, "step"),
        eq(evryExecutionOutcomes.status, "completed")
      )
    )
    .limit(1);
  return row
    ? {
        status: "completed",
        affectedCount: row.affectedCount,
        excludedCount: row.excludedCount,
      }
    : null;
}

function effectPrelude(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  current: SQL;
  affectedCount: number;
  excludedCount: number;
}): SQL {
  const outcomeKey = executionStepOutcomeKey(
    input.execution.planId,
    input.execution.fingerprint,
    input.execution.stepId
  );
  return sql`
    existing as materialized (
      select o.affected_count, o.excluded_count
      from evry_execution_outcomes o
      where o.attempt_id = ${input.execution.attemptId}::uuid
        and o.plan_id = ${input.execution.planId}::uuid
        and o.church_id = ${input.execution.plantId}::uuid
        and o.actor_user_id = ${input.execution.actorUserId}::uuid
        and o.plan_fingerprint = ${input.execution.fingerprint}
        and o.correlation_id = ${input.execution.correlationId}::uuid
        and o.outcome_key = ${outcomeKey}
        and o.effect_key = ${input.effectKey}
        and o.subject = 'step'
        and o.step_id = ${input.execution.stepId}
        and o.capability_identity = ${input.execution.capabilityIdentity}
        and o.status = 'completed'
    ), eligible as materialized (
      select a.id, a.plan_id, a.church_id, a.actor_user_id,
             a.plan_fingerprint, a.correlation_id
      from evry_execution_attempts a
      join evry_action_plan_states s
        on s.plan_id = a.plan_id and s.church_id = a.church_id
      where a.id = ${input.execution.attemptId}::uuid
        and a.plan_id = ${input.execution.planId}::uuid
        and a.church_id = ${input.execution.plantId}::uuid
        and a.actor_user_id = ${input.execution.actorUserId}::uuid
        and a.plan_fingerprint = ${input.execution.fingerprint}
        and a.correlation_id = ${input.execution.correlationId}::uuid
        and s.status = 'executing'
        and not exists (select 1 from existing)
        and (${input.current})
    ), claimed as materialized (
      insert into evry_execution_outcomes (
        attempt_id, plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id, outcome_key, effect_key, subject, step_id,
        capability_identity, status, result_code, affected_count,
        excluded_count, occurred_at
      )
      select
        e.id, e.plan_id, e.church_id, e.actor_user_id, e.plan_fingerprint,
        e.correlation_id, ${outcomeKey}, ${input.effectKey}, 'step',
        ${input.execution.stepId}, ${input.execution.capabilityIdentity},
        'completed', 'effect_completed', ${input.affectedCount}, ${input.excludedCount},
        transaction_timestamp()
      from eligible e
      on conflict do nothing
      returning affected_count, excluded_count, church_id, actor_user_id
    )`;
}

function serializedTask(alias: SQL): SQL {
  return sql`jsonb_build_object(
    'id', ${alias}.id::text,
    'title', ${alias}.title,
    'description', ${alias}.description,
    'status', ${alias}.status,
    'priority', ${alias}.priority,
    'dueDate', case when ${alias}.due_date is null then null else ${alias}.due_date::text end,
    'dueTime', case when ${alias}.due_time is null then null else to_char(${alias}.due_time, 'HH24:MI:SS') end,
    'assignedToId', ${alias}.assigned_to_id::text,
    'category', ${alias}.category,
    'relatedType', ${alias}.related_type,
    'relatedId', ${alias}.related_id::text,
    'parentTaskId', ${alias}.parent_task_id::text,
    'isRecurring', ${alias}.is_recurring,
    'recurrenceRule', ${alias}.recurrence_rule,
    'completionEvent', ${alias}.completion_event,
    'completedAt', case when ${alias}.completed_at is null then null else to_char(date_trunc('milliseconds', ${alias}.completed_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'completedById', ${alias}.completed_by_id::text,
    'createdById', ${alias}.created_by_id::text,
    'createdAt', to_char(date_trunc('milliseconds', ${alias}.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'updatedAt', to_char(date_trunc('milliseconds', ${alias}.updated_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'deletedAt', case when ${alias}.deleted_at is null then null else to_char(date_trunc('milliseconds', ${alias}.deleted_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end
  )`;
}

function serializedNotification(alias: SQL): SQL {
  return sql`jsonb_build_object(
    'notificationId', ${alias}.id::text,
    'recipientUserId', ${alias}.recipient_user_id::text,
    'type', ${alias}.type,
    'title', ${alias}.title,
    'body', ${alias}.body,
    'entityId', ${alias}.entity_id::text,
    'dedupeKey', ${alias}.dedupe_key,
    'scheduledFor', to_char(date_trunc('milliseconds', ${alias}.scheduled_for), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status', ${alias}.status,
    'expectedUpdatedAt', to_char(date_trunc('milliseconds', ${alias}.updated_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  )`;
}

function taskStateCurrent(
  execution: Execution,
  exportName: TaskEffectExport
): SQL {
  const completionMayInheritCreator = new Set<TaskEffectExport>([
    "bulkCompleteTasksAction",
    "completeTaskAction",
    "setSubtaskCompletionAction",
    "updateTaskStatusAction",
  ]).has(exportName);
  return sql`
    not exists (
      select 1 from task_plan p
      where (
        p.before_state is null and exists (
          select 1 from tasks any_task where any_task.id = p.task_id
        )
      ) or (
        p.before_state is not null and not exists (
          select 1 from tasks current_task
          where current_task.id = p.task_id
            and current_task.church_id = ${execution.plantId}::uuid
            and ${serializedTask(sql`current_task`)} = p.before_state
        )
      )
    )
    and not exists (
      select 1 from subject_plan subject
      where not exists (
        select 1 from tasks current_subject
        where current_subject.id = subject.task_id
          and current_subject.church_id = ${execution.plantId}::uuid
          and ${serializedTask(sql`current_subject`)} = subject.before_state
          and (
            exists (
              select 1 from users admin_actor
              where admin_actor.id = ${execution.actorUserId}::uuid
                and admin_actor.church_id = ${execution.plantId}::uuid
                and admin_actor.seat in ('owner', 'admin')
            )
            or current_subject.assigned_to_id = ${execution.actorUserId}::uuid
          )
      )
    )
    and not exists (
      select 1 from source_task_plan source
      where not exists (
        select 1 from tasks current_source
        where current_source.id = source.task_id
          and current_source.church_id = ${execution.plantId}::uuid
          and ${serializedTask(sql`current_source`)} = source.before_state
      )
    )
    and not exists (
      select 1 from task_plan p
      where p.before_state is null
        and ${completionMayInheritCreator} = false
        and (p.after_state->>'createdById')::uuid <> ${execution.actorUserId}::uuid
    )
    and not exists (
      select 1 from task_plan p
      where nullif(p.after_state->>'assignedToId', '') is not null
        and not exists (
          select 1 from users assignee
          where assignee.id = (p.after_state->>'assignedToId')::uuid
            and assignee.church_id = ${execution.plantId}::uuid
            and assignee.seat is not null
        )
    )
    and not exists (
      select 1 from task_plan p
      where p.after_state->>'category' = 'follow_up'
        and nullif(p.after_state->>'assignedToId', '') is not null
        and not exists (
          select 1 from users assignee
          join persons person on person.user_id = assignee.id
            and person.church_id = assignee.church_id
            and person.deleted_at is null
          where assignee.id = (p.after_state->>'assignedToId')::uuid
            and assignee.church_id = ${execution.plantId}::uuid
            and person.status in ('core_group', 'launch_team', 'leader')
        )
    )
    and not exists (
      select 1 from task_plan p
      where nullif(p.after_state->>'parentTaskId', '') is not null
        and not exists (
          select 1 from tasks parent
          where parent.id = (p.after_state->>'parentTaskId')::uuid
            and parent.church_id = ${execution.plantId}::uuid
            and parent.deleted_at is null and parent.parent_task_id is null
        )
        and not exists (
          select 1 from task_plan planned_parent
          where planned_parent.task_id =
              (p.after_state->>'parentTaskId')::uuid
            and planned_parent.before_state is null
            and nullif(planned_parent.after_state->>'parentTaskId', '') is null
        )
    )
    and not exists (
      select 1 from task_plan p
      where p.after_state->>'relatedType' = 'person'
        and nullif(p.after_state->>'relatedId', '') is not null
        and not exists (
          select 1 from persons person
          where person.id = (p.after_state->>'relatedId')::uuid
            and person.church_id = ${execution.plantId}::uuid
            and person.deleted_at is null
        )
    )
    and not exists (
      select 1 from task_plan p
      where p.after_state->>'relatedType' = 'meeting'
        and nullif(p.after_state->>'relatedId', '') is not null
        and not exists (
          select 1 from church_meetings meeting
          where meeting.id = (p.after_state->>'relatedId')::uuid
            and meeting.church_id = ${execution.plantId}::uuid
        )
    )
    and not exists (
      select 1 from task_plan p
      where p.after_state->>'relatedType' = 'team'
        and nullif(p.after_state->>'relatedId', '') is not null
        and not exists (
          select 1 from ministry_teams team
          where team.id = (p.after_state->>'relatedId')::uuid
            and team.church_id = ${execution.plantId}::uuid
        )
    )
    and not exists (
      select 1 from task_plan p
      where p.after_state->>'relatedType' = 'facility'
        and nullif(p.after_state->>'relatedId', '') is not null
    )
    and not exists (
      select 1 from task_plan p
      where p.before_state is null
        and (p.after_state->>'isRecurring')::boolean
        and nullif(p.after_state->'recurrenceRule'->>'seriesId', '') is not null
        and exists (
          select 1 from tasks open_instance
          where open_instance.church_id = ${execution.plantId}::uuid
            and open_instance.deleted_at is null
            and open_instance.status <> 'complete'
            and open_instance.is_recurring
            and (
              open_instance.id = (p.after_state->'recurrenceRule'->>'seriesId')::uuid
              or open_instance.recurrence_rule->>'seriesId' =
                p.after_state->'recurrenceRule'->>'seriesId'
            )
            and not exists (
              select 1 from task_plan completing
              where completing.task_id = open_instance.id
                and completing.after_state->>'status' = 'complete'
            )
        )
    )
    and not exists (
      select 1 from notification_after planned_notification
      where not exists (
        select 1 from users recipient
        where recipient.id = planned_notification.recipient_user_id
          and recipient.church_id = ${execution.plantId}::uuid
      )
    )`;
}

function dependencyStateCurrent(execution: Execution): SQL {
  return sql`
    case when not exists (select 1 from dependency_plan) then true else (
    not exists (
      select 1 from dependency_plan p
      where coalesce((
        select jsonb_agg(d.prerequisite_task_id::text order by d.prerequisite_task_id::text)
        from task_dependencies d
        where d.church_id = ${execution.plantId}::uuid and d.task_id = p.task_id
      ), '[]'::jsonb) <> coalesce((
        select jsonb_agg(value order by value)
        from jsonb_array_elements_text(p.before_ids) value
      ), '[]'::jsonb)
    )
    and not exists (
      select 1
      from dependency_plan p,
           jsonb_array_elements_text(p.after_ids) prerequisite(prerequisite_id)
      where prerequisite.prerequisite_id::uuid = p.task_id
        or not exists (
          select 1 from tasks prerequisite_task
          where prerequisite_task.id = prerequisite.prerequisite_id::uuid
            and prerequisite_task.church_id = ${execution.plantId}::uuid
            and prerequisite_task.deleted_at is null
            and prerequisite_task.parent_task_id is null
        )
    )
    and not exists (
      with recursive prospective_edges(task_id, prerequisite_task_id) as (
        select dependency.task_id, dependency.prerequisite_task_id
        from task_dependencies dependency
        where dependency.church_id = ${execution.plantId}::uuid
          and not exists (
            select 1 from dependency_plan replacement
            where replacement.task_id = dependency.task_id
          )
        union all
        select replacement.task_id, prerequisite.prerequisite_id::uuid
        from dependency_plan replacement,
             jsonb_array_elements_text(replacement.after_ids) prerequisite(prerequisite_id)
      ), reachability(origin_task_id, prerequisite_task_id) as (
        select replacement.task_id, prerequisite.prerequisite_id::uuid
        from dependency_plan replacement,
             jsonb_array_elements_text(replacement.after_ids) prerequisite(prerequisite_id)
        union
        select reachability.origin_task_id, edge.prerequisite_task_id
        from reachability
        join prospective_edges edge
          on edge.task_id = reachability.prerequisite_task_id
      )
      select 1 from reachability
      where origin_task_id = prerequisite_task_id
    )) end`;
}

function childSetStateCurrent(execution: Execution): SQL {
  return sql`not exists (
    select 1 from child_set_plan expected
    where coalesce((
      select jsonb_agg(child.id::text order by child.id::text)
      from tasks child
      where child.church_id = ${execution.plantId}::uuid
        and child.parent_task_id = expected.parent_task_id
        and child.deleted_at is null
    ), '[]'::jsonb) <> coalesce((
      select jsonb_agg(value order by value)
      from jsonb_array_elements_text(expected.task_ids) value
    ), '[]'::jsonb)
  )`;
}

function notificationStateCurrent(execution: Execution): SQL {
  return sql`
    coalesce((
      select jsonb_agg(${serializedNotification(sql`n`)} order by n.id::text)
      from notifications n
      where n.church_id = ${execution.plantId}::uuid
        and n.category = 'tasks' and n.entity_type = 'task'
        and n.status = 'pending'
        and n.entity_id in (select task_id from notification_scope)
    ), '[]'::jsonb) = coalesce((
      select jsonb_agg(value order by value->>'notificationId')
      from jsonb_array_elements((select before_rows from plan)) value
    ), '[]'::jsonb)
    and not exists (
      select 1 from notification_after p
      where p.expected_updated_at is null and (
        exists (select 1 from notifications n where n.id = p.notification_id)
        or exists (
          select 1 from notifications n
          where n.church_id = ${execution.plantId}::uuid
            and n.recipient_user_id = p.recipient_user_id
            and n.dedupe_key = p.dedupe_key
            and n.status <> 'cancelled'
            and not exists (
              select 1 from notification_before b
              where b.notification_id = n.id
                and not exists (
                  select 1 from notification_after kept
                  where kept.notification_id = b.notification_id
                )
            )
        )
      )
    )`;
}

function sourceStateCurrent(execution: Execution): SQL {
  return sql`case (select source_assertion->>'kind' from plan)
    when 'none' then true
    when 'subtasks' then
      coalesce((
        select jsonb_agg(t.id::text order by t.id::text)
        from tasks t
        where t.church_id = ${execution.plantId}::uuid
          and t.parent_task_id = ((select source_assertion->>'parentTaskId' from plan))::uuid
          and t.deleted_at is null
      ), '[]'::jsonb) = coalesce((
        select jsonb_agg(value order by value)
        from jsonb_array_elements_text((select source_assertion->'taskIds' from plan)) value
      ), '[]'::jsonb)
    when 'follow_up_owner' then
      coalesce((
        select jsonb_agg(t.id::text order by t.id::text)
        from tasks t
        where t.church_id = ${execution.plantId}::uuid
          and t.category = 'follow_up'
          and t.assigned_to_id = ((select source_assertion->>'fromAssigneeId' from plan))::uuid
          and t.status <> 'complete' and t.deleted_at is null
      ), '[]'::jsonb) = coalesce((
        select jsonb_agg(value order by value)
        from jsonb_array_elements_text((select source_assertion->'taskIds' from plan)) value
      ), '[]'::jsonb)
    when 'phase_transition' then exists (
      select 1 from phase_transitions transition
      where transition.id = ((select source_assertion->>'transitionId' from plan))::uuid
        and transition.church_id = ${execution.plantId}::uuid
        and transition.kind = 'transition'
        and not exists (
          select 1 from phase_prompt_answers answer
          where answer.transition_id = transition.id
        )
        and not exists (
          select 1 from phase_transitions later
          where later.church_id = transition.church_id and later.kind = 'transition'
            and (later.created_at, later.id) > (transition.created_at, transition.id)
        )
    )
    when 'bulk_selection' then not exists (
      select 1
      from jsonb_array_elements(
        (select source_assertion->'excludedTasks' from plan)
      ) excluded(value)
      where case excluded.value->>'reason'
        when 'Task not found' then exists (
          select 1 from tasks current_excluded
          where current_excluded.id = (excluded.value->>'taskId')::uuid
            and current_excluded.church_id = ${execution.plantId}::uuid
            and current_excluded.deleted_at is null
        )
        when 'Task is already complete' then not exists (
          select 1 from tasks current_excluded
          where current_excluded.id = (excluded.value->>'taskId')::uuid
            and current_excluded.church_id = ${execution.plantId}::uuid
            and current_excluded.deleted_at is null
            and current_excluded.status = 'complete'
            and ${serializedTask(sql`current_excluded`)} = excluded.value->'expectedTask'
        )
        when 'Task is complete — reopen it before rescheduling' then not exists (
          select 1 from tasks current_excluded
          where current_excluded.id = (excluded.value->>'taskId')::uuid
            and current_excluded.church_id = ${execution.plantId}::uuid
            and current_excluded.deleted_at is null
            and current_excluded.status = 'complete'
            and ${serializedTask(sql`current_excluded`)} = excluded.value->'expectedTask'
        )
        when 'That task is assigned to somebody else' then
          exists (
            select 1 from users current_actor
            where current_actor.id = ${execution.actorUserId}::uuid
              and current_actor.church_id = ${execution.plantId}::uuid
              and current_actor.seat in ('owner', 'admin')
          )
          or not exists (
            select 1 from tasks current_excluded
            where current_excluded.id = (excluded.value->>'taskId')::uuid
              and current_excluded.church_id = ${execution.plantId}::uuid
              and current_excluded.deleted_at is null
              and current_excluded.status <> 'complete'
              and current_excluded.assigned_to_id is distinct from ${execution.actorUserId}::uuid
              and ${serializedTask(sql`current_excluded`)} = excluded.value->'expectedTask'
          )
        else true
      end
    )
    else false
  end`;
}

function phaseStateCurrent(execution: Execution): SQL {
  return sql`(select phase_transition from plan) is null or exists (
    select 1 from phase_transitions transition
    where transition.id = ((select phase_transition->>'transitionId' from plan))::uuid
      and transition.church_id = ${execution.plantId}::uuid
      and to_char(date_trunc('milliseconds', transition.created_at), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') =
        (select phase_transition->>'expectedCreatedAt' from plan)
      and not exists (
        select 1 from phase_prompt_answers answer
        where answer.transition_id = transition.id
      )
  )`;
}

function completionStateCurrent(execution: Execution): SQL {
  return sql`
    ((select material_stamp from plan) is null or exists (
      select 1 from churches church
      where church.id = ${execution.plantId}::uuid
        and church.last_material_event_at is not distinct from
          ((select material_stamp->>'expectedLastMaterialEventAt' from plan))::timestamptz
        and to_char(
          date_trunc('milliseconds', church.updated_at),
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) = (select material_stamp->>'expectedChurchUpdatedAt' from plan)
    ))
    and not exists (
      select 1 from contact_plan contact
      where case contact.kind
        when 'create' then
          not exists (
            select 1 from persons person
            where person.id = contact.person_id
              and person.church_id = ${execution.plantId}::uuid
              and person.deleted_at is null
              and person.email is not distinct from contact.expected_person_email
          )
          or exists (
            select 1 from communication_recipients recipient
            where recipient.church_id = ${execution.plantId}::uuid
              and recipient.external_id = concat('task:', contact.task_id::text)
          )
          or exists (
            select 1 from communications communication
            where communication.id = contact.communication_id
          )
          or exists (
            select 1 from communication_recipients recipient
            where recipient.id = contact.recipient_id
          )
        when 'already_logged' then not exists (
          select 1 from communication_recipients recipient
          where recipient.id = contact.existing_recipient_id
            and recipient.church_id = ${execution.plantId}::uuid
            and recipient.external_id = concat('task:', contact.task_id::text)
        )
        when 'not_applicable' then
          contact.reason = 'person_unavailable' and exists (
            select 1 from persons person
            where person.id = contact.person_id
              and person.church_id = ${execution.plantId}::uuid
              and person.deleted_at is null
          )
        else true
      end
    )`;
}

function authorityCurrent(input: {
  execution: Execution;
  exportName: TaskEffectExport;
}): SQL {
  const adminRequired = !OWN_DUTY_EXPORTS.has(input.exportName);
  return sql`exists (
    select 1 from users current_actor
    where current_actor.id = ${input.execution.actorUserId}::uuid
      and current_actor.church_id = ${input.execution.plantId}::uuid
      and current_actor.seat is not null
      and (${adminRequired} = false or current_actor.seat in ('owner', 'admin'))
  )`;
}

function mutationStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  exportName: TaskEffectExport;
  args: AnyTaskEffectArguments;
}): SQL {
  const document = JSON.stringify({
    ...input.args,
    beforeRows: input.args.notifications.before,
    afterRows: input.args.notifications.after,
  });
  const affectedCount =
    input.args.taskWrites.length + (input.args.phaseTransition ? 1 : 0);
  const excludedCount =
    input.args.sourceAssertion.kind === "bulk_selection"
      ? input.args.sourceAssertion.excludedTasks.length
      : 0;
  const current = sql`
    ${authorityCurrent(input)}
    and ${taskStateCurrent(input.execution, input.exportName)}
    and ${dependencyStateCurrent(input.execution)}
    and ${childSetStateCurrent(input.execution)}
    and ${notificationStateCurrent(input.execution)}
    and ${sourceStateCurrent(input.execution)}
    and ${phaseStateCurrent(input.execution)}
    and ${completionStateCurrent(input.execution)}
  `;
  return sql`
    with plan as materialized (
      select
        document->'taskWrites' as task_writes,
        document->'subjectTasks' as subject_tasks,
        document->'sourceTasks' as source_tasks,
        document->'childSets' as child_sets,
        document->'dependencySets' as dependency_sets,
        document->'notifications'->'scopedTaskIds' as notification_scope_ids,
        document->'beforeRows' as before_rows,
        document->'afterRows' as after_rows,
        nullif(document->'phaseTransition', 'null'::jsonb) as phase_transition,
        nullif(
          document->'completionEffects'->'materialStamp',
          'null'::jsonb
        ) as material_stamp,
        document->'completionEffects'->'contactLogs' as contact_logs,
        document->'sourceAssertion' as source_assertion
      from (select ${document}::jsonb as document) source
    ), task_plan as materialized (
      select
        (value->>'taskId')::uuid as task_id,
        nullif(value->'before', 'null'::jsonb) as before_state,
        value->'after' as after_state
      from plan, jsonb_array_elements(plan.task_writes) value
    ), subject_plan as materialized (
      select (value->>'id')::uuid as task_id, value as before_state
      from plan, jsonb_array_elements(plan.subject_tasks) value
    ), source_task_plan as materialized (
      select (value->>'id')::uuid as task_id, value as before_state
      from plan, jsonb_array_elements(plan.source_tasks) value
    ), child_set_plan as materialized (
      select
        (value->>'parentTaskId')::uuid as parent_task_id,
        value->'taskIds' as task_ids
      from plan, jsonb_array_elements(plan.child_sets) value
    ), dependency_plan as materialized (
      select
        (value->>'taskId')::uuid as task_id,
        value->'beforePrerequisiteIds' as before_ids,
        value->'afterPrerequisiteIds' as after_ids
      from plan, jsonb_array_elements(plan.dependency_sets) value
    ), notification_scope as materialized (
      select value::uuid as task_id
      from plan, jsonb_array_elements_text(plan.notification_scope_ids) value
    ), notification_before as materialized (
      select
        (value->>'notificationId')::uuid as notification_id,
        (value->>'recipientUserId')::uuid as recipient_user_id,
        value->>'dedupeKey' as dedupe_key,
        value
      from plan, jsonb_array_elements(plan.before_rows) value
    ), notification_after as materialized (
      select
        (value->>'notificationId')::uuid as notification_id,
        (value->>'recipientUserId')::uuid as recipient_user_id,
        value->>'dedupeKey' as dedupe_key,
        value->>'expectedUpdatedAt' as expected_updated_at,
        value
      from plan, jsonb_array_elements(plan.after_rows) value
    ), contact_plan as materialized (
      select
        value->>'kind' as kind,
        (value->>'taskId')::uuid as task_id,
        nullif(value->>'personId', '')::uuid as person_id,
        value->>'expectedPersonEmail' as expected_person_email,
        nullif(value->>'communicationId', '')::uuid as communication_id,
        nullif(value->>'recipientId', '')::uuid as recipient_id,
        nullif(value->>'existingRecipientId', '')::uuid as existing_recipient_id,
        value->>'reason' as reason,
        value
      from plan, jsonb_array_elements(plan.contact_logs) value
    ), ${effectPrelude({
      execution: input.execution,
      effectKey: input.effectKey,
      current,
      affectedCount,
      excludedCount,
    })}, task_updated as materialized (
      update tasks target
      set
        title = p.after_state->>'title',
        description = p.after_state->>'description',
        status = p.after_state->>'status',
        priority = p.after_state->>'priority',
        due_date = nullif(p.after_state->>'dueDate', '')::date,
        due_time = nullif(p.after_state->>'dueTime', '')::time,
        assigned_to_id = nullif(p.after_state->>'assignedToId', '')::uuid,
        category = p.after_state->>'category',
        related_type = p.after_state->>'relatedType',
        related_id = nullif(p.after_state->>'relatedId', '')::uuid,
        parent_task_id = nullif(p.after_state->>'parentTaskId', '')::uuid,
        is_recurring = (p.after_state->>'isRecurring')::boolean,
        recurrence_rule = nullif(p.after_state->'recurrenceRule', 'null'::jsonb),
        completion_event = p.after_state->>'completionEvent',
        completed_at = (p.after_state->>'completedAt')::timestamptz,
        completed_by_id = nullif(p.after_state->>'completedById', '')::uuid,
        updated_at = (p.after_state->>'updatedAt')::timestamptz,
        deleted_at = (p.after_state->>'deletedAt')::timestamptz
      from task_plan p, claimed c
      where p.before_state is not null
        and target.id = p.task_id and target.church_id = c.church_id
        and ${serializedTask(sql`target`)} = p.before_state
      returning target.id
    ), task_inserted as materialized (
      insert into tasks (
        id, church_id, title, description, status, priority, due_date, due_time,
        assigned_to_id, category, related_type, related_id, parent_task_id,
        is_recurring, recurrence_rule, completion_event, completed_at,
        completed_by_id, created_by_id, created_at, updated_at, deleted_at
      )
      select
        p.task_id, c.church_id, p.after_state->>'title',
        p.after_state->>'description', p.after_state->>'status',
        p.after_state->>'priority', nullif(p.after_state->>'dueDate', '')::date,
        nullif(p.after_state->>'dueTime', '')::time,
        nullif(p.after_state->>'assignedToId', '')::uuid,
        p.after_state->>'category', p.after_state->>'relatedType',
        nullif(p.after_state->>'relatedId', '')::uuid,
        nullif(p.after_state->>'parentTaskId', '')::uuid,
        (p.after_state->>'isRecurring')::boolean,
        nullif(p.after_state->'recurrenceRule', 'null'::jsonb),
        p.after_state->>'completionEvent',
        (p.after_state->>'completedAt')::timestamptz,
        nullif(p.after_state->>'completedById', '')::uuid,
        (p.after_state->>'createdById')::uuid,
        (p.after_state->>'createdAt')::timestamptz,
        (p.after_state->>'updatedAt')::timestamptz,
        (p.after_state->>'deletedAt')::timestamptz
      from task_plan p, claimed c
      where p.before_state is null
      returning id
    ), dependencies_deleted as materialized (
      delete from task_dependencies dependency
      using dependency_plan p, claimed c
      where dependency.church_id = c.church_id and dependency.task_id = p.task_id
      returning dependency.id
    ), dependencies_inserted as materialized (
      insert into task_dependencies (
        id, church_id, task_id, prerequisite_task_id, created_at
      )
      select gen_random_uuid(), c.church_id, p.task_id, value::uuid,
             transaction_timestamp()
      from dependency_plan p, claimed c,
           jsonb_array_elements_text(p.after_ids) value
      returning id
    ), notifications_cancelled as materialized (
      update notifications notification
      set status = 'cancelled', updated_at = transaction_timestamp()
      from notification_before p, claimed c
      where notification.id = p.notification_id
        and notification.church_id = c.church_id
        and not exists (
          select 1 from notification_after kept
          where kept.notification_id = p.notification_id
        )
      returning notification.id
    ), notifications_inserted as materialized (
      insert into notifications (
        id, anchor_type, church_id, recipient_user_id, category, type, title,
        body, entity_type, entity_id, dedupe_key, scheduled_for, status,
        created_at, updated_at
      )
      select
        p.notification_id, 'church', c.church_id, p.recipient_user_id,
        'tasks', p.value->>'type', p.value->>'title', p.value->>'body',
        'task', (p.value->>'entityId')::uuid, p.dedupe_key,
        (p.value->>'scheduledFor')::timestamptz, 'pending',
        transaction_timestamp(), transaction_timestamp()
      from notification_after p, claimed c
      where p.expected_updated_at is null
      returning id
    ), phase_answer_inserted as materialized (
      insert into phase_prompt_answers (
        id, church_id, transition_id, answer, answered_by_id, created_at
      )
      select
        ((select phase_transition->>'answerId' from plan))::uuid,
        c.church_id,
        ((select phase_transition->>'transitionId' from plan))::uuid,
        (select phase_transition->>'answer' from plan),
        c.actor_user_id, transaction_timestamp()
      from claimed c
      where (select phase_transition from plan) is not null
      returning id
    ), material_stamp_updated as materialized (
      update churches church
      set
        last_material_event_at =
          ((select material_stamp->>'nextLastMaterialEventAt' from plan))::timestamptz,
        updated_at =
          ((select material_stamp->>'nextChurchUpdatedAt' from plan))::timestamptz
      from claimed c
      where church.id = c.church_id
        and (select material_stamp from plan) is not null
        and church.last_material_event_at is not distinct from
          ((select material_stamp->>'expectedLastMaterialEventAt' from plan))::timestamptz
        and to_char(
          date_trunc('milliseconds', church.updated_at),
          'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
        ) = (select material_stamp->>'expectedChurchUpdatedAt' from plan)
      returning church.id
    ), contact_communications_inserted as materialized (
      insert into communications (
        id, church_id, subject, body, body_html, channel, status, sent_at,
        recipient_count, created_by_id, created_at, updated_at
      )
      select
        contact.communication_id, c.church_id, contact.value->>'subject',
        contact.value->>'body', null, 'email', 'logged',
        (contact.value->>'completedAt')::timestamptz, 1,
        (contact.value->>'createdById')::uuid,
        (contact.value->>'createdAt')::timestamptz,
        (contact.value->>'createdAt')::timestamptz
      from contact_plan contact, claimed c
      where contact.kind = 'create'
      returning id
    ), contact_recipients_inserted as materialized (
      insert into communication_recipients (
        id, church_id, communication_id, person_id, email, channel, status,
        external_id
      )
      select
        contact.recipient_id, c.church_id, contact.communication_id,
        contact.person_id, contact.expected_person_email, 'email', 'sent',
        concat('task:', contact.task_id::text)
      from contact_plan contact
      join contact_communications_inserted inserted
        on inserted.id = contact.communication_id
      cross join claimed c
      where contact.kind = 'create'
      returning id
    ), mutation_complete as materialized (
      select
        (select count(*) from task_updated) =
          (select count(*) from task_plan where before_state is not null)
        and (select count(*) from task_inserted) =
          (select count(*) from task_plan where before_state is null)
        and (select count(*) from dependencies_deleted) =
          (select coalesce(sum(jsonb_array_length(before_ids)), 0) from dependency_plan)
        and (select count(*) from dependencies_inserted) =
          (select coalesce(sum(jsonb_array_length(after_ids)), 0) from dependency_plan)
        and (select count(*) from notifications_cancelled) = (
          select count(*) from notification_before p
          where not exists (
            select 1 from notification_after kept
            where kept.notification_id = p.notification_id
          )
        )
        and (select count(*) from notifications_inserted) =
          (select count(*) from notification_after where expected_updated_at is null)
        and (select count(*) from phase_answer_inserted) =
          case when (select phase_transition from plan) is null then 0 else 1 end
        and (select count(*) from material_stamp_updated) =
          case when (select material_stamp from plan) is null then 0 else 1 end
        and (select count(*) from contact_communications_inserted) =
          (select count(*) from contact_plan where kind = 'create')
        and (select count(*) from contact_recipients_inserted) =
          (select count(*) from contact_plan where kind = 'create')
        as ok
    ), asserted as materialized (
      select 1 / case
        when not exists (select 1 from claimed)
          or coalesce((select ok from mutation_complete), false)
        then 1 else 0 end as ok
    )
    select e.affected_count, e.excluded_count
    from existing e cross join asserted
    union all
    select c.affected_count, c.excluded_count
    from claimed c cross join asserted
    limit 1
  `;
}

/** Read-only checkpoint using the same exact predicates repeated by execution. */
export async function taskEffectArgumentsAreCurrent(input: {
  actorUserId: string;
  plantId: string;
  exportName: TaskEffectExport;
  args: AnyTaskEffectArguments;
}): Promise<boolean> {
  const execution: Execution = {
    attemptId: "00000000-0000-4000-8000-000000000001",
    planId: "00000000-0000-4000-8000-000000000002",
    actorUserId: input.actorUserId,
    plantId: input.plantId,
    fingerprint: "0".repeat(64),
    correlationId: "00000000-0000-4000-8000-000000000003",
    stepId: TASK_ACTION_CONTRACTS[input.exportName].operationId,
    capabilityIdentity: TASK_ACTION_CONTRACTS[input.exportName].operationId,
  };
  const document = JSON.stringify({
    ...input.args,
    beforeRows: input.args.notifications.before,
    afterRows: input.args.notifications.after,
  });
  const result = await db.execute<{ current: boolean }>(sql`
    with plan as materialized (
      select
        document->'taskWrites' as task_writes,
        document->'subjectTasks' as subject_tasks,
        document->'sourceTasks' as source_tasks,
        document->'childSets' as child_sets,
        document->'dependencySets' as dependency_sets,
        document->'notifications'->'scopedTaskIds' as notification_scope_ids,
        document->'beforeRows' as before_rows,
        document->'afterRows' as after_rows,
        nullif(document->'phaseTransition', 'null'::jsonb) as phase_transition,
        nullif(
          document->'completionEffects'->'materialStamp',
          'null'::jsonb
        ) as material_stamp,
        document->'completionEffects'->'contactLogs' as contact_logs,
        document->'sourceAssertion' as source_assertion
      from (select ${document}::jsonb as document) source
    ), task_plan as materialized (
      select (value->>'taskId')::uuid as task_id,
             nullif(value->'before', 'null'::jsonb) as before_state,
             value->'after' as after_state
      from plan, jsonb_array_elements(plan.task_writes) value
    ), subject_plan as materialized (
      select (value->>'id')::uuid as task_id, value as before_state
      from plan, jsonb_array_elements(plan.subject_tasks) value
    ), source_task_plan as materialized (
      select (value->>'id')::uuid as task_id, value as before_state
      from plan, jsonb_array_elements(plan.source_tasks) value
    ), child_set_plan as materialized (
      select (value->>'parentTaskId')::uuid as parent_task_id,
             value->'taskIds' as task_ids
      from plan, jsonb_array_elements(plan.child_sets) value
    ), dependency_plan as materialized (
      select (value->>'taskId')::uuid as task_id,
             value->'beforePrerequisiteIds' as before_ids,
             value->'afterPrerequisiteIds' as after_ids
      from plan, jsonb_array_elements(plan.dependency_sets) value
    ), notification_scope as materialized (
      select value::uuid as task_id
      from plan, jsonb_array_elements_text(plan.notification_scope_ids) value
    ), notification_before as materialized (
      select (value->>'notificationId')::uuid as notification_id,
             (value->>'recipientUserId')::uuid as recipient_user_id,
             value->>'dedupeKey' as dedupe_key, value
      from plan, jsonb_array_elements(plan.before_rows) value
    ), notification_after as materialized (
      select (value->>'notificationId')::uuid as notification_id,
             (value->>'recipientUserId')::uuid as recipient_user_id,
             value->>'dedupeKey' as dedupe_key,
             value->>'expectedUpdatedAt' as expected_updated_at, value
      from plan, jsonb_array_elements(plan.after_rows) value
    ), contact_plan as materialized (
      select
        value->>'kind' as kind,
        (value->>'taskId')::uuid as task_id,
        nullif(value->>'personId', '')::uuid as person_id,
        value->>'expectedPersonEmail' as expected_person_email,
        nullif(value->>'communicationId', '')::uuid as communication_id,
        nullif(value->>'recipientId', '')::uuid as recipient_id,
        nullif(value->>'existingRecipientId', '')::uuid as existing_recipient_id,
        value->>'reason' as reason,
        value
      from plan, jsonb_array_elements(plan.contact_logs) value
    )
    select (
      ${authorityCurrent({ execution, exportName: input.exportName })}
      and ${taskStateCurrent(execution, input.exportName)}
      and ${dependencyStateCurrent(execution)}
      and ${childSetStateCurrent(execution)}
      and ${notificationStateCurrent(execution)}
      and ${sourceStateCurrent(execution)}
      and ${phaseStateCurrent(execution)}
      and ${completionStateCurrent(execution)}
    ) as current
  `);
  return result.rows[0]?.current === true;
}

/** Execute one closed Task operation; arbitrary SQL is never part of the plan. */
export async function executeTaskEffect(
  input: EvryEffectInput
): Promise<EvryEffectResult> {
  const exportName = EXPORT_BY_IDENTITY.get(input.execution.capabilityIdentity);
  if (!exportName || !exactTuple(input, input.execution.capabilityIdentity)) {
    return { status: "refused", excludedCount: 1 };
  }
  const parsed = TASKS_EFFECT_ARGUMENT_SCHEMAS[exportName].safeParse(
    input.arguments
  );
  if (!parsed.success || parsed.data.operation !== exportName) {
    return { status: "refused", excludedCount: 1 };
  }
  const statement = mutationStatement({
    exportName,
    execution: input.execution,
    effectKey: input.effectKey,
    args: parsed.data,
  });
  try {
    const [, , result] = await db.batch([
      db.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${input.effectKey}, 0))`
      ),
      taskStructureLockStatement(input.execution.plantId),
      db.execute<CompletedEffectRow>(statement),
    ]);
    const row = result.rows[0];
    if (row) {
      return {
        status: "completed",
        affectedCount: row.affected_count,
        excludedCount: row.excluded_count,
      };
    }
  } catch {
    const recovered = await exactCompletedOutcome(input);
    return recovered ?? { status: "refused", excludedCount: 1 };
  }
  return (
    (await exactCompletedOutcome(input)) ?? {
      status: "refused",
      excludedCount: 1,
    }
  );
}
