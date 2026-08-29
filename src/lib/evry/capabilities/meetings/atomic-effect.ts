import { and, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { evryExecutionOutcomes, locations } from "@/db/schema";
import {
  executionStepOutcomeKey,
  type EvryAuditKey,
} from "@/lib/evry/audit/identity";

export type MeetingsEffectExecutionIdentity = Readonly<{
  attemptId: string;
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  correlationId: string;
  stepId: string;
  capabilityIdentity: string;
}>;

type CreateLocationArguments = Readonly<{
  locationId: string;
  name: string;
  address: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  cost: string | null;
  capacity: number | null;
  notes: string | null;
  expectedLocationAbsent: true;
}>;

interface ClaimedLocationRow extends Record<string, unknown> {
  affected_count: number;
  excluded_count: number;
  location_id: string | null;
}

export type ClaimEvryMeetingLocationResult =
  | Readonly<{
      status: "completed";
      affectedCount: 1;
      excludedCount: 0;
      locationId: string;
    }>
  | Readonly<{ status: "refused"; excludedCount: 1 }>
  | Readonly<{ status: "retryable" }>;

/**
 * Claim first, then create the location only from the winning claim.
 *
 * Both CTEs are one PostgreSQL statement. Concurrent first executions may
 * both observe absence, but the outcome ledger's exact unique key admits only
 * one `claimed` row; only that row can feed `location_inserted`. A crash after
 * commit therefore reopens the original outcome and location without applying
 * the effect twice.
 */
export async function claimEvryMeetingLocation(input: {
  execution: MeetingsEffectExecutionIdentity;
  effectKey: EvryAuditKey;
  arguments: CreateLocationArguments;
}): Promise<ClaimEvryMeetingLocationResult> {
  const outcomeKey = executionStepOutcomeKey(
    input.execution.planId,
    input.execution.fingerprint,
    input.execution.stepId
  );
  const args = input.arguments;
  const result = await db.execute<ClaimedLocationRow>(sql`
    with existing as materialized (
      select o.affected_count, o.excluded_count, l.id as location_id
      from evry_execution_outcomes o
      left join locations l
        on l.id = ${args.locationId}::uuid
       and l.church_id = o.church_id
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
        and not exists (
          select 1 from locations where id = ${args.locationId}::uuid
        )
    ), claimed as (
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
        'completed', 'effect_completed', 1, 0, transaction_timestamp()
      from eligible e
      on conflict do nothing
      returning affected_count, excluded_count, church_id
    ), location_inserted as (
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
    )
    select affected_count, excluded_count, location_id from existing
    union all
    select c.affected_count, c.excluded_count, l.id as location_id
    from claimed c
    join location_inserted l on true
    limit 1
  `);
  const row = result.rows[0];
  if (row?.affected_count === 1 && row.excluded_count === 0) {
    if (!row.location_id) {
      throw new Error("Completed Evry location claim has no location row");
    }
    return {
      status: "completed",
      affectedCount: 1,
      excludedCount: 0,
      locationId: row.location_id,
    };
  }

  // A concurrent winner can commit just after this statement's snapshot.
  // Reopen the exact ledger+row pair before deciding whether a same-key retry
  // is safe. No application-level SELECT is treated as a lock.
  const [outcome] = await db
    .select({
      affectedCount: evryExecutionOutcomes.affectedCount,
      excludedCount: evryExecutionOutcomes.excludedCount,
      locationId: locations.id,
    })
    .from(evryExecutionOutcomes)
    .innerJoin(
      locations,
      and(
        eq(locations.id, args.locationId),
        eq(locations.churchId, evryExecutionOutcomes.churchId)
      )
    )
    .where(
      and(
        eq(evryExecutionOutcomes.attemptId, input.execution.attemptId),
        eq(evryExecutionOutcomes.planId, input.execution.planId),
        eq(evryExecutionOutcomes.churchId, input.execution.plantId),
        eq(evryExecutionOutcomes.actorUserId, input.execution.actorUserId),
        eq(
          evryExecutionOutcomes.planFingerprint,
          input.execution.fingerprint
        ),
        eq(
          evryExecutionOutcomes.correlationId,
          input.execution.correlationId
        ),
        eq(evryExecutionOutcomes.effectKey, input.effectKey),
        eq(evryExecutionOutcomes.stepId, input.execution.stepId),
        eq(
          evryExecutionOutcomes.capabilityIdentity,
          input.execution.capabilityIdentity
        ),
        eq(evryExecutionOutcomes.status, "completed")
      )
    )
    .limit(1);
  if (
    outcome?.affectedCount === 1 &&
    outcome.excludedCount === 0 &&
    outcome.locationId
  ) {
    return {
      status: "completed",
      affectedCount: 1,
      excludedCount: 0,
      locationId: outcome.locationId,
    };
  }

  const [collision] = await db
    .select({ id: locations.id })
    .from(locations)
    .where(eq(locations.id, args.locationId))
    .limit(1);
  return collision
    ? { status: "refused", excludedCount: 1 }
    : { status: "retryable" };
}
