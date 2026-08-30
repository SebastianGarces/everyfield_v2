import { and, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { evryExecutionOutcomes } from "@/db/schema";
import { executionStepOutcomeKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";
import { syncMeetingNotifications } from "@/lib/meetings/notifications";
import {
  personHoldsLoginFilter,
  personIsUserInChurch,
} from "@/lib/people/person-user";

import {
  parseTeamsEffectArguments,
  TEAMS_EFFECT_IDENTITY_BY_OPERATION,
  type TeamsEffectArguments,
} from "./effect-contracts";

interface CompletedRow extends Record<string, unknown> {
  affected_count: number;
  excluded_count: number;
}

export type TeamsEffectExecutionDeps = Readonly<{
  findCompletedOutcome: typeof completedOutcome;
  executeStatement: typeof executeStatement;
  syncMeetingNotifications: typeof syncMeetingNotifications;
}>;

function exactTuple(input: EvryEffectInput, identity: string): boolean {
  const actor = input.authorization.actor;
  return (
    input.authorization.registration.identity === identity &&
    input.execution.capabilityIdentity === identity &&
    input.execution.actorUserId === actor.userId &&
    input.execution.plantId === actor.plantId
  );
}

async function completedOutcome(
  input: EvryEffectInput
): Promise<EvryEffectResult | null> {
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

function outcomePrelude(
  input: EvryEffectInput,
  args: TeamsEffectArguments
): SQL {
  const outcomeKey = executionStepOutcomeKey(
    input.execution.planId,
    input.execution.fingerprint,
    input.execution.stepId
  );
  return sql`
    input_document as materialized (
      select ${JSON.stringify(args)}::jsonb document
    ), expected_plan as materialized (
      select row->>'table' table_name, (row->>'id')::uuid id,
             nullif(row->'state', 'null'::jsonb) state
      from input_document, jsonb_array_elements(document->'expected') row
    ), set_plan as materialized (
      select row->>'kind' kind, nullif(row->>'scopeId','')::uuid scope_id,
             nullif(row->>'otherId','')::uuid other_id, row->'ids' ids
      from input_document, jsonb_array_elements(document->'sets') row
    ), mutation_plan as materialized (
      select row->>'table' table_name, (row->>'id')::uuid id,
             row->>'mode' mode, row->'before' before_state, row->'after' after_state
      from input_document, jsonb_array_elements(document->'mutations') row
    ), existing as materialized (
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
      join evry_action_plan_states s on s.plan_id = a.plan_id and s.church_id = a.church_id
      join users actor on actor.id = a.actor_user_id and actor.church_id = a.church_id
      where a.id = ${input.execution.attemptId}::uuid
        and a.plan_id = ${input.execution.planId}::uuid
        and a.church_id = ${input.execution.plantId}::uuid
        and a.actor_user_id = ${input.execution.actorUserId}::uuid
        and a.plan_fingerprint = ${input.execution.fingerprint}
        and a.correlation_id = ${input.execution.correlationId}::uuid
        and s.status = 'executing'
        and (
          actor.seat in ('owner', 'admin')
          or (
            actor.seat = 'member'
            and (select document->>'operation' from input_document) = 'initializeResponsibilities'
          )
        )
        and not exists (select 1 from existing)
        and not exists (
          select 1 from expected_plan e
          where (e.state is null and (
            (e.table_name = 'churches' and exists (select 1 from churches r where r.id = e.id)) or
            (e.table_name = 'ministry_teams' and exists (select 1 from ministry_teams r where r.id = e.id)) or
            (e.table_name = 'team_roles' and exists (select 1 from team_roles r where r.id = e.id)) or
            (e.table_name = 'team_memberships' and exists (select 1 from team_memberships r where r.id = e.id)) or
            (e.table_name = 'team_responsibilities' and exists (select 1 from team_responsibilities r where r.id = e.id)) or
            (e.table_name = 'training_programs' and exists (select 1 from training_programs r where r.id = e.id)) or
            (e.table_name = 'training_completions' and exists (select 1 from training_completions r where r.id = e.id)) or
            (e.table_name = 'locations' and exists (select 1 from locations r where r.id = e.id)) or
            (e.table_name = 'church_meetings' and exists (select 1 from church_meetings r where r.id = e.id)) or
            (e.table_name = 'meeting_attendance' and exists (select 1 from meeting_attendance r where r.id = e.id)) or
            (e.table_name = 'persons' and exists (select 1 from persons r where r.id = e.id)) or
            (e.table_name = 'person_activities' and exists (select 1 from person_activities r where r.id = e.id))
          )) or (e.state is not null and not (
            (e.table_name = 'churches' and exists (select 1 from churches r where r.id = e.id and r.id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'ministry_teams' and exists (select 1 from ministry_teams r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'team_roles' and exists (select 1 from team_roles r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'team_memberships' and exists (select 1 from team_memberships r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'team_responsibilities' and exists (select 1 from team_responsibilities r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'training_programs' and exists (select 1 from training_programs r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'training_completions' and exists (select 1 from training_completions r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'locations' and exists (select 1 from locations r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'church_meetings' and exists (select 1 from church_meetings r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'meeting_attendance' and exists (select 1 from meeting_attendance r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'persons' and exists (select 1 from persons r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state)) or
            (e.table_name = 'person_activities' and exists (select 1 from person_activities r where r.id = e.id and r.church_id = ${input.execution.plantId}::uuid and to_jsonb(r) = e.state))
          ))
        )
        and not exists (
          select 1 from set_plan sp
          where sp.ids <> case sp.kind
            when 'church_teams' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from ministry_teams where church_id=${input.execution.plantId}::uuid)
            when 'team_roles' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from team_roles where church_id=${input.execution.plantId}::uuid and team_id=sp.scope_id)
            when 'team_active_memberships' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from team_memberships where church_id=${input.execution.plantId}::uuid and team_id=sp.scope_id and status='active')
            when 'team_responsibilities' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from team_responsibilities where church_id=${input.execution.plantId}::uuid and team_id=sp.scope_id)
            when 'team_training_programs' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from training_programs where church_id=${input.execution.plantId}::uuid and (team_id=sp.scope_id or team_id is null))
            when 'team_meetings' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from church_meetings where church_id=${input.execution.plantId}::uuid and team_id=sp.scope_id)
            when 'active_role_memberships' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from team_memberships where church_id=${input.execution.plantId}::uuid and role_id=sp.scope_id and status='active')
            when 'role_memberships' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from team_memberships where church_id=${input.execution.plantId}::uuid and role_id=sp.scope_id)
            when 'person_role_memberships' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from team_memberships where church_id=${input.execution.plantId}::uuid and role_id=sp.scope_id and person_id=sp.other_id)
            when 'active_person_team_memberships' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from team_memberships where church_id=${input.execution.plantId}::uuid and person_id=sp.scope_id and team_id=sp.other_id and status='active')
            when 'training_completion_pair' then (select coalesce(jsonb_agg(id::text order by id::text), '[]'::jsonb) from training_completions where church_id=${input.execution.plantId}::uuid and person_id=sp.scope_id and training_program_id=sp.other_id)
            when 'core_group_people' then (select coalesce(jsonb_agg(persons.id::text order by persons.id::text), '[]'::jsonb) from persons where persons.church_id=${input.execution.plantId}::uuid and persons.deleted_at is null and persons.status in ('core_group','launch_team','leader'))
            when 'core_group_users' then (select coalesce(jsonb_agg(distinct users.id::text order by users.id::text), '[]'::jsonb) from persons join users on ${personIsUserInChurch(input.execution.plantId)} where ${personHoldsLoginFilter(input.execution.plantId)} and persons.status in ('core_group','launch_team','leader'))
            when 'active_team_users' then (select coalesce(jsonb_agg(distinct users.id::text order by users.id::text), '[]'::jsonb) from team_memberships tm join persons on persons.id=tm.person_id and persons.church_id=tm.church_id join users on ${personIsUserInChurch(input.execution.plantId)} where tm.church_id=${input.execution.plantId}::uuid and tm.team_id=sp.scope_id and tm.status='active' and ${personHoldsLoginFilter(input.execution.plantId)})
            when 'confirmed_owner_people' then (select coalesce(jsonb_agg(p.id::text order by p.id::text), '[]'::jsonb) from persons p join users u on u.id=p.user_id and u.church_id=p.church_id join churches c on c.id=p.church_id where p.church_id=${input.execution.plantId}::uuid and p.deleted_at is null and u.seat='owner' and c.leadership_status='planter_confirmed')
          end
        )
        and not exists (
          select 1 from mutation_plan m
          where (m.table_name = 'churches' and (m.after_state->>'id')::uuid <> ${input.execution.plantId}::uuid)
             or (m.table_name <> 'churches' and m.after_state is not null and (m.after_state->>'church_id')::uuid <> ${input.execution.plantId}::uuid)
             or (m.mode = 'insert' and m.after_state ? 'created_by' and (m.after_state->>'created_by')::uuid <> ${input.execution.actorUserId}::uuid)
        )
    ), claimed as materialized (
      insert into evry_execution_outcomes (
        attempt_id, plan_id, church_id, actor_user_id, plan_fingerprint,
        correlation_id, outcome_key, effect_key, subject, step_id,
        capability_identity, status, result_code, affected_count,
        excluded_count, occurred_at
      )
      select e.id, e.plan_id, e.church_id, e.actor_user_id, e.plan_fingerprint,
             e.correlation_id, ${outcomeKey}, ${input.effectKey}, 'step',
             ${input.execution.stepId}, ${input.execution.capabilityIdentity},
             'completed', 'effect_completed',
             (select count(*)::int from mutation_plan), 0, transaction_timestamp()
      from eligible e
      on conflict do nothing
      returning affected_count, excluded_count
    )`;
}

function rowWrites(): SQL {
  return sql`
    inserted_teams as (insert into ministry_teams select (jsonb_populate_record(null::ministry_teams, m.after_state)).* from mutation_plan m, claimed where m.table_name='ministry_teams' and m.mode='insert' returning id),
    updated_teams as (update ministry_teams t set name=p.name, template_key=p.template_key, type=p.type, description=p.description, icon=p.icon, leader_id=p.leader_id, responsibilities_seeded_at=p.responsibilities_seeded_at, reports_to_team_id=p.reports_to_team_id, phase_introduced=p.phase_introduced, status=p.status, sort_order=p.sort_order, updated_at=p.updated_at from mutation_plan m, claimed, lateral jsonb_populate_record(null::ministry_teams,m.after_state) p where m.table_name='ministry_teams' and m.mode='update' and t.id=m.id returning t.id),
    inserted_roles as (insert into team_roles select (jsonb_populate_record(null::team_roles, m.after_state)).* from mutation_plan m, claimed where m.table_name='team_roles' and m.mode='insert' returning id),
    updated_roles as (update team_roles t set name=p.name, description=p.description, reports_to_role_id=p.reports_to_role_id, is_leadership_role=p.is_leadership_role, time_commitment=p.time_commitment, desired_skills=p.desired_skills, sort_order=p.sort_order, status=p.status, updated_at=p.updated_at from mutation_plan m, claimed, lateral jsonb_populate_record(null::team_roles,m.after_state) p where m.table_name='team_roles' and m.mode='update' and t.id=m.id returning t.id),
    deleted_memberships as (delete from team_memberships t using mutation_plan m, claimed where m.table_name='team_memberships' and m.mode='delete' and t.id=m.id returning t.id),
    deleted_roles as (delete from team_roles t using mutation_plan m, claimed where m.table_name='team_roles' and m.mode='delete' and t.id=m.id and (select count(*) from deleted_memberships) >= 0 returning t.id),
    inserted_memberships as (insert into team_memberships select (jsonb_populate_record(null::team_memberships,m.after_state)).* from mutation_plan m, claimed where m.table_name='team_memberships' and m.mode='insert' returning id),
    updated_memberships as (update team_memberships t set person_id=p.person_id, role_id=p.role_id, team_id=p.team_id, start_date=p.start_date, end_date=p.end_date, status=p.status, notes=p.notes, updated_at=p.updated_at from mutation_plan m, claimed, lateral jsonb_populate_record(null::team_memberships,m.after_state) p where m.table_name='team_memberships' and m.mode='update' and t.id=m.id returning t.id),
    inserted_responsibilities as (insert into team_responsibilities select (jsonb_populate_record(null::team_responsibilities,m.after_state)).* from mutation_plan m, claimed where m.table_name='team_responsibilities' and m.mode='insert' returning id),
    updated_responsibilities as (update team_responsibilities t set title=p.title, sort_order=p.sort_order, completed_at=p.completed_at, updated_at=p.updated_at from mutation_plan m, claimed, lateral jsonb_populate_record(null::team_responsibilities,m.after_state) p where m.table_name='team_responsibilities' and m.mode='update' and t.id=m.id returning t.id),
    deleted_responsibilities as (delete from team_responsibilities t using mutation_plan m, claimed where m.table_name='team_responsibilities' and m.mode='delete' and t.id=m.id returning t.id),
    inserted_programs as (insert into training_programs select (jsonb_populate_record(null::training_programs,m.after_state)).* from mutation_plan m, claimed where m.table_name='training_programs' and m.mode='insert' returning id),
    inserted_completions as (insert into training_completions select (jsonb_populate_record(null::training_completions,m.after_state)).* from mutation_plan m, claimed where m.table_name='training_completions' and m.mode='insert' returning id),
    inserted_locations as (insert into locations select (jsonb_populate_record(null::locations,m.after_state)).* from mutation_plan m, claimed where m.table_name='locations' and m.mode='insert' returning id),
    inserted_meetings as (insert into church_meetings select (jsonb_populate_record(null::church_meetings,m.after_state)).* from mutation_plan m, claimed where m.table_name='church_meetings' and m.mode='insert' returning id),
    inserted_attendance as (insert into meeting_attendance select (jsonb_populate_record(null::meeting_attendance,m.after_state)).* from mutation_plan m, claimed where m.table_name='meeting_attendance' and m.mode='insert' returning id),
    updated_persons as (update persons t set status=p.status, updated_at=p.updated_at from mutation_plan m, claimed, lateral jsonb_populate_record(null::persons,m.after_state) p where m.table_name='persons' and m.mode='update' and t.id=m.id returning t.id),
    inserted_activities as (insert into person_activities select (jsonb_populate_record(null::person_activities,m.after_state)).* from mutation_plan m, claimed where m.table_name='person_activities' and m.mode='insert' returning id),
    updated_church as (update churches t set last_material_event_at=p.last_material_event_at, updated_at=p.updated_at from mutation_plan m, claimed, lateral jsonb_populate_record(null::churches,m.after_state) p where m.table_name='churches' and m.mode='update' and t.id=m.id returning t.id)`;
}

async function executeStatement(
  input: EvryEffectInput,
  args: TeamsEffectArguments
): Promise<EvryEffectResult> {
  const statement = db
    .execute<CompletedRow>(
      sql`with ${outcomePrelude(input, args)}, ${rowWrites()} select affected_count, excluded_count from existing union all select affected_count, excluded_count from claimed limit 1`
    )
    .getQuery();
  const [rows] = await db.$client.transaction(
    (transaction) => [transaction.query(statement.sql, statement.params)],
    { isolationLevel: "Serializable" }
  );
  const row = rows[0] as CompletedRow | undefined;
  return row
    ? {
        status: "completed",
        affectedCount: row.affected_count,
        excludedCount: row.excluded_count,
      }
    : { status: "refused", excludedCount: 1 };
}

function isSerializableRetry(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = Reflect.get(error, "code");
  return code === "40001" || code === "40P01";
}

async function syncMeetingAfterCommit(
  input: EvryEffectInput,
  args: TeamsEffectArguments,
  synchronize: typeof syncMeetingNotifications
): Promise<void> {
  if (args.operation !== "createMeetingAction") return;
  const meeting = args.mutations.find(
    ({ table, mode }) => table === "church_meetings" && mode === "insert"
  );
  if (!meeting) return;
  try {
    // The keyed outcome and meeting/guest rows are already committed. This is
    // deliberately the same best-effort F11 boundary as meetings/service.ts:
    // it re-reads facts and audience, gates every recipient, and dedupes each
    // notification independently. A replay may safely ask it to converge.
    await synchronize(input.execution.plantId, meeting.id, {
      mustCancel: false,
    });
  } catch (error) {
    // The canonical implementation never throws. Keep this catch at the
    // adapter seam so a replacement transport cannot retroactively turn a
    // committed meeting into a refusal or retryable execution.
    if (process.env.EVRY_TEAMS_EFFECT_DEBUG === "1") {
      console.error("Teams meeting notification sync debug", error);
    }
  }
}

async function completedWithNotificationSync(
  result: EvryEffectResult,
  input: EvryEffectInput,
  args: TeamsEffectArguments,
  synchronize: typeof syncMeetingNotifications
): Promise<EvryEffectResult> {
  if (result.status === "completed") {
    await syncMeetingAfterCommit(input, args, synchronize);
  }
  return result;
}

/** One PostgreSQL statement owns exact drift refusal, effect claim, and writes. */
export async function executeTeamsEffect(
  input: EvryEffectInput,
  dependencies: Partial<TeamsEffectExecutionDeps> = {}
): Promise<EvryEffectResult> {
  const findCompleted = dependencies.findCompletedOutcome ?? completedOutcome;
  const runStatement = dependencies.executeStatement ?? executeStatement;
  const synchronize =
    dependencies.syncMeetingNotifications ?? syncMeetingNotifications;
  const operation = input.arguments.operation;
  if (
    typeof operation !== "string" ||
    !(operation in TEAMS_EFFECT_IDENTITY_BY_OPERATION)
  ) {
    return { status: "refused", excludedCount: 1 };
  }
  const typedOperation =
    operation as keyof typeof TEAMS_EFFECT_IDENTITY_BY_OPERATION;
  const identity = TEAMS_EFFECT_IDENTITY_BY_OPERATION[typedOperation];
  if (!exactTuple(input, identity))
    return { status: "refused", excludedCount: 1 };
  let args: TeamsEffectArguments;
  try {
    args = parseTeamsEffectArguments(typedOperation, input.arguments);
  } catch {
    return { status: "refused", excludedCount: 1 };
  }
  const previous = await findCompleted(input);
  if (previous)
    return completedWithNotificationSync(previous, input, args, synchronize);
  try {
    return await completedWithNotificationSync(
      await runStatement(input, args),
      input,
      args,
      synchronize
    );
  } catch (error) {
    if (process.env.EVRY_TEAMS_EFFECT_DEBUG === "1") {
      console.error("Teams atomic effect debug", error);
    }
    const replay = await findCompleted(input);
    if (replay)
      return completedWithNotificationSync(replay, input, args, synchronize);
    if (isSerializableRetry(error)) {
      // The first transaction lost a real database serialization race. A new
      // transaction can now prove one of the two closed outcomes: the keyed
      // effect committed, or the exact baseline no longer matches.
      try {
        return await completedWithNotificationSync(
          await runStatement(input, args),
          input,
          args,
          synchronize
        );
      } catch (retryError) {
        if (process.env.EVRY_TEAMS_EFFECT_DEBUG === "1") {
          console.error("Teams atomic effect retry debug", retryError);
        }
        const retriedReplay = await findCompleted(input);
        if (retriedReplay)
          return completedWithNotificationSync(
            retriedReplay,
            input,
            args,
            synchronize
          );
        return { status: "retryable" };
      }
    }
    // A transport, driver, or unknown database failure says nothing about the
    // domain. Keep the step non-durable and retryable.
    return { status: "retryable" };
  }
}
