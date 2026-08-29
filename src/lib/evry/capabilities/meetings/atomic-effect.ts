import { and, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { evryExecutionOutcomes } from "@/db/schema";
import {
  executionStepOutcomeKey,
  type EvryAuditKey,
} from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";

import {
  MEETINGS_ACTION_CONTRACTS,
  type MeetingsActionExport,
} from "./catalog";
import {
  MEETINGS_EFFECT_ARGUMENT_SCHEMAS,
  type MeetingsEffectArguments,
} from "./effect-contracts";

interface CompletedEffectRow extends Record<string, unknown> {
  affected_count: number;
  excluded_count: number;
}

type Execution = EvryEffectInput["execution"];

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

/** Fixed claim prelude shared by the closed Meetings statement table. */
function effectPrelude(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  current: SQL;
  affectedCount: number;
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
        'completed', 'effect_completed', ${input.affectedCount}, 0,
        transaction_timestamp()
      from eligible e
      on conflict do nothing
      returning affected_count, excluded_count, church_id, actor_user_id
    )`;
}

/** False postconditions abort the claim and every write in the statement. */
function effectTail(): SQL {
  return sql`
    asserted as materialized (
      select 1 / case
        when not exists (select 1 from claimed)
          or coalesce((select ok from mutation_complete), false)
        then 1 else 0 end as ok
    )
    select e.affected_count, e.excluded_count
    from existing e
    cross join asserted
    union all
    select c.affected_count, c.excluded_count
    from claimed c
    cross join asserted
    limit 1`;
}

function timestamp(value: string): SQL {
  // Meeting datetimes are UTC-pinned wall clocks. Passing a Date lets the
  // driver serialize through the process's local zone before writing the
  // timestamp-without-time-zone column, so the same plan changes with TZ.
  return sql`${value}::timestamp`;
}

/**
 * PostgreSQL timestamps retain microseconds while a durable Evry plan crosses
 * the JSON boundary as a JavaScript Date (milliseconds). Compare the exact
 * serialized version instead of making every freshly planned row stale when
 * its database timestamp has non-zero microseconds.
 */
function serializedTimestampMatches(column: SQL, value: string): SQL {
  return sql`to_char(
    date_trunc('milliseconds', ${column}),
    'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
  ) = ${value}`;
}

function nullableSerializedTimestampMatches(
  column: SQL,
  value: string | null
): SQL {
  return value === null
    ? sql`${column} is null`
    : serializedTimestampMatches(column, value);
}

/** Match every owning attendance-classification input inside the claim. */
function attendanceDerivationBaselineMatches(input: {
  plantId: string;
  meetingId: SQL;
  personId: SQL;
  attendanceType: SQL;
  baseline: MeetingsEffectArguments<"addWalkInAttendeeAction">["attendanceDerivation"];
}): SQL {
  const priorAttendances = JSON.stringify(input.baseline.priorAttendances);
  return sql`exists (
    select 1
    from church_meetings current_meeting
    join persons current_person
      on current_person.id = ${input.personId}
     and current_person.church_id = current_meeting.church_id
     and current_person.deleted_at is null
    where current_meeting.id = ${input.meetingId}
      and current_meeting.church_id = ${input.plantId}::uuid
      and current_person.status = ${input.baseline.personStatus}
      and date_trunc('milliseconds', current_meeting.datetime) =
        ${timestamp(input.baseline.meetingDatetime)}
      and case
        when current_person.status in ('core_group', 'launch_team', 'leader')
          then 'core_group'
        when exists (
          select 1
          from meeting_attendance prior_attendance
          join church_meetings prior_meeting
            on prior_meeting.id = prior_attendance.meeting_id
           and prior_meeting.church_id = prior_attendance.church_id
          where prior_attendance.church_id = ${input.plantId}::uuid
            and prior_attendance.person_id = current_person.id
            and prior_attendance.status = 'attended'
            and prior_attendance.meeting_id <> current_meeting.id
            and prior_meeting.datetime < current_meeting.datetime
        ) then 'returning'
        else 'first_time'
      end = ${input.attendanceType}
      and not exists (
        select 1
        from meeting_attendance prior_attendance
        join church_meetings prior_meeting
          on prior_meeting.id = prior_attendance.meeting_id
         and prior_meeting.church_id = prior_attendance.church_id
        where prior_attendance.church_id = ${input.plantId}::uuid
          and prior_attendance.person_id = current_person.id
          and prior_attendance.status = 'attended'
          and prior_attendance.meeting_id <> current_meeting.id
          and prior_meeting.datetime < current_meeting.datetime
          and not exists (
            select 1
            from jsonb_array_elements(${priorAttendances}::jsonb) baseline
            where (baseline->>'attendanceId')::uuid = prior_attendance.id
              and (baseline->>'meetingId')::uuid = prior_meeting.id
              and date_trunc('milliseconds', prior_meeting.datetime) =
                (baseline->>'meetingDatetime')::timestamp
          )
      )
      and not exists (
        select 1
        from jsonb_array_elements(${priorAttendances}::jsonb) baseline
        left join meeting_attendance prior_attendance
          on prior_attendance.id = (baseline->>'attendanceId')::uuid
         and prior_attendance.church_id = ${input.plantId}::uuid
         and prior_attendance.person_id = current_person.id
         and prior_attendance.status = 'attended'
        left join church_meetings prior_meeting
          on prior_meeting.id = (baseline->>'meetingId')::uuid
         and prior_meeting.id = prior_attendance.meeting_id
         and prior_meeting.church_id = prior_attendance.church_id
        where prior_attendance.id is null
          or prior_meeting.id is null
          or prior_meeting.id = current_meeting.id
          or prior_meeting.datetime >= current_meeting.datetime
          or date_trunc('milliseconds', prior_meeting.datetime) is distinct from
            (baseline->>'meetingDatetime')::timestamp
      )
  )`;
}

function locationStateCurrent(
  alias: SQL,
  state: MeetingsEffectArguments<"updateLocationAction">["before"]
): SQL {
  return sql`${alias}.name = ${state.name}
    and ${alias}.address = ${state.address}
    and ${alias}.contact_name is not distinct from ${state.contactName}
    and ${alias}.contact_phone is not distinct from ${state.contactPhone}
    and ${alias}.contact_email is not distinct from ${state.contactEmail}
    and ${alias}.cost is not distinct from ${state.cost}
    and ${alias}.capacity is not distinct from ${state.capacity}
    and ${alias}.notes is not distinct from ${state.notes}
    and ${alias}.is_active = ${state.isActive}`;
}

function createLocationStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"createLocationAction">;
}): SQL {
  const { args } = input;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`not exists (
        select 1 from locations where id = ${args.locationId}::uuid
      )`,
    })}, location_inserted as (
      insert into locations (
        id, church_id, name, address, contact_name, contact_phone,
        contact_email, cost, capacity, notes, is_active, created_at, updated_at
      )
      select
        ${args.locationId}::uuid, c.church_id, ${args.name}, ${args.address},
        ${args.contactName}, ${args.contactPhone}, ${args.contactEmail},
        ${args.cost}, ${args.capacity}, ${args.notes}, true,
        transaction_timestamp(), transaction_timestamp()
      from claimed c
      returning id
    ), mutation_complete as (
      select count(*) = 1 as ok from location_inserted
    ), ${effectTail()}
  `;
}

function updateLocationStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"updateLocationAction">;
}): SQL {
  const { args } = input;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`exists (
        select 1 from locations l
        where l.id = ${args.locationId}::uuid
          and l.church_id = ${input.execution.plantId}::uuid
          and ${serializedTimestampMatches(sql`l.updated_at`, args.expectedUpdatedAt)}
          and ${locationStateCurrent(sql`l`, args.before)}
      )`,
    })}, location_updated as (
      update locations l
      set name = ${args.after.name}, address = ${args.after.address},
          contact_name = ${args.after.contactName},
          contact_phone = ${args.after.contactPhone},
          contact_email = ${args.after.contactEmail}, cost = ${args.after.cost},
          capacity = ${args.after.capacity}, notes = ${args.after.notes},
          is_active = ${args.after.isActive},
          updated_at = transaction_timestamp()
      from claimed c
      where l.id = ${args.locationId}::uuid
        and l.church_id = c.church_id
        and ${serializedTimestampMatches(sql`l.updated_at`, args.expectedUpdatedAt)}
        and ${locationStateCurrent(sql`l`, args.before)}
      returning l.id
    ), mutation_complete as (
      select count(*) = 1 as ok from location_updated
    ), ${effectTail()}
  `;
}

function attendeeNoteStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"addAttendeeNoteAction">;
}): SQL {
  const { args } = input;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`exists (
        select 1
        from church_meetings m
        join persons p on p.id = ${args.personId}::uuid
        where m.id = ${args.meetingId}::uuid
          and m.church_id = ${input.execution.plantId}::uuid
          and m.type = ${args.meetingType}
          and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedMeetingUpdatedAt)}
          and p.church_id = m.church_id and p.deleted_at is null
          and ${serializedTimestampMatches(sql`p.updated_at`, args.expectedPersonUpdatedAt)}
          and not exists (
            select 1 from person_activities a
            where a.id = ${args.activityId}::uuid
          )
      )`,
    })}, activity_inserted as (
      insert into person_activities (
        id, church_id, person_id, activity_type, metadata, performed_by,
        created_at
      )
      select
        ${args.activityId}::uuid, c.church_id, ${args.personId}::uuid,
        'note_added', ${JSON.stringify({
          note: args.note,
          meetingId: args.meetingId,
          meetingType: args.meetingType,
        })}::jsonb,
        c.actor_user_id, transaction_timestamp()
      from claimed c
      returning id
    ), mutation_complete as (
      select count(*) = 1 as ok from activity_inserted
    ), ${effectTail()}
  `;
}

function saveAgendaStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"saveAgendaAction">;
}): SQL {
  const { args } = input;
  const before = JSON.stringify(args.beforeSections);
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`exists (
        select 1 from church_meetings m
        where m.id = ${args.meetingId}::uuid
          and m.church_id = ${input.execution.plantId}::uuid
          and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedUpdatedAt)}
          and coalesce(m.agenda, '[]'::jsonb) = ${before}::jsonb
      )`,
    })}, meeting_updated as (
      update church_meetings m
      set agenda = ${JSON.stringify(args.afterSections)}::jsonb,
          updated_at = transaction_timestamp()
      from claimed c
      where m.id = ${args.meetingId}::uuid and m.church_id = c.church_id
        and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedUpdatedAt)}
        and coalesce(m.agenda, '[]'::jsonb) = ${before}::jsonb
      returning m.id
    ), mutation_complete as (
      select count(*) = 1 as ok from meeting_updated
    ), ${effectTail()}
  `;
}

function toggleChecklistStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"toggleChecklistItemAction">;
}): SQL {
  const { args } = input;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`exists (
        select 1 from meeting_checklist_items i
        join church_meetings m
          on m.id = i.meeting_id and m.church_id = i.church_id
        where i.id = ${args.itemId}::uuid
          and i.meeting_id = ${args.meetingId}::uuid
          and i.church_id = ${input.execution.plantId}::uuid
          and i.is_checked = ${args.beforeChecked}
          and ${serializedTimestampMatches(sql`i.updated_at`, args.expectedUpdatedAt)}
      )`,
    })}, item_updated as (
      update meeting_checklist_items i
      set is_checked = ${args.afterChecked}, updated_at = transaction_timestamp()
      from claimed c
      where i.id = ${args.itemId}::uuid
        and i.meeting_id = ${args.meetingId}::uuid
        and i.church_id = c.church_id
        and i.is_checked = ${args.beforeChecked}
        and ${serializedTimestampMatches(sql`i.updated_at`, args.expectedUpdatedAt)}
      returning i.id
    ), mutation_complete as (
      select count(*) = 1 as ok from item_updated
    ), ${effectTail()}
  `;
}

function updateChecklistStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"updateChecklistItemAction">;
}): SQL {
  const { args } = input;
  const assigneeCurrent = args.afterAssignedTo
    ? sql`exists (
        select 1 from persons p
        where p.id = ${args.afterAssignedTo}::uuid
          and p.church_id = ${input.execution.plantId}::uuid
          and p.deleted_at is null
          and ${serializedTimestampMatches(sql`p.updated_at`, args.expectedAssignedPersonUpdatedAt!)}
      )`
    : sql`${args.expectedAssignedPersonUpdatedAt === null}`;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`${assigneeCurrent} and exists (
        select 1 from meeting_checklist_items i
        join church_meetings m
          on m.id = i.meeting_id and m.church_id = i.church_id
        where i.id = ${args.itemId}::uuid
          and i.meeting_id = ${args.meetingId}::uuid
          and i.church_id = ${input.execution.plantId}::uuid
          and i.notes is not distinct from ${args.beforeNotes}
          and i.assigned_to is not distinct from ${args.beforeAssignedTo}::uuid
          and ${serializedTimestampMatches(sql`i.updated_at`, args.expectedUpdatedAt)}
      )`,
    })}, item_updated as (
      update meeting_checklist_items i
      set notes = ${args.afterNotes}, assigned_to = ${args.afterAssignedTo}::uuid,
          updated_at = transaction_timestamp()
      from claimed c
      where i.id = ${args.itemId}::uuid
        and i.meeting_id = ${args.meetingId}::uuid and i.church_id = c.church_id
        and i.notes is not distinct from ${args.beforeNotes}
        and i.assigned_to is not distinct from ${args.beforeAssignedTo}::uuid
        and ${serializedTimestampMatches(sql`i.updated_at`, args.expectedUpdatedAt)}
      returning i.id
    ), mutation_complete as (
      select count(*) = 1 as ok from item_updated
    ), ${effectTail()}
  `;
}

function updateRsvpStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"updateRsvpStatusAction">;
}): SQL {
  const { args } = input;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`exists (
        select 1 from meeting_attendance a
        join church_meetings m on m.id = a.meeting_id and m.church_id = a.church_id
        join persons p on p.id = a.person_id and p.church_id = a.church_id
        where a.meeting_id = ${args.meetingId}::uuid
          and a.person_id = ${args.personId}::uuid
          and a.church_id = ${input.execution.plantId}::uuid
          and p.deleted_at is null
          and a.response_status is not distinct from ${args.beforeStatus}
          and ${serializedTimestampMatches(sql`a.updated_at`, args.expectedAttendanceUpdatedAt)}
      )`,
    })}, attendance_updated as (
      update meeting_attendance a
      set response_status = ${args.afterStatus}, updated_at = transaction_timestamp()
      from claimed c
      where a.meeting_id = ${args.meetingId}::uuid
        and a.person_id = ${args.personId}::uuid and a.church_id = c.church_id
        and a.response_status is not distinct from ${args.beforeStatus}
        and ${serializedTimestampMatches(sql`a.updated_at`, args.expectedAttendanceUpdatedAt)}
      returning a.id
    ), mutation_complete as (
      select count(*) = 1 as ok from attendance_updated
    ), ${effectTail()}
  `;
}

function toggleAttendanceStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"toggleAttendanceStatusAction">;
}): SQL {
  const { args } = input;
  const attendanceTypeCurrent =
    args.afterStatus === "attended"
      ? attendanceDerivationBaselineMatches({
          plantId: input.execution.plantId,
          meetingId: sql`${args.meetingId}::uuid`,
          personId: sql`${args.personId}::uuid`,
          attendanceType: sql`${args.afterAttendanceType}`,
          baseline: args.attendanceDerivation!,
        })
      : sql`${args.afterAttendanceType === null && args.attendanceDerivation === null}`;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`${attendanceTypeCurrent} and exists (
        select 1 from meeting_attendance a
        join church_meetings m on m.id = a.meeting_id and m.church_id = a.church_id
        join persons p on p.id = a.person_id and p.church_id = a.church_id
        where a.meeting_id = ${args.meetingId}::uuid
          and a.person_id = ${args.personId}::uuid
          and a.church_id = ${input.execution.plantId}::uuid
          and p.deleted_at is null and a.status = ${args.beforeStatus}
          and ${serializedTimestampMatches(sql`a.updated_at`, args.expectedAttendanceUpdatedAt)}
      )`,
    })}, attendance_updated as (
      update meeting_attendance a
      set status = ${args.afterStatus},
          attendance_type = ${args.afterAttendanceType},
          updated_at = transaction_timestamp()
      from claimed c
      where a.meeting_id = ${args.meetingId}::uuid
        and a.person_id = ${args.personId}::uuid and a.church_id = c.church_id
        and a.status = ${args.beforeStatus}
        and ${serializedTimestampMatches(sql`a.updated_at`, args.expectedAttendanceUpdatedAt)}
      returning a.id
    ), mutation_complete as (
      select count(*) = 1 as ok from attendance_updated
    ), ${effectTail()}
  `;
}

function recordAttendanceBatchStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"recordAttendanceBatchAction">;
}): SQL {
  const { args } = input;
  const records = JSON.stringify(args.records);
  const derivationsCurrent = sql.join(
    args.records.map((record) =>
      record.afterStatus === "attended"
        ? attendanceDerivationBaselineMatches({
            plantId: input.execution.plantId,
            meetingId: sql`${args.meetingId}::uuid`,
            personId: sql`${record.personId}::uuid`,
            attendanceType: sql`${record.afterAttendanceType}`,
            baseline: record.attendanceDerivation!,
          })
        : sql`${record.afterAttendanceType === null && record.attendanceDerivation === null}`
    ),
    sql` and `
  );
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: args.records.length,
      current: sql`${derivationsCurrent} and exists (
        select 1 from church_meetings m
        where m.id = ${args.meetingId}::uuid
          and m.church_id = ${input.execution.plantId}::uuid
          and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedMeetingUpdatedAt)}
      ) and not exists (
        select 1
        from jsonb_array_elements(${records}::jsonb) entry
        left join persons p
          on p.id = (entry->>'personId')::uuid
         and p.church_id = ${input.execution.plantId}::uuid
         and p.deleted_at is null
        left join meeting_attendance a
          on a.id = (entry->>'attendanceId')::uuid
         and a.meeting_id = ${args.meetingId}::uuid
         and a.person_id = (entry->>'personId')::uuid
         and a.church_id = ${input.execution.plantId}::uuid
        where p.id is null
          or case
            when (entry->'before'->>'exists')::boolean then
              a.id is null
              or a.id is distinct from (entry->'before'->>'id')::uuid
              or a.status is distinct from entry->'before'->>'status'
              or a.attendance_type is distinct from entry->'before'->>'attendanceType'
              or a.response_status is distinct from entry->'before'->>'responseStatus'
              or a.notes is distinct from entry->'before'->>'notes'
              or date_trunc('milliseconds', a.updated_at) is distinct from
                (entry->'before'->>'updatedAt')::timestamp
            else a.id is not null
          end
      )`,
    })}, record_input as materialized (
      select entry
      from jsonb_array_elements(${records}::jsonb) entry
    ), attendance_updated as (
      update meeting_attendance a
      set status = r.entry->>'afterStatus',
          attendance_type = r.entry->>'afterAttendanceType',
          updated_at = transaction_timestamp()
      from claimed c, record_input r
      where (r.entry->'before'->>'exists')::boolean
        and a.id = (r.entry->>'attendanceId')::uuid
        and a.meeting_id = ${args.meetingId}::uuid
        and a.person_id = (r.entry->>'personId')::uuid
        and a.church_id = c.church_id
        and a.id = (r.entry->'before'->>'id')::uuid
        and a.status is not distinct from r.entry->'before'->>'status'
        and a.attendance_type is not distinct from r.entry->'before'->>'attendanceType'
        and a.response_status is not distinct from r.entry->'before'->>'responseStatus'
        and a.notes is not distinct from r.entry->'before'->>'notes'
        and date_trunc('milliseconds', a.updated_at) =
          (r.entry->'before'->>'updatedAt')::timestamp
      returning a.id
    ), attendance_inserted as (
      insert into meeting_attendance (
        id, church_id, meeting_id, person_id, attendance_type, status,
        created_by, created_at, updated_at
      )
      select
        (r.entry->>'attendanceId')::uuid, c.church_id,
        ${args.meetingId}::uuid, (r.entry->>'personId')::uuid,
        r.entry->>'afterAttendanceType', r.entry->>'afterStatus',
        c.actor_user_id, transaction_timestamp(), transaction_timestamp()
      from claimed c
      cross join record_input r
      where not (r.entry->'before'->>'exists')::boolean
      returning id
    ), mutation_complete as (
      select
        (select count(*) from attendance_updated)
        + (select count(*) from attendance_inserted)
        = ${args.records.length} as ok
    ), ${effectTail()}
  `;
}

function clearResponseStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"clearResponseCardAction">;
}): SQL {
  const { args } = input;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`exists (
        select 1 from meeting_attendance a
        join church_meetings m on m.id = a.meeting_id and m.church_id = a.church_id
        join meeting_responses r on r.meeting_id = a.meeting_id
          and r.person_id = a.person_id and r.church_id = a.church_id
        where a.meeting_id = ${args.meetingId}::uuid
          and a.person_id = ${args.personId}::uuid
          and a.church_id = ${input.execution.plantId}::uuid
          and ${serializedTimestampMatches(sql`a.updated_at`, args.expectedAttendanceUpdatedAt)}
          and r.id = ${args.responseId}::uuid
          and r.response_type = ${args.beforeResponse.responseType}
          and r.notes is not distinct from ${args.beforeResponse.notes}
          and r.recorded_by_id is not distinct from ${args.beforeResponse.recordedById}::uuid
          and ${serializedTimestampMatches(sql`r.updated_at`, args.beforeResponse.updatedAt)}
      )`,
    })}, response_deleted as (
      delete from meeting_responses r using claimed c
      where r.id = ${args.responseId}::uuid
        and r.meeting_id = ${args.meetingId}::uuid
        and r.person_id = ${args.personId}::uuid and r.church_id = c.church_id
        and r.response_type = ${args.beforeResponse.responseType}
        and r.notes is not distinct from ${args.beforeResponse.notes}
        and r.recorded_by_id is not distinct from ${args.beforeResponse.recordedById}::uuid
        and ${serializedTimestampMatches(sql`r.updated_at`, args.beforeResponse.updatedAt)}
      returning r.id
    ), mutation_complete as (
      select count(*) = 1 as ok from response_deleted
    ), ${effectTail()}
  `;
}

function recordResponseStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"recordResponseCardAction">;
}): SQL {
  const { args } = input;
  const responseCurrent = args.beforeResponse
    ? sql`exists (
        select 1 from meeting_responses r
        where r.id = ${args.beforeResponse.responseId}::uuid
          and r.meeting_id = ${args.meetingId}::uuid
          and r.person_id = ${args.personId}::uuid
          and r.church_id = ${input.execution.plantId}::uuid
          and r.response_type = ${args.beforeResponse.responseType}
          and r.notes is not distinct from ${args.beforeResponse.notes}
          and r.recorded_by_id is not distinct from ${args.beforeResponse.recordedById}::uuid
          and ${serializedTimestampMatches(sql`r.updated_at`, args.beforeResponse.updatedAt)}
      )`
    : sql`not exists (
        select 1 from meeting_responses r
        where r.meeting_id = ${args.meetingId}::uuid
          and r.person_id = ${args.personId}::uuid
      ) and not exists (
        select 1 from meeting_responses r where r.id = ${args.responseId}::uuid
      )`;
  const responseWritten = args.beforeResponse
    ? sql`update meeting_responses r
      set response_type = ${args.responseType}, notes = ${args.notes},
          recorded_by_id = c.actor_user_id,
          recorded_at = transaction_timestamp(), updated_at = transaction_timestamp()
      from claimed c
      where r.id = ${args.beforeResponse.responseId}::uuid
        and r.meeting_id = ${args.meetingId}::uuid
        and r.person_id = ${args.personId}::uuid and r.church_id = c.church_id
        and r.response_type = ${args.beforeResponse.responseType}
        and r.notes is not distinct from ${args.beforeResponse.notes}
        and r.recorded_by_id is not distinct from ${args.beforeResponse.recordedById}::uuid
        and ${serializedTimestampMatches(sql`r.updated_at`, args.beforeResponse.updatedAt)}
      returning r.id`
    : sql`insert into meeting_responses (
        id, church_id, meeting_id, person_id, response_type, notes,
        recorded_by_id, recorded_at, created_at, updated_at
      )
      select ${args.responseId}::uuid, c.church_id, ${args.meetingId}::uuid,
        ${args.personId}::uuid, ${args.responseType}, ${args.notes},
        c.actor_user_id, transaction_timestamp(), transaction_timestamp(),
        transaction_timestamp()
      from claimed c
      returning id`;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`${responseCurrent} and exists (
        select 1 from meeting_attendance a
        join church_meetings m on m.id = a.meeting_id and m.church_id = a.church_id
        where a.meeting_id = ${args.meetingId}::uuid
          and a.person_id = ${args.personId}::uuid
          and a.church_id = ${input.execution.plantId}::uuid
          and ${serializedTimestampMatches(sql`a.updated_at`, args.expectedAttendanceUpdatedAt)}
      )`,
    })}, response_written as (
      ${responseWritten}
    ), mutation_complete as (
      select count(*) = 1 as ok from response_written
    ), ${effectTail()}
  `;
}

