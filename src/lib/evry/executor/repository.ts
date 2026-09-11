import { randomUUID } from "node:crypto";

import { and, asc, count, eq, sql } from "drizzle-orm";

import { db } from "@/db";
import { evryExecutionAttempts, evryExecutionOutcomes } from "@/db/schema";
import {
  executionAttemptKey,
  executionAttemptOutcomeKey,
  executionStepOutcomeKey,
  type EvryAuditKey,
} from "@/lib/evry/audit/identity";

import {
  finishEvryExecutionStatement,
  startEvryExecutionStatement,
} from "./statements";
import type { EvryJsonValue } from "@/lib/evry/plans";

export type EvryDurableStepStatus =
  | "completed"
  | "refused"
  | "failed"
  | "skipped";

export type EvryDurableStepOutcome = Readonly<{
  stepId: string;
  capabilityIdentity: string;
  status: EvryDurableStepStatus;
  affectedCount: number;
  excludedCount: number;
  effectKey: EvryAuditKey | null;
  dependencyOutput: EvryJsonValue | null;
}>;

export type EvryExecutionAttemptRecord = Readonly<{
  id: string;
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  correlationId: string;
}>;

export type EvryExecutionSnapshot = Readonly<{
  attempt: EvryExecutionAttemptRecord;
  steps: readonly EvryDurableStepOutcome[];
  terminalStatus:
    | "completed"
    | "partially_failed"
    | "failed"
    | "refused"
    | null;
}>;

function toAttempt(
  row: typeof evryExecutionAttempts.$inferSelect
): EvryExecutionAttemptRecord {
  return Object.freeze({
    id: row.id,
    planId: row.planId,
    actorUserId: row.actorUserId,
    plantId: row.churchId,
    fingerprint: row.planFingerprint,
    correlationId: row.correlationId,
  });
}

export async function findEvryExecutionSnapshot(input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
}): Promise<EvryExecutionSnapshot | null> {
  const [attempt] = await db
    .select()
    .from(evryExecutionAttempts)
    .where(
      and(
        eq(evryExecutionAttempts.planId, input.planId),
        eq(evryExecutionAttempts.actorUserId, input.actorUserId),
        eq(evryExecutionAttempts.churchId, input.plantId),
        eq(evryExecutionAttempts.planFingerprint, input.fingerprint),
        eq(
          evryExecutionAttempts.attemptKey,
          executionAttemptKey(input.planId, input.fingerprint)
        )
      )
    )
    .limit(1);
  if (!attempt) return null;

  const outcomes = await db
    .select({
      subject: evryExecutionOutcomes.subject,
      stepId: evryExecutionOutcomes.stepId,
      capabilityIdentity: evryExecutionOutcomes.capabilityIdentity,
      status: evryExecutionOutcomes.status,
      affectedCount: evryExecutionOutcomes.affectedCount,
      excludedCount: evryExecutionOutcomes.excludedCount,
      effectKey: evryExecutionOutcomes.effectKey,
      dependencyOutput: evryExecutionOutcomes.dependencyOutput,
    })
    .from(evryExecutionOutcomes)
    .where(
      and(
        eq(evryExecutionOutcomes.attemptId, attempt.id),
        eq(evryExecutionOutcomes.planId, input.planId),
        eq(evryExecutionOutcomes.actorUserId, input.actorUserId),
        eq(evryExecutionOutcomes.churchId, input.plantId),
        eq(evryExecutionOutcomes.planFingerprint, input.fingerprint)
      )
    )
    .orderBy(
      asc(evryExecutionOutcomes.occurredAt),
      asc(evryExecutionOutcomes.id)
    );

  const terminal = outcomes.find(({ subject }) => subject === "attempt");
  const terminalStatus =
    terminal?.status === "completed" ||
    terminal?.status === "partially_failed" ||
    terminal?.status === "failed" ||
    terminal?.status === "refused"
      ? terminal.status
      : null;
  const steps = outcomes.flatMap((outcome): EvryDurableStepOutcome[] => {
    if (
      outcome.subject !== "step" ||
      !outcome.stepId ||
      !outcome.capabilityIdentity
    ) {
      return [];
    }
    return [
      Object.freeze({
        stepId: outcome.stepId,
        capabilityIdentity: outcome.capabilityIdentity,
        status: outcome.status as EvryDurableStepStatus,
        affectedCount: outcome.affectedCount,
        excludedCount: outcome.excludedCount,
        effectKey: outcome.effectKey as EvryAuditKey | null,
        dependencyOutput: outcome.dependencyOutput as EvryJsonValue | null,
      }),
    ];
  });

  return Object.freeze({
    attempt: toAttempt(attempt),
    steps,
    terminalStatus,
  });
}

export async function countEvryExecutionAttempts(input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
}): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(evryExecutionAttempts)
    .where(
      and(
        eq(evryExecutionAttempts.planId, input.planId),
        eq(evryExecutionAttempts.actorUserId, input.actorUserId),
        eq(evryExecutionAttempts.churchId, input.plantId),
        eq(evryExecutionAttempts.planFingerprint, input.fingerprint),
        eq(
          evryExecutionAttempts.attemptKey,
          executionAttemptKey(input.planId, input.fingerprint)
        )
      )
    );
  return row?.value ?? 0;
}

