import { randomUUID } from "node:crypto";

import { and, asc, eq } from "drizzle-orm";

import { db } from "@/db";
import {
  evryActionPlans,
  evryActionPlanStates,
  evryExecutionAttempts,
  evryExecutionOutcomes,
  evryProductAuditEvents,
} from "@/db/schema";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import {
  noopAttemptKey,
  noopEffectKey,
  noopOutcomeKey,
  type EvryAuditRequest,
} from "./identity";
import { completeConfirmedNoopStatement } from "./statements";

export type EvryRequestAuditResult =
  | Readonly<{
      eventType: "request_read_completed";
      resultCode: "read_completed";
    }>
  | Readonly<{
      eventType: "request_refused";
      resultCode: "policy_refused" | "request_invalid";
    }>
  | Readonly<{
      eventType: "request_failed";
      resultCode: "request_failed";
    }>;

/** Append one planless, redacted result for an authenticated request. */
export async function recordEvryRequestAudit(input: {
  actor: EvryPlantActor;
  request: EvryAuditRequest;
  result: EvryRequestAuditResult;
}): Promise<void> {
  await db.insert(evryProductAuditEvents).values({
    churchId: input.actor.plantId,
    actorUserId: input.actor.userId,
    correlationId: input.request.correlationId,
    eventKey: input.request.eventKey,
    eventType: input.result.eventType,
    resultCode: input.result.resultCode,
    occurredAt: new Date(),
  });
}

export type EvryAuditProjection = Readonly<{
  planId: string;
  status: typeof evryActionPlanStates.$inferSelect.status;
  correlationId: string;
  events: readonly Readonly<{
    type: typeof evryProductAuditEvents.$inferSelect.eventType;
    occurredAt: string;
  }>[];
  attempts: readonly Readonly<{
    startedAt: string;
    outcomes: readonly Readonly<{
      subject: typeof evryExecutionOutcomes.$inferSelect.subject;
      stepId: string | null;
      capabilityIdentity: string | null;
      status: typeof evryExecutionOutcomes.$inferSelect.status;
      resultCode: typeof evryExecutionOutcomes.$inferSelect.resultCode;
      affectedCount: number;
      excludedCount: number;
      occurredAt: string;
    }>[];
  }>[];
}>;