type NotificationTarget =
  MeetingsEffectArguments<"createMeetingAction">["notificationTargets"][number];
type NotificationBaseline =
  MeetingsEffectArguments<"createMeetingAction">["notificationBaseline"];
type PendingNotification =
  MeetingsEffectArguments<"deleteMeetingAction">["pendingNotifications"][number];

function notificationTargetsCurrent(input: {
  plantId: string;
  meetingId: string;
  baseline: NotificationBaseline;
  targets: readonly NotificationTarget[];
  cancelling?: readonly PendingNotification[];
  audience:
    | Readonly<{
        kind: "existing";
        addPersonId?: string;
        removePersonId?: string;
        addEmail?: string | null;
      }>
    | Readonly<{
        kind: "create";
        actorUserId: string;
        rosterPersonIds: readonly string[];
      }>;
}): SQL {
  const targets = JSON.stringify(input.targets);
  const cancelling = JSON.stringify(input.cancelling ?? []);
  const coreGroup = JSON.stringify(input.baseline.coreGroupUserIds);
  const reminderUsers = JSON.stringify(input.baseline.reminderUserIds);
  const activeNotifications = JSON.stringify(
    input.baseline.activeNotifications
  );
  const actualReminderUsers =
    input.audience.kind === "create"
      ? sql`select ${input.audience.actorUserId}::uuid as user_id
          union select distinct u.id
          from persons p join users u
            on u.church_id = ${input.plantId}::uuid
           and lower(u.email) = lower(p.email)
          where p.church_id = ${input.plantId}::uuid
            and p.id in (
              select value::uuid
              from jsonb_array_elements_text(${JSON.stringify(input.audience.rosterPersonIds)}::jsonb) value
            )
            and p.deleted_at is null and p.email is not null`
      : sql`select m.created_by as user_id
          from church_meetings m
          where m.id = ${input.meetingId}::uuid
            and m.church_id = ${input.plantId}::uuid
          union select distinct u.id
          from meeting_attendance a
          join persons p on p.id = a.person_id and p.church_id = a.church_id
          join users u on u.church_id = a.church_id
            and lower(u.email) = lower(p.email)
          where a.meeting_id = ${input.meetingId}::uuid
            and a.church_id = ${input.plantId}::uuid
            and p.deleted_at is null and p.email is not null
            and (${input.audience.removePersonId ?? null}::uuid is null
              or p.id <> ${input.audience.removePersonId ?? null}::uuid)
          union select u.id
          from persons p join users u
            on u.church_id = ${input.plantId}::uuid
           and lower(u.email) = lower(p.email)
          where p.id = ${input.audience.addPersonId ?? null}::uuid
            and p.church_id = ${input.plantId}::uuid
            and p.deleted_at is null and p.email is not null
          union select u.id
          from users u
          where u.church_id = ${input.plantId}::uuid
            and ${input.audience.addEmail ?? null}::text is not null
            and lower(u.email) = lower(${input.audience.addEmail ?? null}::text)`;
  return sql`not exists (
    select u.id
    from persons p join users u
      on u.church_id = ${input.plantId}::uuid
     and lower(u.email) = lower(p.email)
    where p.church_id = ${input.plantId}::uuid
      and p.deleted_at is null and p.email is not null
      and p.status in ('core_group', 'launch_team', 'leader')
    except select value::uuid
    from jsonb_array_elements_text(${coreGroup}::jsonb) value
  ) and not exists (
    select value::uuid
    from jsonb_array_elements_text(${coreGroup}::jsonb) value
    except select u.id
    from persons p join users u
      on u.church_id = ${input.plantId}::uuid
     and lower(u.email) = lower(p.email)
    where p.church_id = ${input.plantId}::uuid
      and p.deleted_at is null and p.email is not null
      and p.status in ('core_group', 'launch_team', 'leader')
  ) and not exists (
    select actual.user_id from (${actualReminderUsers}) actual
    except select value::uuid
    from jsonb_array_elements_text(${reminderUsers}::jsonb) value
  ) and not exists (
    select value::uuid
    from jsonb_array_elements_text(${reminderUsers}::jsonb) value
    except select actual.user_id from (${actualReminderUsers}) actual
  ) and not exists (
    select n.id, n.recipient_user_id, n.type, n.entity_id, n.dedupe_key,
      n.scheduled_for, n.status, date_trunc('milliseconds', n.updated_at)
    from notifications n
    where n.church_id = ${input.plantId}::uuid
      and n.category = 'meetings' and n.entity_type = 'meeting'
      and n.entity_id = ${input.meetingId}::uuid and n.status <> 'cancelled'
    except select (a->>'notificationId')::uuid,
      (a->>'recipientUserId')::uuid, a->>'type', (a->>'entityId')::uuid,
      a->>'dedupeKey', (a->>'scheduledFor')::timestamp,
      a->>'status', (a->>'expectedUpdatedAt')::timestamp
    from jsonb_array_elements(${activeNotifications}::jsonb) a
  ) and not exists (
    select (a->>'notificationId')::uuid,
      (a->>'recipientUserId')::uuid, a->>'type', (a->>'entityId')::uuid,
      a->>'dedupeKey', (a->>'scheduledFor')::timestamp,
      a->>'status', (a->>'expectedUpdatedAt')::timestamp
    from jsonb_array_elements(${activeNotifications}::jsonb) a
    except select n.id, n.recipient_user_id, n.type, n.entity_id, n.dedupe_key,
      n.scheduled_for, n.status, date_trunc('milliseconds', n.updated_at)
    from notifications n
    where n.church_id = ${input.plantId}::uuid
      and n.category = 'meetings' and n.entity_type = 'meeting'
      and n.entity_id = ${input.meetingId}::uuid and n.status <> 'cancelled'
  ) and not exists (
    select 1
    from jsonb_array_elements(${targets}::jsonb) t
    left join users u
      on u.id = (t->>'recipientUserId')::uuid
     and u.church_id = ${input.plantId}::uuid
    where u.id is null
      or t->>'category' <> 'meetings'
      or t->>'entityType' <> 'meeting'
      or (t->>'entityId')::uuid <> ${input.meetingId}::uuid
      or not (
        t->>'type' = 'meeting.scheduled'
        or t->>'type' in (
          'meeting.reminder.7d', 'meeting.reminder.3d', 'meeting.reminder.1d'
        )
      )
      or case
        when t->>'type' = 'meeting.scheduled'
          then t->>'dedupeKey' <> 'meeting.scheduled:' || ${input.meetingId}
        else t->>'dedupeKey' not like
          (t->>'type') || ':' || ${input.meetingId} || ':%'
      end
      or exists (
        select 1 from notifications n
        where n.id = (t->>'notificationId')::uuid
      )
      or exists (
        select 1 from notifications n
        where n.church_id = ${input.plantId}::uuid
          and n.recipient_user_id = (t->>'recipientUserId')::uuid
          and n.dedupe_key = t->>'dedupeKey'
          and n.status <> 'cancelled'
          and not exists (
            select 1 from jsonb_array_elements(${cancelling}::jsonb) p
            where (p->>'notificationId')::uuid = n.id
          )
      )
  )`;
}

function pendingNotificationsCurrent(input: {
  plantId: string;
  meetingId: string;
  pending: readonly PendingNotification[];
}): SQL {
  const pending = JSON.stringify(input.pending);
  return sql`not exists (
    select 1 from notifications n
    where n.church_id = ${input.plantId}::uuid
      and n.category = 'meetings'
      and n.entity_type = 'meeting'
      and n.entity_id = ${input.meetingId}::uuid
      and n.status = 'pending'
      and not exists (
        select 1 from jsonb_array_elements(${pending}::jsonb) p
        where (p->>'notificationId')::uuid = n.id
          and (p->>'recipientUserId')::uuid = n.recipient_user_id
          and p->>'type' = n.type
          and (p->>'entityId')::uuid = n.entity_id
          and p->>'dedupeKey' = n.dedupe_key
          and (p->>'scheduledFor')::timestamp = n.scheduled_for
          and (p->>'expectedUpdatedAt')::timestamp =
            date_trunc('milliseconds', n.updated_at)
      )
  ) and not exists (
    select 1 from jsonb_array_elements(${pending}::jsonb) p
    left join notifications n
      on n.id = (p->>'notificationId')::uuid
     and n.church_id = ${input.plantId}::uuid
     and n.recipient_user_id = (p->>'recipientUserId')::uuid
     and n.category = 'meetings'
     and n.type = p->>'type'
     and n.entity_type = 'meeting'
     and n.entity_id = ${input.meetingId}::uuid
     and n.dedupe_key = p->>'dedupeKey'
     and n.scheduled_for = (p->>'scheduledFor')::timestamp
     and n.status = 'pending'
     and date_trunc('milliseconds', n.updated_at) =
       (p->>'expectedUpdatedAt')::timestamp
    where n.id is null
  )`;
}

