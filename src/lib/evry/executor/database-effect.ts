import { and, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { evryExecutionOutcomes } from "@/db/schema";
import {
  executionStepOutcomeKey,
  type EvryAuditKey,
} from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "./registry";

const UNIQUE_CONSTRAINTS = [
  "evry_execution_outcomes_effect_unique_idx",
  "evry_execution_outcomes_step_unique_idx",
  "evry_execution_outcomes_key_unique_idx",
] as const;

interface CompletedEffectRow extends Record<string, unknown> {
  affected_count: number;
  excluded_count: number;
  newly_claimed: boolean;
}

export type EvryDatabaseEffectClaim = Readonly<{
  result: EvryEffectResult;
  disposition: "claimed" | "replayed" | "unclaimed";
}>;

async function exactCompletedOutcome(
  input: Pick<EvryEffectInput, "execution" | "effectKey">
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

/**
 * Execute a domain-owned SQL mutation and claim its exact step outcome in the
 * same statement. The mutation must select through `eligible` and return one
 * `affected_count` / `excluded_count` row only when every domain predicate is
 * current. Recovery always checks the immutable exact claim first.
 */
export async function claimEvryDatabaseEffectDecision(input: {
  execution: EvryEffectInput["execution"];
  effectKey: EvryAuditKey;
  mutationCtes?: SQL | (() => SQL | Promise<SQL>);
  mutation: SQL | (() => SQL | Promise<SQL>);
  targetIsCurrent(): Promise<boolean>;
}): Promise<EvryDatabaseEffectClaim> {
  const replay = await exactCompletedOutcome(input);
  if (replay) return { result: replay, disposition: "replayed" };
  // Replays must not depend on mutable domain state. Resolve any source reads
  // used to build the mutation only after exact immutable recovery.
  const mutationCtes =
    typeof input.mutationCtes === "function"
      ? await input.mutationCtes()
      : input.mutationCtes;
  const mutation =
    typeof input.mutation === "function"
      ? await input.mutation()
      : input.mutation;
  const outcomeKey = executionStepOutcomeKey(
    input.execution.planId,
    input.execution.fingerprint,
    input.execution.stepId
  );
  let result: Awaited<ReturnType<typeof db.execute<CompletedEffectRow>>>;
  try {
    result = await db.execute<CompletedEffectRow>(sql`
      with existing as materialized (
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
      )${mutationCtes ? sql`, ${mutationCtes}` : sql``}, mutation as materialized (
        ${mutation}
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
          'completed', 'effect_completed', m.affected_count,
          m.excluded_count, transaction_timestamp()
        from eligible e cross join mutation m
        returning affected_count, excluded_count
      )
      select affected_count, excluded_count, false as newly_claimed from existing
      union all
      select affected_count, excluded_count, true as newly_claimed from claimed
      limit 1
    `);
  } catch (error) {
    if (!UNIQUE_CONSTRAINTS.some((name) => isUniqueViolation(error, name)))
      throw error;
    const recovered = await exactCompletedOutcome(input);
    return recovered
      ? { result: recovered, disposition: "replayed" }
      : { result: { status: "retryable" }, disposition: "unclaimed" };
  }
  const row = result.rows[0];
  if (row)
    return {
      result: {
        status: "completed",
        affectedCount: row.affected_count,
        excludedCount: row.excluded_count,
      },
      disposition: row.newly_claimed ? "claimed" : "replayed",
    };
  const recovered = await exactCompletedOutcome(input);
  if (recovered) return { result: recovered, disposition: "replayed" };
  return {
    result: (await input.targetIsCurrent())
      ? { status: "retryable" }
      : { status: "refused", excludedCount: 1 },
    disposition: "unclaimed",
  };
}

export async function claimEvryDatabaseEffect(
  input: Parameters<typeof claimEvryDatabaseEffectDecision>[0]
): Promise<EvryEffectResult> {
  return (await claimEvryDatabaseEffectDecision(input)).result;
}
