import { createHash } from "node:crypto";

import { and, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { evryExecutionOutcomes } from "@/db/schema";
import {
  executionStepOutcomeKey,
  type EvryAuditKey,
} from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "@/lib/evry/executor";

const EFFECT_UNIQUE = "evry_execution_outcomes_effect_unique_idx";
const STEP_UNIQUE = "evry_execution_outcomes_step_unique_idx";
const OUTCOME_KEY_UNIQUE = "evry_execution_outcomes_key_unique_idx";

interface CompletedEffectRow extends Record<string, unknown> {
  affected_count: number;
  excluded_count: number;
}

/** Stable database/provider identity derived only from the approved effect. */
export function communicationEvryEffectUuid(
  effectKey: string,
  purpose: string
): string {
  const digest = createHash("sha256")
    .update("evry-communication-effect-v1\0")
    .update(effectKey)
    .update("\0")
    .update(purpose)
    .digest("hex")
    .slice(0, 32)
    .split("");
  digest[12] = "4";
  digest[16] = ((Number.parseInt(digest[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16
  );
  return `${digest.slice(0, 8).join("")}-${digest
    .slice(8, 12)
    .join("")}-${digest.slice(12, 16).join("")}-${digest
    .slice(16, 20)
    .join("")}-${digest.slice(20).join("")}`;
}

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
 * Run a Communication database effect and claim its exact executor outcome in
 * the same statement. The trusted mutation must select through `eligible` and
 * return affected/excluded counts only after the complete invariant holds.
 */
export async function claimEvryCommunicationDatabaseEffect(input: {
  execution: EvryEffectInput["execution"];
  effectKey: EvryAuditKey;
  mutation: SQL;
  targetIsCurrent(): Promise<boolean>;
}): Promise<EvryEffectResult> {
  const replay = await exactCompletedOutcome(input);
  if (replay) return replay;

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
      ), mutation as materialized (
        ${input.mutation}
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
        from eligible e
        cross join mutation m
        returning affected_count, excluded_count
      )
      select affected_count, excluded_count from existing
      union all
      select affected_count, excluded_count from claimed
      limit 1
    `);
  } catch (error) {
    if (
      !isUniqueViolation(error, EFFECT_UNIQUE) &&
      !isUniqueViolation(error, STEP_UNIQUE) &&
      !isUniqueViolation(error, OUTCOME_KEY_UNIQUE)
    ) {
      throw error;
    }
    return (await exactCompletedOutcome(input)) ?? { status: "retryable" };
  }

  const row = result.rows[0];
  if (row) {
    return {
      status: "completed",
      affectedCount: row.affected_count,
      excludedCount: row.excluded_count,
    };
  }
  const completed = await exactCompletedOutcome(input);
  if (completed) return completed;
  return (await input.targetIsCurrent())
    ? { status: "retryable" }
    : { status: "refused", excludedCount: 1 };
}