function notificationsWritten(input: {
  targets: readonly NotificationTarget[];
  pending?: readonly PendingNotification[];
}): SQL {
  const targets = JSON.stringify(input.targets);
  const pending = JSON.stringify(input.pending ?? []);
  return sql`
    notification_input as materialized (
      select target from jsonb_array_elements(${targets}::jsonb) target
    ), notifications_cancelled as (
      update notifications n
      set status = 'cancelled', updated_at = transaction_timestamp()
      from claimed c, jsonb_array_elements(${pending}::jsonb) p
      where n.id = (p->>'notificationId')::uuid
        and n.church_id = c.church_id
        and n.recipient_user_id = (p->>'recipientUserId')::uuid
        and n.category = 'meetings' and n.type = p->>'type'
        and n.entity_type = 'meeting'
        and n.entity_id = (p->>'entityId')::uuid
        and n.dedupe_key = p->>'dedupeKey'
        and n.scheduled_for = (p->>'scheduledFor')::timestamp
        and n.status = 'pending'
        and date_trunc('milliseconds', n.updated_at) =
          (p->>'expectedUpdatedAt')::timestamp
      returning n.id
    ), notifications_inserted as (
      insert into notifications (
        id, anchor_type, church_id, recipient_user_id, category, type,
        title, body, entity_type, entity_id, dedupe_key, scheduled_for,
        status, created_at, updated_at
      )
      select
        (i.target->>'notificationId')::uuid, 'church', c.church_id,
        (i.target->>'recipientUserId')::uuid, 'meetings',
        i.target->>'type', i.target->>'title', i.target->>'body',
        'meeting', (i.target->>'entityId')::uuid,
        i.target->>'dedupeKey', (i.target->>'scheduledFor')::timestamp,
        'pending', transaction_timestamp(), transaction_timestamp()
      from claimed c cross join notification_input i
      returning id
    )`;
}

function notificationCountsComplete(input: {
  targetCount: number;
  pendingCount?: number;
}): SQL {
  return sql`(select count(*) from notifications_inserted) = ${input.targetCount}
    and (select count(*) from notifications_cancelled) = ${input.pendingCount ?? 0}`;
}

function addAttendanceStatement<
  ExportName extends
    | "addAttendeeAction"
    | "addToGuestListAction"
    | "addWalkInAttendeeAction",
>(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  exportName: ExportName;
  args: MeetingsEffectArguments<ExportName>;
}): SQL {
  const { args } = input;
  const attendanceType = "attendanceType" in args ? args.attendanceType : null;
  const status =
    input.exportName === "addToGuestListAction" ? "absent" : "attended";
  const invitedById = "invitedById" in args ? args.invitedById : null;
  const responseStatus = "responseStatus" in args ? args.responseStatus : null;
  const notes = "notes" in args ? args.notes : null;
  const notificationsCurrent = notificationTargetsCurrent({
    plantId: input.execution.plantId,
    meetingId: args.meetingId,
    baseline: args.notificationBaseline,
    targets: args.notificationTargets,
    audience: { kind: "existing", addPersonId: args.personId },
  });
  const invitedByCurrent = invitedById
    ? sql`exists (
        select 1 from persons invited
        where invited.id = ${invitedById}::uuid
          and invited.church_id = ${input.execution.plantId}::uuid
          and invited.deleted_at is null
      )`
    : sql`true`;
  const attendanceTypeCurrent =
    status === "attended" && "attendanceDerivation" in args
      ? attendanceDerivationBaselineMatches({
          plantId: input.execution.plantId,
          meetingId: sql`${args.meetingId}::uuid`,
          personId: sql`${args.personId}::uuid`,
          attendanceType: sql`${attendanceType}`,
          baseline: args.attendanceDerivation!,
        })
      : sql`${status !== "attended"}`;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`${notificationsCurrent} and ${invitedByCurrent}
        and ${attendanceTypeCurrent} and exists (
        select 1 from church_meetings m
        join persons p on p.id = ${args.personId}::uuid
        where m.id = ${args.meetingId}::uuid
          and m.church_id = ${input.execution.plantId}::uuid
          and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedMeetingUpdatedAt)}
          and p.church_id = m.church_id and p.deleted_at is null
          and ${serializedTimestampMatches(sql`p.updated_at`, args.expectedPersonUpdatedAt)}
          and not exists (
            select 1 from meeting_attendance a
            where a.meeting_id = m.id and a.person_id = p.id
          )
          and not exists (
            select 1 from meeting_attendance a
            where a.id = ${args.attendanceId}::uuid
          )
      )`,
    })}, attendance_inserted as (
      insert into meeting_attendance (
        id, church_id, meeting_id, person_id, attendance_type, status,
        invited_by_id, response_status, notes, created_by, created_at, updated_at
      )
      select ${args.attendanceId}::uuid, c.church_id,
        ${args.meetingId}::uuid, ${args.personId}::uuid,
        ${attendanceType}, ${status}, ${invitedById}::uuid,
        ${responseStatus}, ${notes}, c.actor_user_id,
        transaction_timestamp(), transaction_timestamp()
      from claimed c
      returning id
    ), ${notificationsWritten({ targets: args.notificationTargets })},
    mutation_complete as (
      select (select count(*) from attendance_inserted) = 1
        and ${notificationCountsComplete({ targetCount: args.notificationTargets.length })} as ok
    ), ${effectTail()}
  `;
}

function removeAttendanceStatement<
  ExportName extends "removeAttendeeAction" | "removeFromGuestListAction",
>(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  exportName: ExportName;
  args: MeetingsEffectArguments<ExportName>;
}): SQL {
  const { args } = input;
  const beforeResponse = "beforeResponse" in args ? args.beforeResponse : null;
  const responseCurrent = beforeResponse
    ? sql`exists (
        select 1 from meeting_responses r
        where r.id = ${beforeResponse.responseId}::uuid
          and r.meeting_id = ${args.meetingId}::uuid
          and r.person_id = ${args.personId}::uuid
          and r.church_id = ${input.execution.plantId}::uuid
          and r.response_type = ${beforeResponse.responseType}
          and r.notes is not distinct from ${beforeResponse.notes}
          and r.recorded_by_id is not distinct from ${beforeResponse.recordedById}::uuid
          and ${serializedTimestampMatches(sql`r.updated_at`, beforeResponse.updatedAt)}
      )`
    : sql`not exists (
        select 1 from meeting_responses r
        where r.meeting_id = ${args.meetingId}::uuid
          and r.person_id = ${args.personId}::uuid
          and r.church_id = ${input.execution.plantId}::uuid
      )`;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`${responseCurrent}
        and ${pendingNotificationsCurrent({
          plantId: input.execution.plantId,
          meetingId: args.meetingId,
          pending: args.pendingNotifications,
        })}
        and ${notificationTargetsCurrent({
          plantId: input.execution.plantId,
          meetingId: args.meetingId,
          baseline: args.notificationBaseline,
          targets: args.notificationTargets,
          cancelling: args.pendingNotifications,
          audience: { kind: "existing", removePersonId: args.personId },
        })}
        and exists (
          select 1 from meeting_attendance a
          join church_meetings m on m.id = a.meeting_id and m.church_id = a.church_id
          join persons p on p.id = a.person_id and p.church_id = a.church_id
          where a.id = ${args.beforeAttendance.id}::uuid
            and a.meeting_id = ${args.meetingId}::uuid
            and a.person_id = ${args.personId}::uuid
            and a.church_id = ${input.execution.plantId}::uuid
            and p.deleted_at is null
            and a.status is not distinct from ${args.beforeAttendance.status}
            and a.attendance_type is not distinct from ${args.beforeAttendance.attendanceType}
            and a.response_status is not distinct from ${args.beforeAttendance.responseStatus}
            and a.notes is not distinct from ${args.beforeAttendance.notes}
            and ${serializedTimestampMatches(sql`a.updated_at`, args.expectedAttendanceUpdatedAt)}
        )`,
    })}, response_deleted as (
      delete from meeting_responses r using claimed c
      where r.meeting_id = ${args.meetingId}::uuid
        and r.person_id = ${args.personId}::uuid and r.church_id = c.church_id
        and ${beforeResponse ? sql`r.id = ${beforeResponse.responseId}::uuid` : sql`false`}
      returning r.id
    ), attendance_deleted as (
      delete from meeting_attendance a using claimed c
      where a.id = ${args.beforeAttendance.id}::uuid
        and a.meeting_id = ${args.meetingId}::uuid
        and a.person_id = ${args.personId}::uuid and a.church_id = c.church_id
        and ${serializedTimestampMatches(sql`a.updated_at`, args.expectedAttendanceUpdatedAt)}
      returning a.id
    ), ${notificationsWritten({
      targets: args.notificationTargets,
      pending: args.pendingNotifications,
    })}, mutation_complete as (
      select (select count(*) from attendance_deleted) = 1
        and (select count(*) from response_deleted) = ${beforeResponse ? 1 : 0}
        and ${notificationCountsComplete({
          targetCount: args.notificationTargets.length,
          pendingCount: args.pendingNotifications.length,
        })} as ok
    ), ${effectTail()}
  `;
}

function quickAddPersonStatement<
  ExportName extends
    | "quickAddAttendeeAction"
    | "quickAddPersonToGuestListAction"
    | "quickAddWalkInAction",