/** Read one originating actor's plan evidence without exposing stored inputs. */
export async function findOwnEvryAuditProjection(input: {
  planId: string;
  actorUserId: string;
  plantId: string;
}): Promise<EvryAuditProjection | null> {
  const [exact] = await db
    .select({
      planId: evryActionPlans.id,
      status: evryActionPlanStates.status,
    })
    .from(evryActionPlans)
    .innerJoin(
      evryActionPlanStates,
      and(
        eq(evryActionPlanStates.planId, evryActionPlans.id),
        eq(evryActionPlanStates.churchId, evryActionPlans.churchId)
      )
    )
    .where(
      and(
        eq(evryActionPlans.id, input.planId),
        eq(evryActionPlans.actorUserId, input.actorUserId),
        eq(evryActionPlans.churchId, input.plantId)
      )
    )
    .limit(1);

  if (!exact) return null;

  const [events, attempts, outcomes] = await db.batch([
    db
      .select({
        type: evryProductAuditEvents.eventType,
        correlationId: evryProductAuditEvents.correlationId,
        occurredAt: evryProductAuditEvents.occurredAt,
      })
      .from(evryProductAuditEvents)
      .where(
        and(
          eq(evryProductAuditEvents.planId, exact.planId),
          eq(evryProductAuditEvents.actorUserId, input.actorUserId),
          eq(evryProductAuditEvents.churchId, input.plantId)
        )
      )
      .orderBy(
        asc(evryProductAuditEvents.occurredAt),
        asc(evryProductAuditEvents.id)
      ),
    db
      .select({
        id: evryExecutionAttempts.id,
        correlationId: evryExecutionAttempts.correlationId,
        startedAt: evryExecutionAttempts.startedAt,
      })
      .from(evryExecutionAttempts)
      .where(
        and(
          eq(evryExecutionAttempts.planId, exact.planId),
          eq(evryExecutionAttempts.actorUserId, input.actorUserId),
          eq(evryExecutionAttempts.churchId, input.plantId)
        )
      )
      .orderBy(
        asc(evryExecutionAttempts.startedAt),
        asc(evryExecutionAttempts.id)
      ),
    db
      .select({
        attemptId: evryExecutionOutcomes.attemptId,
        subject: evryExecutionOutcomes.subject,
        stepId: evryExecutionOutcomes.stepId,
        capabilityIdentity: evryExecutionOutcomes.capabilityIdentity,
        status: evryExecutionOutcomes.status,
        resultCode: evryExecutionOutcomes.resultCode,
        affectedCount: evryExecutionOutcomes.affectedCount,
        excludedCount: evryExecutionOutcomes.excludedCount,
        occurredAt: evryExecutionOutcomes.occurredAt,
      })
      .from(evryExecutionOutcomes)
      .where(
        and(
          eq(evryExecutionOutcomes.planId, exact.planId),
          eq(evryExecutionOutcomes.actorUserId, input.actorUserId),
          eq(evryExecutionOutcomes.churchId, input.plantId)
        )
      )
      .orderBy(
        asc(evryExecutionOutcomes.occurredAt),
        asc(evryExecutionOutcomes.id)
      ),
  ]);

  const correlationId = events[0]?.correlationId ?? attempts[0]?.correlationId;
  if (!correlationId) {
    throw new Error("Evry plan is missing its immutable proposal event");
  }

  return Object.freeze({
    planId: exact.planId,
    status: exact.status,
    correlationId,
    events: events.map((event) =>
      Object.freeze({
        type: event.type,
        occurredAt: event.occurredAt.toISOString(),
      })
    ),
    attempts: attempts.map((attempt) =>
      Object.freeze({
        startedAt: attempt.startedAt.toISOString(),
        outcomes: outcomes
          .filter((outcome) => outcome.attemptId === attempt.id)
          .map((outcome) =>
            Object.freeze({
              subject: outcome.subject,
              stepId: outcome.stepId,
              capabilityIdentity: outcome.capabilityIdentity,
              status: outcome.status,
              resultCode: outcome.resultCode,
              affectedCount: outcome.affectedCount,
              excludedCount: outcome.excludedCount,
              occurredAt: outcome.occurredAt.toISOString(),
            })
          ),
      })
    ),
  });
}

export type CompleteConfirmedNoopResult = Readonly<{
  status: "completed" | "already_completed" | "unavailable";
}>;

/** The only completed-effect writer in this wave: an explicitly inert fixture. */
export async function completeConfirmedNoop(input: {
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
}): Promise<CompleteConfirmedNoopResult> {
  const occurredAt = new Date();
  const completed = await db.execute<{ id: string; attempt_id: string }>(
    completeConfirmedNoopStatement({
      planId: input.planId,
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
      fingerprint: input.fingerprint,
      occurredAt,
      attemptId: randomUUID(),
      attemptKey: noopAttemptKey(input.planId),
      outcomeKey: noopOutcomeKey(input.planId),
      effectKey: noopEffectKey(input.planId),
    })
  );
  if (completed.rows[0]) return { status: "completed" };

  const [existing] = await db
    .select({ id: evryExecutionOutcomes.id })
    .from(evryExecutionOutcomes)
    .where(
      and(
        eq(evryExecutionOutcomes.planId, input.planId),
        eq(evryExecutionOutcomes.actorUserId, input.actor.userId),
        eq(evryExecutionOutcomes.churchId, input.actor.plantId),
        eq(evryExecutionOutcomes.planFingerprint, input.fingerprint),
        eq(evryExecutionOutcomes.effectKey, noopEffectKey(input.planId)),
        eq(evryExecutionOutcomes.status, "completed")
      )
    )
    .limit(1);

  return existing ? { status: "already_completed" } : { status: "unavailable" };
}
