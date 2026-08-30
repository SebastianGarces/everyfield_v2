import { and, eq, sql, type SQL } from "drizzle-orm";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import { evryExecutionEffectClaims, evryExecutionOutcomes } from "@/db/schema";
import { type EvryAuditKey } from "@/lib/evry/audit/identity";
import type { EvryEffectInput, EvryEffectResult } from "./registry";

const EFFECT_UNIQUE = "evry_execution_effect_claims_effect_unique_idx";
const STEP_UNIQUE = "evry_execution_effect_claims_step_unique_idx";

interface CompletedEffectRow extends Record<string, unknown> {
  affected_count: number;
  excluded_count: number;
  newly_claimed: boolean;
}

export type EvryDatabaseEffectClaim = Readonly<{
  result: EvryEffectResult;
  disposition: "claimed" | "replayed" | "unclaimed";
}>;

export async function findExactEvryDatabaseEffectClaim(
  input: Pick<EvryEffectInput, "execution" | "effectKey">
): Promise<EvryEffectResult | null> {
  const [row] = await db
    .select({
      affectedCount: evryExecutionEffectClaims.affectedCount,
      excludedCount: evryExecutionEffectClaims.excludedCount,
    })
    .from(evryExecutionEffectClaims)
    .where(
      and(
        eq(evryExecutionEffectClaims.attemptId, input.execution.attemptId),
        eq(evryExecutionEffectClaims.planId, input.execution.planId),
        eq(evryExecutionEffectClaims.churchId, input.execution.plantId),
        eq(evryExecutionEffectClaims.actorUserId, input.execution.actorUserId),
        eq(
          evryExecutionEffectClaims.planFingerprint,
          input.execution.fingerprint
        ),
        eq(
          evryExecutionEffectClaims.correlationId,
          input.execution.correlationId
        ),
        eq(evryExecutionEffectClaims.stepId, input.execution.stepId),
        eq(
          evryExecutionEffectClaims.capabilityIdentity,
          input.execution.capabilityIdentity
        ),
        eq(evryExecutionEffectClaims.effectKey, input.effectKey)
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

/** A terminal step row proves a concurrent reconciler finished this claim. */
export async function findExactEvryDatabaseEffectOutcome(
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
        eq(evryExecutionOutcomes.subject, "step"),
        eq(evryExecutionOutcomes.stepId, input.execution.stepId),
        eq(
          evryExecutionOutcomes.capabilityIdentity,
          input.execution.capabilityIdentity
        ),
        eq(evryExecutionOutcomes.effectKey, input.effectKey),
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
 * Claim one exact database effect in the same SQL statement as its domain
 * mutation. This claim is intentionally separate from the terminal executor
 * outcome: the adapter may still owe replay-safe reconciliation, and the core
 * records the step outcome only after the adapter returns completed.
 *
 * The mutation must select through `eligible` and expose `affected_count` /
 * `excluded_count`; owner modules remain responsible for constructing the
 * mutation and its source predicates.
 */
export async function claimEvryDatabaseEffectDecision(input: {
  execution: EvryEffectInput["execution"];
  effectKey: EvryAuditKey;
  /** Additional top-level CTEs owned by a compound domain writer. */
  mutationCtes?: SQL;
  mutation: SQL;
  targetIsCurrent(): Promise<boolean>;
}): Promise<EvryDatabaseEffectClaim> {
  const replay = await findExactEvryDatabaseEffectClaim(input);
  if (replay) return { result: replay, disposition: "replayed" };

  let result: Awaited<ReturnType<typeof db.execute<CompletedEffectRow>>>;
  try {
    result = await db.execute<CompletedEffectRow>(sql`
      with existing as materialized (
        select c.affected_count, c.excluded_count
        from evry_execution_effect_claims c
        where c.attempt_id = ${input.execution.attemptId}::uuid
          and c.plan_id = ${input.execution.planId}::uuid
          and c.church_id = ${input.execution.plantId}::uuid
          and c.actor_user_id = ${input.execution.actorUserId}::uuid
          and c.plan_fingerprint = ${input.execution.fingerprint}
          and c.correlation_id = ${input.execution.correlationId}::uuid
          and c.effect_key = ${input.effectKey}
          and c.step_id = ${input.execution.stepId}
          and c.capability_identity = ${input.execution.capabilityIdentity}
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
      )${input.mutationCtes ? sql`, ${input.mutationCtes}` : sql``}, mutation as materialized (
        ${input.mutation}
      ), claimed as (
        insert into evry_execution_effect_claims (
          attempt_id, plan_id, church_id, actor_user_id, plan_fingerprint,
          correlation_id, effect_key, step_id, capability_identity,
          affected_count, excluded_count, claimed_at
        )
        select
          e.id, e.plan_id, e.church_id, e.actor_user_id, e.plan_fingerprint,
          e.correlation_id, ${input.effectKey}, ${input.execution.stepId},
          ${input.execution.capabilityIdentity}, m.affected_count,
          m.excluded_count, transaction_timestamp()
        from eligible e
        cross join mutation m
        returning affected_count, excluded_count
      )
      select affected_count, excluded_count, false as newly_claimed from existing
      union all
      select affected_count, excluded_count, true as newly_claimed from claimed
      limit 1
    `);
  } catch (error) {
    if (
      !isUniqueViolation(error, EFFECT_UNIQUE) &&
      !isUniqueViolation(error, STEP_UNIQUE)
    ) {
      throw error;
    }
    const recovered = await findExactEvryDatabaseEffectClaim(input);
    return recovered
      ? { result: recovered, disposition: "replayed" }
      : { result: { status: "retryable" }, disposition: "unclaimed" };
  }

  const row = result.rows[0];
  if (row) {
    return {
      result: {
        status: "completed",
        affectedCount: row.affected_count,
        excludedCount: row.excluded_count,
      },
      disposition: row.newly_claimed ? "claimed" : "replayed",
    };
  }
  const completed = await findExactEvryDatabaseEffectClaim(input);
  if (completed) return { result: completed, disposition: "replayed" };
  return {
    result: (await input.targetIsCurrent())
      ? { status: "retryable" }
      : { status: "refused", excludedCount: 1 },
    disposition: "unclaimed",
  };
}

/** Compatibility surface for packs that need only the public effect result. */
export async function claimEvryDatabaseEffect(
  input: Parameters<typeof claimEvryDatabaseEffectDecision>[0]
): Promise<EvryEffectResult> {
  return (await claimEvryDatabaseEffectDecision(input)).result;
}