>(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  exportName: ExportName;
  args: MeetingsEffectArguments<ExportName>;
}): SQL {
  const { args } = input;
  const isGuest = input.exportName === "quickAddPersonToGuestListAction";
  const attendanceType = "attendanceType" in args ? args.attendanceType : null;
  const invitedById = "invitedById" in args ? args.invitedById : null;
  const source =
    input.exportName === "quickAddAttendeeAction" ? "vision_meeting" : null;
  const activitySource =
    input.exportName === "quickAddAttendeeAction"
      ? "meeting_attendance"
      : "meeting_guest_list";
  const invitedByCurrent = invitedById
    ? sql`exists (
        select 1 from persons invited
        where invited.id = ${invitedById}::uuid
          and invited.church_id = ${input.execution.plantId}::uuid
          and invited.deleted_at is null
      )`
    : sql`true`;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 3,
      current: sql`${invitedByCurrent}
        and ${notificationTargetsCurrent({
          plantId: input.execution.plantId,
          meetingId: args.meetingId,
          baseline: args.notificationBaseline,
          targets: args.notificationTargets,
          audience: { kind: "existing", addEmail: args.email },
        })}
        and exists (
          select 1 from church_meetings m
          where m.id = ${args.meetingId}::uuid
            and m.church_id = ${input.execution.plantId}::uuid
            and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedMeetingUpdatedAt)}
        )
        and exists (
          select 1 from churches ch
          where ch.id = ${input.execution.plantId}::uuid
            and ${nullableSerializedTimestampMatches(
              sql`ch.last_material_event_at`,
              args.expectedChurchMaterialEventAt
            )}
        )
        and not exists (select 1 from persons p where p.id = ${args.personId}::uuid)
        and not exists (
          select 1 from person_activities a
          where a.id = ${args.personActivityId}::uuid
        )
        and not exists (
          select 1 from meeting_attendance a
          where a.id = ${args.attendanceId}::uuid
             or (a.meeting_id = ${args.meetingId}::uuid
                 and a.person_id = ${args.personId}::uuid)
        )`,
    })}, person_inserted as (
      insert into persons (
        id, church_id, first_name, last_name, email, phone, country,
        status, source, background_check_status, pipeline_sort_order,
        created_by, created_at, updated_at
      )
      select ${args.personId}::uuid, c.church_id, ${args.firstName},
        ${args.lastName}, ${args.email}, ${args.phone}, 'US', 'prospect',
        ${source}, 'not_started', 0, c.actor_user_id,
        transaction_timestamp(), transaction_timestamp()
      from claimed c
      returning id
    ), activity_inserted as (
      insert into person_activities (
        id, church_id, person_id, activity_type, metadata, performed_by,
        created_at
      )
      select ${args.personActivityId}::uuid, c.church_id,
        ${args.personId}::uuid, 'person_created',
        ${JSON.stringify({ source: activitySource })}::jsonb,
        c.actor_user_id, transaction_timestamp()
      from claimed c join person_inserted p on true
      returning id
    ), attendance_inserted as (
      insert into meeting_attendance (
        id, church_id, meeting_id, person_id, attendance_type, status,
        invited_by_id, created_by, created_at, updated_at
      )
      select ${args.attendanceId}::uuid, c.church_id,
        ${args.meetingId}::uuid, ${args.personId}::uuid,
        ${attendanceType}, ${isGuest ? "absent" : "attended"},
        ${invitedById}::uuid, c.actor_user_id,
        transaction_timestamp(), transaction_timestamp()
      from claimed c join person_inserted p on true
      returning id
    ), church_stamped as (
      update churches ch
      set last_material_event_at = transaction_timestamp(),
          updated_at = transaction_timestamp()
      from claimed c
      where ch.id = c.church_id
        and ${nullableSerializedTimestampMatches(
          sql`ch.last_material_event_at`,
          args.expectedChurchMaterialEventAt
        )}
      returning ch.id
    ), ${notificationsWritten({ targets: args.notificationTargets })},
    mutation_complete as (
      select (select count(*) from person_inserted) = 1
        and (select count(*) from activity_inserted) = 1
        and (select count(*) from attendance_inserted) = 1
        and (select count(*) from church_stamped) = 1
        and ${notificationCountsComplete({ targetCount: args.notificationTargets.length })} as ok
    ), ${effectTail()}
  `;
}

function meetingStateCurrent(
  alias: SQL,
  state: MeetingsEffectArguments<"deleteMeetingAction">["before"]
): SQL {
  return sql`${alias}.type = ${state.type}
    and ${alias}.title is not distinct from ${state.title}
    and ${serializedTimestampMatches(sql`${alias}.datetime`, state.datetime)}
    and ${alias}.status = ${state.status}
    and ${alias}.location_id is not distinct from ${state.locationId}::uuid
    and ${alias}.location_name is not distinct from ${state.locationName}
    and ${alias}.location_address is not distinct from ${state.locationAddress}
    and ${alias}.meeting_number is not distinct from ${state.meetingNumber}
    and ${alias}.team_id is not distinct from ${state.teamId}::uuid
    and ${alias}.meeting_subtype is not distinct from ${state.meetingSubtype}
    and ${alias}.estimated_attendance is not distinct from ${state.estimatedAttendance}
    and ${alias}.actual_attendance is not distinct from ${state.actualAttendance}
    and ${alias}.duration_minutes is not distinct from ${state.durationMinutes}
    and ${alias}.notes is not distinct from ${state.notes}
    and coalesce(${alias}.agenda, '[]'::jsonb) = ${JSON.stringify(state.agenda)}::jsonb`;
}

function exactIdSet(input: {
  table: SQL;
  id: SQL;
  where: SQL;
  ids: readonly string[];
}): SQL {
  const ids = JSON.stringify(input.ids);
  return sql`not exists (
      select ${input.id} from ${input.table} where ${input.where}
      except select value::uuid from jsonb_array_elements_text(${ids}::jsonb) value
    ) and not exists (
      select value::uuid from jsonb_array_elements_text(${ids}::jsonb) value
      except select ${input.id} from ${input.table} where ${input.where}
    )`;
}

function createMeetingStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"createMeetingAction">;
}): SQL {
  const { args } = input;
  const checklist = JSON.stringify(args.checklistItems);
  const attendance = JSON.stringify(args.attendanceRows);
  const roster = JSON.stringify(args.resolvedTeamMemberIds);
  const locationCurrent = args.locationId
    ? args.savedLocationId
      ? sql`${args.savedLocationId}::uuid = ${args.locationId}::uuid
          and not exists (select 1 from locations l where l.id = ${args.savedLocationId}::uuid)`
      : sql`exists (
          select 1 from locations l
          where l.id = ${args.locationId}::uuid
            and l.church_id = ${input.execution.plantId}::uuid
            and l.is_active = true
            and l.name = ${args.locationName}
            and l.address = ${args.locationAddress}
        )`
    : sql`${
        args.savedLocationId === null &&
        args.locationName === null &&
        args.locationAddress === null
      }`;
  const teamCurrent = args.teamId
    ? sql`exists (
        select 1 from ministry_teams t
        where t.id = ${args.teamId}::uuid
          and t.church_id = ${input.execution.plantId}::uuid
      ) and not exists (
        select tm.person_id
        from team_memberships tm
        join persons p on p.id = tm.person_id and p.church_id = tm.church_id
        where tm.team_id = ${args.teamId}::uuid
          and tm.church_id = ${input.execution.plantId}::uuid
          and tm.status = 'active' and p.deleted_at is null
        except select value::uuid
        from jsonb_array_elements_text(${roster}::jsonb) value
      ) and not exists (
        select value::uuid
        from jsonb_array_elements_text(${roster}::jsonb) value
        except select tm.person_id
        from team_memberships tm
        join persons p on p.id = tm.person_id and p.church_id = tm.church_id
        where tm.team_id = ${args.teamId}::uuid
          and tm.church_id = ${input.execution.plantId}::uuid
          and tm.status = 'active' and p.deleted_at is null
      )`
    : sql`jsonb_array_length(${roster}::jsonb) = 0`;
  const meetingNumberCurrent =
    args.meetingNumber === null
      ? sql`true`
      : sql`not exists (
          select 1 from church_meetings m
          where m.church_id = ${input.execution.plantId}::uuid
            and m.meeting_number = ${args.meetingNumber}
        )`;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount:
        1 +
        (args.savedLocationId ? 1 : 0) +
        args.checklistItems.length +
        args.attendanceRows.length,
      current: sql`${locationCurrent} and ${teamCurrent}
        and ${notificationTargetsCurrent({
          plantId: input.execution.plantId,
          meetingId: args.meetingId,
          baseline: args.notificationBaseline,
          targets: args.notificationTargets,
          audience: {
            kind: "create",
            actorUserId: input.execution.actorUserId,
            rosterPersonIds: args.resolvedTeamMemberIds,
          },
        })}
        and exists (
          select 1 from users u
          where u.id = ${args.createdById}::uuid
            and u.id = ${input.execution.actorUserId}::uuid
            and u.church_id = ${input.execution.plantId}::uuid
        )
        and not exists (select 1 from church_meetings m where m.id = ${args.meetingId}::uuid)
        and ${meetingNumberCurrent}
        and not exists (
          select 1 from jsonb_array_elements(${checklist}::jsonb) i
          where exists (
            select 1 from meeting_checklist_items x
            where x.id = (i->>'itemId')::uuid
          )
        )
        and not exists (
          select 1 from jsonb_array_elements(${attendance}::jsonb) a
          left join persons p
            on p.id = (a->>'personId')::uuid
           and p.church_id = ${input.execution.plantId}::uuid
           and p.deleted_at is null
           and date_trunc('milliseconds', p.updated_at) =
             (a->>'expectedPersonUpdatedAt')::timestamp
          where p.id is null or exists (
            select 1 from meeting_attendance x
            where x.id = (a->>'attendanceId')::uuid
          )
        )`,
    })}, saved_location_inserted as (
      insert into locations (
        id, church_id, name, address, is_active, created_at, updated_at
      )
      select ${args.savedLocationId}::uuid, c.church_id,
        ${args.locationName}, ${args.locationAddress}, true,
        transaction_timestamp(), transaction_timestamp()
      from claimed c where ${args.savedLocationId}::uuid is not null
      returning id
    ), meeting_inserted as (
      insert into church_meetings (
        id, church_id, type, title, datetime, status, location_id,
        location_name, location_address, meeting_number, team_id,
        meeting_subtype, estimated_attendance, actual_attendance,
        duration_minutes, notes, agenda, created_by, created_at, updated_at
      )
      select ${args.meetingId}::uuid, c.church_id, ${args.type}, ${args.title},
        ${timestamp(args.datetime)}, 'planning', ${args.locationId}::uuid,
        ${args.locationName}, ${args.locationAddress}, ${args.meetingNumber},
        ${args.teamId}::uuid, ${args.meetingSubtype},
        ${args.estimatedAttendance}, null, ${args.durationMinutes}, ${args.notes},
        ${JSON.stringify(args.agenda)}::jsonb, c.actor_user_id,
        transaction_timestamp(), transaction_timestamp()
      from claimed c
      returning id
    ), checklist_inserted as (
      insert into meeting_checklist_items (
        id, church_id, meeting_id, item_name, category, is_checked,
        created_at, updated_at
      )
      select (i->>'itemId')::uuid, c.church_id, ${args.meetingId}::uuid,
        i->>'itemName', i->>'category', false,
        transaction_timestamp(), transaction_timestamp()
      from claimed c cross join jsonb_array_elements(${checklist}::jsonb) i
      returning id
    ), attendance_inserted as (
      insert into meeting_attendance (
        id, church_id, meeting_id, person_id, status, created_by,
        created_at, updated_at
      )
      select (a->>'attendanceId')::uuid, c.church_id,
        ${args.meetingId}::uuid, (a->>'personId')::uuid, 'absent',
        c.actor_user_id, transaction_timestamp(), transaction_timestamp()
      from claimed c cross join jsonb_array_elements(${attendance}::jsonb) a
      returning id
    ), ${notificationsWritten({ targets: args.notificationTargets })},
    mutation_complete as (
      select (select count(*) from saved_location_inserted) = ${args.savedLocationId ? 1 : 0}
        and (select count(*) from meeting_inserted) = 1
        and (select count(*) from checklist_inserted) = ${args.checklistItems.length}
        and (select count(*) from attendance_inserted) = ${args.attendanceRows.length}
        and ${notificationCountsComplete({ targetCount: args.notificationTargets.length })} as ok
    ), ${effectTail()}
  `;
}

function updateMeetingStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"updateMeetingAction">;
}): SQL {
  const { args } = input;
  const locationCurrent = args.after.locationId
    ? sql`exists (
        select 1 from locations l
        where l.id = ${args.after.locationId}::uuid
          and l.church_id = ${input.execution.plantId}::uuid
          and l.is_active = true
          and l.name = ${args.after.locationName}
          and l.address = ${args.after.locationAddress}
      )`
    : sql`${
        (args.after.locationName === null &&
          args.after.locationAddress === null) ||
        (args.after.locationName !== null &&
          args.after.locationAddress !== null)
      }`;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`${locationCurrent}
        and ${pendingNotificationsCurrent({
          plantId: input.execution.plantId,
          meetingId: args.meetingId,
          pending: args.pendingNotifications,
        })}
        and ${notificationTargetsCurrent({
          plantId: input.execution.plantId,
          meetingId: args.meetingId,
          baseline: args.notificationBaseline,
          targets: args.notificationTargets,
          cancelling: args.pendingNotifications,
          audience: { kind: "existing" },
        })}
        and exists (
          select 1 from church_meetings m
          where m.id = ${args.meetingId}::uuid
            and m.church_id = ${input.execution.plantId}::uuid
            and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedUpdatedAt)}
            and ${meetingStateCurrent(sql`m`, args.before)}
        )`,
    })}, meeting_updated as (
      update church_meetings m
      set title = ${args.after.title}, datetime = ${timestamp(args.after.datetime)},
          status = ${args.after.status}, location_id = ${args.after.locationId}::uuid,
          location_name = ${args.after.locationName},
          location_address = ${args.after.locationAddress},
          meeting_subtype = ${args.after.meetingSubtype},
          estimated_attendance = ${args.after.estimatedAttendance},
          duration_minutes = ${args.after.durationMinutes}, notes = ${args.after.notes},
          updated_at = transaction_timestamp()
      from claimed c
      where m.id = ${args.meetingId}::uuid and m.church_id = c.church_id
        and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedUpdatedAt)}
        and ${meetingStateCurrent(sql`m`, args.before)}
      returning m.id
    ), ${notificationsWritten({
      targets: args.notificationTargets,
      pending: args.pendingNotifications,
    })}, mutation_complete as (
      select (select count(*) from meeting_updated) = 1
        and ${notificationCountsComplete({
          targetCount: args.notificationTargets.length,
          pendingCount: args.pendingNotifications.length,
        })} as ok
    ), ${effectTail()}
  `;
}

function updateMeetingStatusStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"updateMeetingStatusAction">;
}): SQL {
  const { args } = input;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1,
      current: sql`${pendingNotificationsCurrent({
        plantId: input.execution.plantId,
        meetingId: args.meetingId,
        pending: args.pendingNotifications,
      })} and ${notificationTargetsCurrent({
        plantId: input.execution.plantId,
        meetingId: args.meetingId,
        baseline: args.notificationBaseline,
        targets: args.notificationTargets,
        cancelling: args.pendingNotifications,
        audience: { kind: "existing" },
      })} and exists (
        select 1 from church_meetings m
        where m.id = ${args.meetingId}::uuid
          and m.church_id = ${input.execution.plantId}::uuid
          and m.status = ${args.beforeStatus}
          and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedUpdatedAt)}
      )`,
    })}, meeting_updated as (
      update church_meetings m
      set status = ${args.afterStatus}, updated_at = transaction_timestamp()
      from claimed c
      where m.id = ${args.meetingId}::uuid and m.church_id = c.church_id
        and m.status = ${args.beforeStatus}
        and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedUpdatedAt)}
      returning m.id
    ), ${notificationsWritten({
      targets: args.notificationTargets,
      pending: args.pendingNotifications,
    })}, mutation_complete as (
      select (select count(*) from meeting_updated) = 1
        and ${notificationCountsComplete({
          targetCount: args.notificationTargets.length,
          pendingCount: args.pendingNotifications.length,
        })} as ok
    ), ${effectTail()}
  `;
}

function deleteMeetingStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"deleteMeetingAction">;
}): SQL {
  const { args } = input;
  const attendanceSet = exactIdSet({
    table: sql`meeting_attendance a`,
    id: sql`a.id`,
    where: sql`a.church_id = ${input.execution.plantId}::uuid and a.meeting_id = ${args.meetingId}::uuid`,
    ids: args.expectedAttendanceIds,
  });
  const checklistSet = exactIdSet({
    table: sql`meeting_checklist_items i`,
    id: sql`i.id`,
    where: sql`i.church_id = ${input.execution.plantId}::uuid and i.meeting_id = ${args.meetingId}::uuid`,
    ids: args.expectedChecklistItemIds,
  });
  const responseSet = exactIdSet({
    table: sql`meeting_responses r`,
    id: sql`r.id`,
    where: sql`r.church_id = ${input.execution.plantId}::uuid and r.meeting_id = ${args.meetingId}::uuid`,
    ids: args.expectedResponseIds,
  });
  const invitationSet = exactIdSet({
    table: sql`invitations i`,
    id: sql`i.id`,
    where: sql`i.church_id = ${input.execution.plantId}::uuid and i.meeting_id = ${args.meetingId}::uuid`,
    ids: args.expectedInvitationIds,
  });
  const confirmationTokenSet = exactIdSet({
    table: sql`meeting_confirmation_tokens t`,
    id: sql`t.id`,
    where: sql`t.church_id = ${input.execution.plantId}::uuid and t.meeting_id = ${args.meetingId}::uuid`,
    ids: args.expectedConfirmationTokenIds,
  });
  const evaluationCurrent = args.expectedEvaluationId
    ? sql`exists (
        select 1 from meeting_evaluations e
        where e.id = ${args.expectedEvaluationId}::uuid
          and e.church_id = ${input.execution.plantId}::uuid
          and e.meeting_id = ${args.meetingId}::uuid
      ) and not exists (
        select 1 from meeting_evaluations e
        where e.church_id = ${input.execution.plantId}::uuid
          and e.meeting_id = ${args.meetingId}::uuid
          and e.id <> ${args.expectedEvaluationId}::uuid
      )`
    : sql`not exists (
        select 1 from meeting_evaluations e
        where e.church_id = ${input.execution.plantId}::uuid
          and e.meeting_id = ${args.meetingId}::uuid
      )`;
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount:
        1 +
        args.expectedAttendanceIds.length +
        args.expectedChecklistItemIds.length +
        args.expectedResponseIds.length +
        args.expectedInvitationIds.length +
        args.expectedConfirmationTokenIds.length +
        (args.expectedEvaluationId ? 1 : 0),
      current: sql`${attendanceSet} and ${checklistSet} and ${responseSet}
        and ${invitationSet} and ${confirmationTokenSet} and ${evaluationCurrent}
        and ${pendingNotificationsCurrent({
          plantId: input.execution.plantId,
          meetingId: args.meetingId,
          pending: args.pendingNotifications,
        })}
        and exists (
          select 1 from church_meetings m
          where m.id = ${args.meetingId}::uuid
            and m.church_id = ${input.execution.plantId}::uuid
            and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedUpdatedAt)}
            and ${meetingStateCurrent(sql`m`, args.before)}
        )`,
    })}, meeting_deleted as (
      delete from church_meetings m using claimed c
      where m.id = ${args.meetingId}::uuid and m.church_id = c.church_id
        and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedUpdatedAt)}
        and ${meetingStateCurrent(sql`m`, args.before)}
      returning m.id
    ), ${notificationsWritten({
      targets: [],
      pending: args.pendingNotifications,
    })}, mutation_complete as (
      select (select count(*) from meeting_deleted) = 1
        and ${notificationCountsComplete({
          targetCount: 0,
          pendingCount: args.pendingNotifications.length,
        })} as ok
    ), ${effectTail()}
  `;
}

type TaskNotificationTarget =
  MeetingsEffectArguments<"finalizeAttendanceAction">["followUpTaskTargets"][number]["notificationTargets"][number];
type PendingTaskNotification = NonNullable<
  MeetingsEffectArguments<"finalizeAttendanceAction">["evaluationTaskTarget"]
>["pendingNotifications"][number];

function taskNotificationTargetsCurrent(input: {
  plantId: string;
  targets: readonly TaskNotificationTarget[];
  taskBindings: readonly Readonly<{
    taskId: string;
    assignedToId: string;
  }>[];
  cancelling?: readonly PendingTaskNotification[];
}): SQL {
  const targets = JSON.stringify(input.targets);
  const taskBindings = JSON.stringify(input.taskBindings);
  const cancelling = JSON.stringify(input.cancelling ?? []);
  return sql`not exists (
    select 1 from jsonb_array_elements(${targets}::jsonb) t
    left join jsonb_array_elements(${taskBindings}::jsonb) b
      on (b->>'taskId')::uuid = (t->>'entityId')::uuid
     and (b->>'assignedToId')::uuid = (t->>'recipientUserId')::uuid
    left join users u
      on u.id = (t->>'recipientUserId')::uuid
     and u.church_id = ${input.plantId}::uuid
    where b is null
      or u.id is null
      or t->>'category' <> 'tasks'
      or t->>'entityType' <> 'task'
      or t->>'type' not in ('task.due', 'task.overdue')
      or t->>'dedupeKey' not like (t->>'type') || ':' || (t->>'entityId') || ':%'
      or exists (
        select 1 from notifications n
        where n.id = (t->>'notificationId')::uuid
      )
      or exists (
        select 1 from notifications n
        where n.church_id = ${input.plantId}::uuid
          and n.recipient_user_id = (t->>'recipientUserId')::uuid
          and n.dedupe_key = t->>'dedupeKey'
          and n.status <> 'cancelled'
          and not exists (
            select 1 from jsonb_array_elements(${cancelling}::jsonb) p
            where (p->>'notificationId')::uuid = n.id
          )
      )
  )`;
}

function pendingTaskNotificationsCurrent(input: {
  plantId: string;
  taskId: string;
  pending: readonly PendingTaskNotification[];
}): SQL {
  const pending = JSON.stringify(input.pending);
  return sql`not exists (
    select 1 from notifications n
    where n.church_id = ${input.plantId}::uuid
      and n.category = 'tasks' and n.entity_type = 'task'
      and n.entity_id = ${input.taskId}::uuid and n.status = 'pending'
      and not exists (
        select 1 from jsonb_array_elements(${pending}::jsonb) p
        where (p->>'notificationId')::uuid = n.id
          and (p->>'recipientUserId')::uuid = n.recipient_user_id
          and p->>'type' = n.type and p->>'dedupeKey' = n.dedupe_key
          and (p->>'scheduledFor')::timestamp = n.scheduled_for
          and (p->>'expectedUpdatedAt')::timestamp =
            date_trunc('milliseconds', n.updated_at)
      )
  ) and not exists (
    select 1 from jsonb_array_elements(${pending}::jsonb) p
    left join notifications n
      on n.id = (p->>'notificationId')::uuid
     and n.church_id = ${input.plantId}::uuid
     and n.recipient_user_id = (p->>'recipientUserId')::uuid
     and n.category = 'tasks' and n.type = p->>'type'
     and n.entity_type = 'task' and n.entity_id = ${input.taskId}::uuid
     and n.dedupe_key = p->>'dedupeKey'
     and n.scheduled_for = (p->>'scheduledFor')::timestamp
     and n.status = 'pending'
     and date_trunc('milliseconds', n.updated_at) =
       (p->>'expectedUpdatedAt')::timestamp
    where n.id is null
  )`;
}

function finalizeAttendanceStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"finalizeAttendanceAction">;
}): SQL {
  const { args } = input;
  const attendees = JSON.stringify(args.attendees);
  const statusChanges = JSON.stringify(args.personStatusChanges);
  const followUps = JSON.stringify(args.followUpTaskTargets);
  const evaluation = args.evaluationTaskTarget;
  const allTaskNotifications = [
    ...args.followUpTaskTargets.flatMap((target) => target.notificationTargets),
    ...(evaluation?.notificationTargets ?? []),
  ];
  const taskBindings = [
    ...args.followUpTaskTargets.flatMap(({ taskId, assignedToId }) =>
      assignedToId ? [{ taskId, assignedToId }] : []
    ),
    ...(evaluation?.assignedToId
      ? [
          {
            taskId: evaluation.taskId,
            assignedToId: evaluation.assignedToId,
          },
        ]
      : []),
  ];
  const pendingEvaluationNotifications = evaluation?.pendingNotifications ?? [];
  const evaluationNotificationsChange = Boolean(
    evaluation &&
    (evaluation.expectedTaskAbsent ||
      evaluation.pendingNotifications.length > 0 ||
      evaluation.notificationTargets.length > 0)
  );
  const taskTargetsCurrent = args.followUpTaskTargets.map((target) =>
    target.expectedTaskAbsent
      ? sql`not exists (
          select 1 from tasks t
          where t.id = ${target.taskId}::uuid
             or (t.church_id = ${input.execution.plantId}::uuid
                 and t.category = 'follow_up' and t.related_type = 'person'
                 and t.related_id = ${target.personId}::uuid
                 and t.due_date = ${target.dueDate}::date and t.deleted_at is null)
        )`
      : sql`exists (
          select 1 from tasks t
          where t.id = ${target.taskId}::uuid
            and t.church_id = ${input.execution.plantId}::uuid
            and t.title = ${target.title} and t.status = ${target.beforeStatus}
            and t.priority = ${target.priority} and t.category = 'follow_up'
            and t.due_date = ${target.dueDate}::date
            and t.assigned_to_id is not distinct from ${target.assignedToId}::uuid
            and (${target.assignedToId}::uuid is null or exists (
              select 1 from users u where u.id = ${target.assignedToId}::uuid
                and u.church_id = ${input.execution.plantId}::uuid
            ))
            and t.related_type = 'person' and t.related_id = ${target.personId}::uuid
            and ${serializedTimestampMatches(
              sql`t.updated_at`,
              target.expectedUpdatedAt!
            )}
            and t.deleted_at is null
        )`
  );
  const evaluationCurrent = !evaluation
    ? args.expectedTaskAssigneeId === null
      ? sql`true`
      : sql`not exists (
        select 1 from tasks t
        where t.church_id = ${input.execution.plantId}::uuid
          and t.related_type = 'meeting' and t.related_id = ${args.meetingId}::uuid
          and t.completion_event = 'meeting.evaluation.completed'
          and t.deleted_at is null
      )`
    : evaluation.expectedTaskAbsent
      ? sql`not exists (
          select 1 from tasks t
          where t.id = ${evaluation.taskId}::uuid
             or (t.church_id = ${input.execution.plantId}::uuid
                 and t.related_type = 'meeting'
                 and t.related_id = ${args.meetingId}::uuid
                 and t.completion_event = 'meeting.evaluation.completed'
                 and t.deleted_at is null)
        )`
      : sql`exists (
          select 1 from tasks t
          where t.id = ${evaluation.taskId}::uuid
            and t.church_id = ${input.execution.plantId}::uuid
            and t.title = ${evaluation.title} and t.status = ${evaluation.beforeStatus}
            and t.priority = ${evaluation.priority} and t.category = 'vision_meeting'
            and t.due_date = ${evaluation.dueDate}::date
            and t.assigned_to_id is not distinct from ${evaluation.assignedToId}::uuid
            and (${evaluation.assignedToId}::uuid is null or exists (
              select 1 from users u where u.id = ${evaluation.assignedToId}::uuid
                and u.church_id = ${input.execution.plantId}::uuid
            ))
            and t.related_type = 'meeting' and t.related_id = ${args.meetingId}::uuid
            and t.completion_event = 'meeting.evaluation.completed'
            and ${serializedTimestampMatches(
              sql`t.updated_at`,
              evaluation.expectedUpdatedAt!
            )}
            and t.deleted_at is null
        )`;
  const taskCurrent = sql.join(
    [...taskTargetsCurrent, evaluationCurrent],
    sql` and `
  );
  const newTasksUseCanonicalAssignee = [
    ...args.followUpTaskTargets,
    ...(evaluation ? [evaluation] : []),
  ].every(
    (target) =>
      !target.expectedTaskAbsent ||
      target.assignedToId === args.expectedTaskAssigneeId
  );
  const insertedTaskCount =
    args.followUpTaskTargets.filter(
      ({ expectedTaskAbsent }) => expectedTaskAbsent
    ).length + (evaluation?.expectedTaskAbsent ? 1 : 0);
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1 + args.personStatusChanges.length + insertedTaskCount,
      current: sql`${newTasksUseCanonicalAssignee}
        and ${(args.expectedTaskAssigneeId !== null) === (evaluation !== null)}
        and exists (
          select 1 from church_meetings m
          where m.id = ${args.meetingId}::uuid
            and m.church_id = ${input.execution.plantId}::uuid
            and m.type = ${args.meetingType}
            and m.title is not distinct from ${args.meetingTitle}
            and ${serializedTimestampMatches(sql`m.datetime`, args.meetingDatetime)}
            and m.actual_attendance is not distinct from ${args.expectedActualAttendance}
            and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedMeetingUpdatedAt)}
        )
        and exists (
          select 1 from churches ch
          where ch.id = ${input.execution.plantId}::uuid
            and ch.leadership_status is not distinct from ${args.expectedLeadershipStatus}
            and ${nullableSerializedTimestampMatches(
              sql`ch.last_material_event_at`,
              args.expectedChurchMaterialEventAt
            )}
            and (
              (${args.expectedTaskAssigneeId}::uuid is null and (
                ${args.meetingType} <> 'vision_meeting'
                or ch.leadership_status = 'no_planter'
                or not exists (
                  select 1 from users owner
                  where owner.church_id = ch.id and owner.seat = 'owner'
                )
              ))
              or (${args.expectedTaskAssigneeId}::uuid is not null
                and ${args.meetingType} = 'vision_meeting'
                and ch.leadership_status is distinct from 'no_planter'
                and exists (
                  select 1 from users owner
                  where owner.id = ${args.expectedTaskAssigneeId}::uuid
                    and owner.church_id = ch.id and owner.seat = 'owner'
                )
              )
            )
        )
        and not exists (
          select a.id, a.person_id, a.attendance_type,
            date_trunc('milliseconds', a.updated_at)
          from meeting_attendance a
          join persons p on p.id = a.person_id and p.church_id = a.church_id
          where a.church_id = ${input.execution.plantId}::uuid
            and a.meeting_id = ${args.meetingId}::uuid and a.status = 'attended'
            and p.deleted_at is null
          except select (x->>'attendanceId')::uuid, (x->>'personId')::uuid,
            x->>'attendanceType', (x->>'expectedUpdatedAt')::timestamp
          from jsonb_array_elements(${attendees}::jsonb) x
        )
        and not exists (
          select (x->>'attendanceId')::uuid, (x->>'personId')::uuid,
            x->>'attendanceType', (x->>'expectedUpdatedAt')::timestamp
          from jsonb_array_elements(${attendees}::jsonb) x
          except select a.id, a.person_id, a.attendance_type,
            date_trunc('milliseconds', a.updated_at)
          from meeting_attendance a
          where a.church_id = ${input.execution.plantId}::uuid
            and a.meeting_id = ${args.meetingId}::uuid and a.status = 'attended'
        )
        and not exists (
          select p.id, date_trunc('milliseconds', p.updated_at), p.created_by
          from persons p
          join meeting_attendance a on a.person_id = p.id and a.church_id = p.church_id
          where p.church_id = ${input.execution.plantId}::uuid
            and a.meeting_id = ${args.meetingId}::uuid and a.status = 'attended'
            and p.status = 'prospect' and p.deleted_at is null
            and ${args.meetingType} = 'vision_meeting'
          except select (x->>'personId')::uuid,
            (x->>'expectedUpdatedAt')::timestamp, (x->>'performedById')::uuid
          from jsonb_array_elements(${statusChanges}::jsonb) x
        )
        and not exists (
          select (x->>'personId')::uuid, (x->>'expectedUpdatedAt')::timestamp,
            (x->>'performedById')::uuid
          from jsonb_array_elements(${statusChanges}::jsonb) x
          except select p.id, date_trunc('milliseconds', p.updated_at), p.created_by
          from persons p
          join meeting_attendance a on a.person_id = p.id and a.church_id = p.church_id
          where p.church_id = ${input.execution.plantId}::uuid
            and a.meeting_id = ${args.meetingId}::uuid and a.status = 'attended'
            and p.status = 'prospect' and p.deleted_at is null
            and ${args.meetingType} = 'vision_meeting'
        )
        and not exists (
          select (x->>'personId')::uuid
          from jsonb_array_elements(${attendees}::jsonb) x
          where ${args.expectedTaskAssigneeId}::uuid is not null
            and x->>'attendanceType' = 'first_time'
          except select (f->>'personId')::uuid
          from jsonb_array_elements(${followUps}::jsonb) f
        )
        and not exists (
          select (f->>'personId')::uuid
          from jsonb_array_elements(${followUps}::jsonb) f
          except select (x->>'personId')::uuid
          from jsonb_array_elements(${attendees}::jsonb) x
          where ${args.expectedTaskAssigneeId}::uuid is not null
            and x->>'attendanceType' = 'first_time'
        )
        and not exists (
          select 1 from jsonb_array_elements(${statusChanges}::jsonb) s
          where exists (
               select 1 from person_activities a
               where a.id = (s->>'activityId')::uuid
             )
        )
        and ${taskCurrent}
        and ${taskNotificationTargetsCurrent({
          plantId: input.execution.plantId,
          targets: allTaskNotifications,
          taskBindings,
          cancelling: pendingEvaluationNotifications,
        })}
        and ${evaluationNotificationsChange && evaluation ? pendingTaskNotificationsCurrent({ plantId: input.execution.plantId, taskId: evaluation.taskId, pending: pendingEvaluationNotifications }) : sql`true`}
        `,
    })}, status_input as materialized (
      select change from jsonb_array_elements(${statusChanges}::jsonb) change
    ), persons_updated as (
      update persons p
      set status = 'attendee', updated_at = transaction_timestamp()
      from claimed c, status_input s
      where p.id = (s.change->>'personId')::uuid and p.church_id = c.church_id
        and p.status = 'prospect' and p.deleted_at is null
        and date_trunc('milliseconds', p.updated_at) =
          (s.change->>'expectedUpdatedAt')::timestamp
      returning p.id
    ), status_activities_inserted as (
      insert into person_activities (
        id, church_id, person_id, activity_type, metadata, performed_by, created_at
      )
      select (s.change->>'activityId')::uuid, c.church_id,
        (s.change->>'personId')::uuid, 'status_changed',
        jsonb_build_object(
          'oldStatus', 'prospect', 'newStatus', 'attendee',
          'reason', 'Auto-advanced from vision meeting attendance'
        ), (s.change->>'performedById')::uuid, transaction_timestamp()
      from claimed c cross join status_input s
      join persons p on p.id = (s.change->>'personId')::uuid and p.church_id = c.church_id
      returning id
    ), follow_up_input as materialized (
      select target from jsonb_array_elements(${followUps}::jsonb) target
    ), follow_up_tasks_inserted as (
      insert into tasks (
        id, church_id, title, status, priority, due_date, assigned_to_id,
        category, related_type, related_id, created_by_id, created_at, updated_at
      )
      select (f.target->>'taskId')::uuid, c.church_id, f.target->>'title',
        'not_started', 'high', (f.target->>'dueDate')::date,
        (f.target->>'assignedToId')::uuid, 'follow_up', 'person',
        (f.target->>'personId')::uuid, (f.target->>'assignedToId')::uuid,
        transaction_timestamp(), transaction_timestamp()
      from claimed c cross join follow_up_input f
      where (f.target->>'expectedTaskAbsent')::boolean
      returning id
    ), evaluation_task_inserted as (
      insert into tasks (
        id, church_id, title, status, priority, due_date, assigned_to_id,
        category, related_type, related_id, completion_event,
        created_by_id, created_at, updated_at
      )
      select ${evaluation?.taskId ?? null}::uuid, c.church_id, ${evaluation?.title ?? null},
        'not_started', 'high', ${evaluation?.dueDate ?? null}::date,
        ${evaluation?.assignedToId ?? null}::uuid, 'vision_meeting', 'meeting',
        ${args.meetingId}::uuid, 'meeting.evaluation.completed',
        ${evaluation?.assignedToId ?? null}::uuid,
        transaction_timestamp(), transaction_timestamp()
      from claimed c where ${evaluation?.expectedTaskAbsent ?? false}
      returning id
    ), task_notifications_cancelled as (
      update notifications n set status = 'cancelled', updated_at = transaction_timestamp()
      from claimed c, jsonb_array_elements(${JSON.stringify(pendingEvaluationNotifications)}::jsonb) p
      where n.id = (p->>'notificationId')::uuid and n.church_id = c.church_id
        and n.category = 'tasks' and n.entity_type = 'task'
        and n.entity_id = (p->>'entityId')::uuid and n.status = 'pending'
        and date_trunc('milliseconds', n.updated_at) =
          (p->>'expectedUpdatedAt')::timestamp
      returning n.id
    ), task_notifications_inserted as (
      insert into notifications (
        id, anchor_type, church_id, recipient_user_id, category, type,
        title, body, entity_type, entity_id, dedupe_key, scheduled_for,
        status, created_at, updated_at
      )
      select (t->>'notificationId')::uuid, 'church', c.church_id,
        (t->>'recipientUserId')::uuid, 'tasks', t->>'type', t->>'title',
        t->>'body', 'task', (t->>'entityId')::uuid, t->>'dedupeKey',
        (t->>'scheduledFor')::timestamp, 'pending',
        transaction_timestamp(), transaction_timestamp()
      from claimed c cross join jsonb_array_elements(${JSON.stringify(allTaskNotifications)}::jsonb) t
      returning id
    ), meeting_updated as (
      update church_meetings m
      set actual_attendance = ${args.attendees.length},
          updated_at = transaction_timestamp()
      from claimed c
      where m.id = ${args.meetingId}::uuid and m.church_id = c.church_id
        and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedMeetingUpdatedAt)}
        and m.actual_attendance is not distinct from ${args.expectedActualAttendance}
      returning m.id
    ), church_stamped as (
      update churches ch set last_material_event_at = transaction_timestamp(),
        updated_at = transaction_timestamp()
      from claimed c where ch.id = c.church_id
        and ${nullableSerializedTimestampMatches(
          sql`ch.last_material_event_at`,
          args.expectedChurchMaterialEventAt
        )}
      returning ch.id
    ), mutation_complete as (
      select (select count(*) from persons_updated) = ${args.personStatusChanges.length}
        and (select count(*) from status_activities_inserted) = ${args.personStatusChanges.length}
        and (select count(*) from follow_up_tasks_inserted) = ${args.followUpTaskTargets.filter(({ expectedTaskAbsent }) => expectedTaskAbsent).length}
        and (select count(*) from evaluation_task_inserted) = ${evaluation?.expectedTaskAbsent ? 1 : 0}
        and (select count(*) from task_notifications_cancelled) = ${pendingEvaluationNotifications.length}
        and (select count(*) from task_notifications_inserted) = ${allTaskNotifications.length}
        and (select count(*) from meeting_updated) = 1
        and (select count(*) from church_stamped) = 1 as ok
    ), ${effectTail()}
  `;
}