export async function startOrResumeEvryExecution(input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  startedAt: Date;
}): Promise<EvryExecutionSnapshot | null> {
  await db.execute(
    startEvryExecutionStatement({
      ...input,
      attemptId: randomUUID(),
      attemptKey: executionAttemptKey(input.planId, input.fingerprint),
    })
  );
  return findEvryExecutionSnapshot(input);
}

interface RevalidatedRow extends Record<string, unknown> {
  document: unknown;
}

/**
 * Recheck the exact actor/plant/fingerprint, confirmation, expiry, and active
 * attempt immediately before a capability adapter sees its arguments.
 */
export async function revalidateEvryExecutionStep(input: {
  attempt: EvryExecutionAttemptRecord;
  actorUserId: string;
  plantId: string;
  checkedAt: Date;
}): Promise<unknown | null> {
  const result = await db.execute<RevalidatedRow>(
    // The immutable confirmation and attempt FKs bind the same tuple. Keeping
    // all scope predicates here prevents an id-only preflight from existing.
    sql`
      select p.document
      from evry_action_plans p
      join evry_action_plan_states s
        on s.plan_id = p.id and s.church_id = p.church_id
      join evry_plan_confirmations c
        on c.plan_id = p.id
       and c.church_id = p.church_id
       and c.actor_user_id = p.actor_user_id
       and c.plan_fingerprint = p.fingerprint
      join evry_execution_attempts a
        on a.plan_id = p.id
       and a.church_id = p.church_id
       and a.actor_user_id = p.actor_user_id
       and a.plan_fingerprint = p.fingerprint
       and a.confirmation_id = c.id
      where a.id = ${input.attempt.id}::uuid
        and p.id = ${input.attempt.planId}::uuid
        and p.actor_user_id = ${input.actorUserId}::uuid
        and p.church_id = ${input.plantId}::uuid
        and p.fingerprint = ${input.attempt.fingerprint}
        and p.expires_at > ${input.checkedAt}
        and s.status = 'executing'
    `
  );
  return result.rows[0]?.document ?? null;
}

export async function recordEvryStepOutcome(input: {
  attempt: EvryExecutionAttemptRecord;
  stepId: string;
  capabilityIdentity: string;
  status: EvryDurableStepStatus;
  effectKey: EvryAuditKey | null;
  affectedCount: number;
  excludedCount: number;
  dependencyOutput?: EvryJsonValue;
  occurredAt: Date;
}): Promise<EvryDurableStepOutcome> {
  await db
    .insert(evryExecutionOutcomes)
    .values({
      attemptId: input.attempt.id,
      planId: input.attempt.planId,
      churchId: input.attempt.plantId,
      actorUserId: input.attempt.actorUserId,
      planFingerprint: input.attempt.fingerprint,
      correlationId: input.attempt.correlationId,
      outcomeKey: executionStepOutcomeKey(
        input.attempt.planId,
        input.attempt.fingerprint,
        input.stepId
      ),
      effectKey: input.effectKey,
      subject: "step",
      stepId: input.stepId,
      capabilityIdentity: input.capabilityIdentity,
      status: input.status,
      resultCode:
        input.status === "completed"
          ? "effect_completed"
          : input.status === "refused"
            ? "precondition_refused"
            : input.status === "skipped"
              ? "dependency_skipped"
              : "effect_failed",
      affectedCount: input.affectedCount,
      excludedCount: input.excludedCount,
      dependencyOutput: input.dependencyOutput,
      occurredAt: input.occurredAt,
    })
    .onConflictDoNothing();

  const snapshot = await findEvryExecutionSnapshot({
    planId: input.attempt.planId,
    actorUserId: input.attempt.actorUserId,
    plantId: input.attempt.plantId,
    fingerprint: input.attempt.fingerprint,
  });
  const recorded = snapshot?.steps.find(
    ({ stepId }) => stepId === input.stepId
  );
  if (!recorded) throw new Error("Evry step outcome did not persist");
  return recorded;
}

export async function finishEvryExecution(input: {
  attempt: EvryExecutionAttemptRecord;
  attemptStatus: "completed" | "partially_failed" | "failed" | "refused";
  planStatus: "completed" | "partially_failed" | "failed";
  occurredAt: Date;
}): Promise<EvryExecutionSnapshot> {
  await db.execute(
    finishEvryExecutionStatement({
      attemptId: input.attempt.id,
      planId: input.attempt.planId,
      actorUserId: input.attempt.actorUserId,
      plantId: input.attempt.plantId,
      fingerprint: input.attempt.fingerprint,
      outcomeKey: executionAttemptOutcomeKey(
        input.attempt.planId,
        input.attempt.fingerprint
      ),
      attemptStatus: input.attemptStatus,
      planStatus: input.planStatus,
      occurredAt: input.occurredAt,
    })
  );

  const snapshot = await findEvryExecutionSnapshot({
    planId: input.attempt.planId,
    actorUserId: input.attempt.actorUserId,
    plantId: input.attempt.plantId,
    fingerprint: input.attempt.fingerprint,
  });
  if (!snapshot) throw new Error("Evry execution attempt disappeared");
  return snapshot;
}