function createEvaluationStatement(input: {
  execution: Execution;
  effectKey: EvryAuditKey;
  args: MeetingsEffectArguments<"createEvaluationAction">;
}): SQL {
  const { args } = input;
  const scores = [
    args.attendanceScore,
    args.locationScore,
    args.logisticsScore,
    args.agendaScore,
    args.vibeScore,
    args.messageScore,
    args.closeScore,
    args.nextStepsScore,
  ];
  const totalScore = (
    scores.reduce((sum, score) => sum + score, 0) / scores.length
  ).toFixed(1);
  const task = args.evaluationTask;
  const taskCurrent = task
    ? sql`exists (
        select 1 from tasks t
        where t.id = ${task.taskId}::uuid
          and t.church_id = ${input.execution.plantId}::uuid
          and t.title = ${task.title}
          and t.status = ${task.beforeStatus}
          and t.completion_event = 'meeting.evaluation.completed'
          and t.related_type = 'meeting'
          and t.related_id = ${args.meetingId}::uuid
          and ${serializedTimestampMatches(sql`t.updated_at`, task.expectedUpdatedAt)}
          and t.deleted_at is null
      ) and not exists (
        select 1 from tasks t
        where t.church_id = ${input.execution.plantId}::uuid
          and t.completion_event = 'meeting.evaluation.completed'
          and t.related_type = 'meeting'
          and t.related_id = ${args.meetingId}::uuid
          and t.id <> ${task.taskId}::uuid and t.deleted_at is null
      )`
    : sql`not exists (
        select 1 from tasks t
        where t.church_id = ${input.execution.plantId}::uuid
          and t.completion_event = 'meeting.evaluation.completed'
          and t.related_type = 'meeting'
          and t.related_id = ${args.meetingId}::uuid
          and t.status <> 'complete' and t.deleted_at is null
      )`;
  const completesTask = task !== null && task.beforeStatus !== "complete";
  return sql`
    with ${effectPrelude({
      ...input,
      affectedCount: 1 + (completesTask ? 1 : 0),
      current: sql`${taskCurrent} and exists (
        select 1 from church_meetings m
        where m.id = ${args.meetingId}::uuid
          and m.church_id = ${input.execution.plantId}::uuid
          and ${serializedTimestampMatches(sql`m.updated_at`, args.expectedMeetingUpdatedAt)}
      ) and not exists (
        select 1 from meeting_evaluations e
        where e.id = ${args.evaluationId}::uuid
           or (e.church_id = ${input.execution.plantId}::uuid
               and e.meeting_id = ${args.meetingId}::uuid)
      )`,
    })}, evaluation_inserted as (
      insert into meeting_evaluations (
        id, church_id, meeting_id, attendance_score, location_score,
        logistics_score, agenda_score, vibe_score, message_score,
        close_score, next_steps_score, total_score, notes, evaluated_by,
        created_at, updated_at
      )
      select ${args.evaluationId}::uuid, c.church_id, ${args.meetingId}::uuid,
        ${args.attendanceScore}, ${args.locationScore}, ${args.logisticsScore},
        ${args.agendaScore}, ${args.vibeScore}, ${args.messageScore},
        ${args.closeScore}, ${args.nextStepsScore}, ${totalScore}, ${args.notes},
        c.actor_user_id, transaction_timestamp(), transaction_timestamp()
      from claimed c
      returning id
    ), task_completed as (
      update tasks t
      set status = 'complete', completed_at = transaction_timestamp(),
          updated_at = transaction_timestamp()
      from claimed c
      where t.id = ${task?.taskId ?? null}::uuid and t.church_id = c.church_id
        and t.status = ${task?.beforeStatus ?? null}
        and t.status <> 'complete'
        and ${task ? serializedTimestampMatches(sql`t.updated_at`, task.expectedUpdatedAt) : sql`false`}
        and t.completion_event = 'meeting.evaluation.completed'
        and t.related_type = 'meeting' and t.related_id = ${args.meetingId}::uuid
        and t.deleted_at is null
      returning t.id
    ), mutation_complete as (
      select (select count(*) from evaluation_inserted) = 1
        and (select count(*) from task_completed) = ${completesTask ? 1 : 0} as ok
    ), ${effectTail()}
  `;
}

function mutationStatementFor(input: {
  exportName: MeetingsActionExport;
  execution: Execution;
  effectKey: EvryAuditKey;
  args: Readonly<Record<string, unknown>>;
}): SQL | null {
  switch (input.exportName) {
    case "addAttendeeAction":
      return addAttendanceStatement({
        ...input,
        exportName: input.exportName,
        args: input.args as MeetingsEffectArguments<"addAttendeeAction">,
      });
    case "addToGuestListAction":
      return addAttendanceStatement({
        ...input,
        exportName: input.exportName,
        args: input.args as MeetingsEffectArguments<"addToGuestListAction">,
      });
    case "addWalkInAttendeeAction":
      return addAttendanceStatement({
        ...input,
        exportName: input.exportName,
        args: input.args as MeetingsEffectArguments<"addWalkInAttendeeAction">,
      });
    case "createLocationAction":
      return createLocationStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"createLocationAction">,
      });
    case "createEvaluationAction":
      return createEvaluationStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"createEvaluationAction">,
      });
    case "createMeetingAction":
      return createMeetingStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"createMeetingAction">,
      });
    case "deleteMeetingAction":
      return deleteMeetingStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"deleteMeetingAction">,
      });
    case "finalizeAttendanceAction":
      return finalizeAttendanceStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"finalizeAttendanceAction">,
      });
    case "updateLocationAction":
      return updateLocationStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"updateLocationAction">,
      });
    case "updateMeetingAction":
      return updateMeetingStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"updateMeetingAction">,
      });
    case "updateMeetingStatusAction":
      return updateMeetingStatusStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"updateMeetingStatusAction">,
      });
    case "addAttendeeNoteAction":
      return attendeeNoteStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"addAttendeeNoteAction">,
      });
    case "saveAgendaAction":
      return saveAgendaStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"saveAgendaAction">,
      });
    case "toggleChecklistItemAction":
      return toggleChecklistStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"toggleChecklistItemAction">,
      });
    case "updateChecklistItemAction":
      return updateChecklistStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"updateChecklistItemAction">,
      });
    case "updateRsvpStatusAction":
      return updateRsvpStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"updateRsvpStatusAction">,
      });
    case "toggleAttendanceStatusAction":
      return toggleAttendanceStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"toggleAttendanceStatusAction">,
      });
    case "recordAttendanceBatchAction":
      return recordAttendanceBatchStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"recordAttendanceBatchAction">,
      });
    case "clearResponseCardAction":
      return clearResponseStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"clearResponseCardAction">,
      });
    case "recordResponseCardAction":
      return recordResponseStatement({
        ...input,
        args: input.args as MeetingsEffectArguments<"recordResponseCardAction">,
      });
    case "removeAttendeeAction":
      return removeAttendanceStatement({
        ...input,
        exportName: input.exportName,
        args: input.args as MeetingsEffectArguments<"removeAttendeeAction">,
      });
    case "removeFromGuestListAction":
      return removeAttendanceStatement({
        ...input,
        exportName: input.exportName,
        args: input.args as MeetingsEffectArguments<"removeFromGuestListAction">,
      });
    case "quickAddAttendeeAction":
      return quickAddPersonStatement({
        ...input,
        exportName: input.exportName,
        args: input.args as MeetingsEffectArguments<"quickAddAttendeeAction">,
      });
    case "quickAddPersonToGuestListAction":
      return quickAddPersonStatement({
        ...input,
        exportName: input.exportName,
        args: input.args as MeetingsEffectArguments<"quickAddPersonToGuestListAction">,
      });
    case "quickAddWalkInAction":
      return quickAddPersonStatement({
        ...input,
        exportName: input.exportName,
        args: input.args as MeetingsEffectArguments<"quickAddWalkInAction">,
      });
    default:
      return null;
  }
}

const EXPORT_BY_IDENTITY = new Map(
  Object.entries(MEETINGS_ACTION_CONTRACTS).map(([exportName, contract]) => [
    contract.operationId,
    exportName as MeetingsActionExport,
  ])
);

/** Execute one closed Meetings registration; no generic SQL reaches this API. */
export async function executeMeetingsEffect(
  input: EvryEffectInput
): Promise<EvryEffectResult> {
  const exportName = EXPORT_BY_IDENTITY.get(input.execution.capabilityIdentity);
  if (!exportName || !exactTuple(input, input.execution.capabilityIdentity)) {
    return { status: "refused", excludedCount: 1 };
  }
  const parsed = MEETINGS_EFFECT_ARGUMENT_SCHEMAS[exportName].safeParse(
    input.arguments
  );
  if (!parsed.success) return { status: "refused", excludedCount: 1 };
  const statement = mutationStatementFor({
    exportName,
    execution: input.execution,
    effectKey: input.effectKey,
    args: parsed.data as Readonly<Record<string, unknown>>,
  });
  if (!statement) return { status: "retryable" };

  const [, result] = await db.batch([
    db.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(${input.effectKey}, 0))`
    ),
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
  return (
    (await exactCompletedOutcome(input)) ?? {
      status: "refused",
      excludedCount: 1,
    }
  );
}
