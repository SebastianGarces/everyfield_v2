import { randomUUID } from "node:crypto";

import { and, eq } from "drizzle-orm";

import { db } from "@/db";
import { isUniqueViolation } from "@/db/errors";
import {
  evryActionPlans,
  evryActionPlanStates,
  evryPlanConfirmations,
  evryProductAuditEvents,
  type EvryPlanStatus,
} from "@/db/schema";

import {
  correlationForPlanRequest,
  planEventKey,
} from "@/lib/evry/audit/identity";

import {
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
} from "./fingerprint";
import type { EvryPlanRequestKey } from "./request-key";
import { evryPlanExpiresAt, type EvryActionPlanDocument } from "./schema";
import {
  confirmEvryActionPlanStatement,
  cancelEvryActionPlanStatement,
  reviseEvryActionPlanStatement,
} from "./statements";

export {
  confirmEvryActionPlanStatement,
  cancelEvryActionPlanStatement,
  reviseEvryActionPlanStatement,
} from "./statements";

const ACTOR_REQUEST_UNIQUE = "evry_action_plans_actor_request_unique_idx";

type PreparedEvryActionPlan = Readonly<{
  actorUserId: string;
  plantId: string;
  requestKey: EvryPlanRequestKey;
  intentFingerprint: string;
  fingerprint: string;
  document: EvryActionPlanDocument;
  createdAt: Date;
  expiresAt: Date;
  supersedesPlanId: string | null;
}>;

export type StoredEvryActionPlan = Readonly<{
  id: string;
  actorUserId: string;
  plantId: string;
  requestKey: EvryPlanRequestKey;
  intentFingerprint: string;
  fingerprint: string;
  document: unknown;
  createdAt: Date;
  expiresAt: Date;
  supersedesPlanId: string | null;
  status: EvryPlanStatus;
  stateVersion: number;
  stateChangedAt: Date;
}>;

function toStoredPlan(row: {
  plan: typeof evryActionPlans.$inferSelect;
  state: typeof evryActionPlanStates.$inferSelect;
}): StoredEvryActionPlan {
  return {
    id: row.plan.id,
    actorUserId: row.plan.actorUserId,
    plantId: row.plan.churchId,
    requestKey: row.plan.requestKey as EvryPlanRequestKey,
    intentFingerprint: row.plan.intentFingerprint,
    fingerprint: row.plan.fingerprint,
    document: row.plan.document,
    createdAt: row.plan.createdAt,
    expiresAt: row.plan.expiresAt,
    supersedesPlanId: row.plan.supersedesPlanId,
    status: row.state.status,
    stateVersion: row.state.version,
    stateChangedAt: row.state.changedAt,
  };
}

export async function findEvryActionPlanByRequestKey(input: {
  actorUserId: string;
  plantId: string;
  requestKey: EvryPlanRequestKey;
}): Promise<StoredEvryActionPlan | null> {
  const [row] = await db
    .select({ plan: evryActionPlans, state: evryActionPlanStates })
    .from(evryActionPlans)
    .innerJoin(
      evryActionPlanStates,
      eq(evryActionPlanStates.planId, evryActionPlans.id)
    )
    .where(
      and(
        eq(evryActionPlans.actorUserId, input.actorUserId),
        eq(evryActionPlans.churchId, input.plantId),
        eq(evryActionPlans.requestKey, input.requestKey)
      )
    )
    .limit(1);

  return row ? toStoredPlan(row) : null;
}

/** The only writer of a first plan owns its clock and exact expiration. */
export async function createEvryActionPlanRecord(input: {
  actorUserId: string;
  plantId: string;
  requestKey: EvryPlanRequestKey;
  document: EvryActionPlanDocument;
}): Promise<StoredEvryActionPlan> {
  const createdAt = new Date();
  const expiresAt = evryPlanExpiresAt(createdAt);
  const prepared: PreparedEvryActionPlan = {
    ...input,
    intentFingerprint: fingerprintEvryActionPlanIntent(input),
    fingerprint: fingerprintEvryActionPlan({
      ...input,
      expiresAt,
    }),
    createdAt,
    expiresAt,
    supersedesPlanId: null,
  };

  return insertPreparedEvryActionPlan(prepared);
}

/** Persist one internally prepared document and lifecycle row atomically. */
async function insertPreparedEvryActionPlan(
  prepared: PreparedEvryActionPlan
): Promise<StoredEvryActionPlan> {
  const id = randomUUID();

  try {
    const [[plan], [state]] = await db.batch([
      db
        .insert(evryActionPlans)
        .values({
          id,
          actorUserId: prepared.actorUserId,
          churchId: prepared.plantId,
          requestKey: prepared.requestKey,
          intentFingerprint: prepared.intentFingerprint,
          fingerprint: prepared.fingerprint,
          document: prepared.document,
          createdAt: prepared.createdAt,
          expiresAt: prepared.expiresAt,
          supersedesPlanId: prepared.supersedesPlanId,
        })
        .returning(),
      db
        .insert(evryActionPlanStates)
        .values({
          planId: id,
          churchId: prepared.plantId,
          status: "awaiting_confirmation",
          changedAt: prepared.createdAt,
        })
        .returning(),
      db.insert(evryProductAuditEvents).values({
        planId: id,
        churchId: prepared.plantId,
        actorUserId: prepared.actorUserId,
        planFingerprint: prepared.fingerprint,
        correlationId: correlationForPlanRequest(prepared.requestKey),
        eventKey: planEventKey(id, "plan_proposed"),
        eventType: "plan_proposed",
        occurredAt: prepared.createdAt,
      }),
    ]);

    return toStoredPlan({ plan, state });
  } catch (error) {
    if (!isUniqueViolation(error, ACTOR_REQUEST_UNIQUE)) throw error;

    const existing = await findEvryActionPlanByRequestKey(prepared);
    if (
      !existing ||
      existing.intentFingerprint !== prepared.intentFingerprint
    ) {
      throw error;
    }
    return existing;
  }
}

export async function findExactEvryActionPlan(input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
}): Promise<StoredEvryActionPlan | null> {
  const [row] = await db
    .select({ plan: evryActionPlans, state: evryActionPlanStates })
    .from(evryActionPlans)
    .innerJoin(
      evryActionPlanStates,
      eq(evryActionPlanStates.planId, evryActionPlans.id)
    )
    .where(
      and(
        eq(evryActionPlans.id, input.planId),
        eq(evryActionPlans.actorUserId, input.actorUserId),
        eq(evryActionPlans.churchId, input.plantId),
        eq(evryActionPlans.fingerprint, input.fingerprint)
      )
    )
    .limit(1);

  return row ? toStoredPlan(row) : null;
}

interface ConfirmationTransitionRow extends Record<string, unknown> {
  status: "approved" | "expired";
  confirmation_id: string | null;
}

export type ConfirmEvryActionPlanResult =
  | Readonly<{
      status: "approved" | "already_approved";
      confirmationId: string;
    }>
  | Readonly<{ status: "expired" | "not_confirmable" | "unavailable" }>;

export async function confirmExactEvryActionPlan(input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  decidedAt: Date;
}): Promise<ConfirmEvryActionPlanResult> {
  const transition = await db.execute<ConfirmationTransitionRow>(
    confirmEvryActionPlanStatement({
      ...input,
      approvedEventKey: planEventKey(input.planId, "plan_approved"),
      expiredEventKey: planEventKey(input.planId, "plan_expired"),
    })
  );
  const changed = transition.rows[0];

  if (changed?.status === "expired") return { status: "expired" };
  if (changed?.status === "approved" && changed.confirmation_id) {
    return {
      status: "approved",
      confirmationId: changed.confirmation_id,
    };
  }

  // A replay lands here after the winning request commits. Scope and exact
  // fingerprint stay in the read, so this cannot turn a foreign id into an
  // existence oracle.
  const exact = await findExactEvryActionPlan(input);
  if (!exact) return { status: "unavailable" };
  if (exact.status === "expired") return { status: "expired" };

  if (exact.status === "approved") {
    const [confirmation] = await db
      .select({ id: evryPlanConfirmations.id })
      .from(evryPlanConfirmations)
      .where(
        and(
          eq(evryPlanConfirmations.planId, exact.id),
          eq(evryPlanConfirmations.churchId, exact.plantId),
          eq(evryPlanConfirmations.actorUserId, exact.actorUserId),
          eq(evryPlanConfirmations.planFingerprint, exact.fingerprint)
        )
      )
      .limit(1);
    if (confirmation) {
      return {
        status: "already_approved",
        confirmationId: confirmation.id,
      };
    }
  }

  return { status: "not_confirmable" };
}

interface RevisedPlanRow extends Record<string, unknown> {
  id: string;
}

export type ReviseEvryActionPlanResult =
  | Readonly<{
      status: "revised" | "already_revised";
      planId: string;
      fingerprint: string;
    }>
  | Readonly<{ status: "not_revisable" | "unavailable" }>;

export async function reviseExactEvryActionPlan(input: {
  oldPlanId: string;
  oldFingerprint: string;
  actorUserId: string;
  plantId: string;
  requestKey: EvryPlanRequestKey;
  replacementDocument: EvryActionPlanDocument;
}): Promise<ReviseEvryActionPlanResult> {
  const replacementId = randomUUID();
  const createdAt = new Date();
  const expiresAt = evryPlanExpiresAt(createdAt);
  const replacementIntentFingerprint = fingerprintEvryActionPlanIntent({
    actorUserId: input.actorUserId,
    plantId: input.plantId,
    document: input.replacementDocument,
  });
  const replacementFingerprint = fingerprintEvryActionPlan({
    actorUserId: input.actorUserId,
    plantId: input.plantId,
    expiresAt,
    document: input.replacementDocument,
  });

  try {
    const result = await db.execute<RevisedPlanRow>(
      reviseEvryActionPlanStatement({
        ...input,
        replacementId,
        replacementRequestKey: input.requestKey,
        replacementIntentFingerprint,
        replacementFingerprint,
        createdAt,
        expiresAt,
        supersededEventKey: planEventKey(input.oldPlanId, "plan_superseded"),
        proposedEventKey: planEventKey(replacementId, "plan_proposed"),
      })
    );
    if (result.rows[0]) {
      return {
        status: "revised",
        planId: result.rows[0].id,
        fingerprint: replacementFingerprint,
      };
    }
  } catch (error) {
    // Two defences can refuse the same replay: the predecessor's one-successor
    // index and the actor/request retry index. Only those expected races
    // are converted into an idempotent read.
    if (
      !isUniqueViolation(error, "evry_action_plans_supersedes_unique_idx") &&
      !isUniqueViolation(error, ACTOR_REQUEST_UNIQUE)
    ) {
      throw error;
    }
  }

  const successor = await findEvryActionPlanSuccessor(input);

  if (
    successor?.requestKey === input.requestKey &&
    successor.intentFingerprint === replacementIntentFingerprint
  ) {
    return {
      status: "already_revised",
      planId: successor.id,
      fingerprint: successor.fingerprint,
    };
  }

  const predecessor = await findExactEvryActionPlan({
    planId: input.oldPlanId,
    actorUserId: input.actorUserId,
    plantId: input.plantId,
    fingerprint: input.oldFingerprint,
  });
  if (!predecessor) return { status: "unavailable" };
  return { status: "not_revisable" };
}

async function findEvryActionPlanSuccessor(input: {
  oldPlanId: string;
  actorUserId: string;
  plantId: string;
}): Promise<StoredEvryActionPlan | null> {
  const [row] = await db
    .select({ plan: evryActionPlans, state: evryActionPlanStates })
    .from(evryActionPlans)
    .innerJoin(
      evryActionPlanStates,
      eq(evryActionPlanStates.planId, evryActionPlans.id)
    )
    .where(
      and(
        eq(evryActionPlans.supersedesPlanId, input.oldPlanId),
        eq(evryActionPlans.actorUserId, input.actorUserId),
        eq(evryActionPlans.churchId, input.plantId)
      )
    )
    .limit(1);

  return row ? toStoredPlan(row) : null;
}

export async function cancelExactEvryActionPlan(input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
  cancelledAt: Date;
}): Promise<boolean> {
  const cancelled = await db.execute<{ id: string }>(
    cancelEvryActionPlanStatement({
      ...input,
      eventKey: planEventKey(input.planId, "plan_cancelled"),
    })
  );

  if (cancelled.rows[0]) return true;
  const exact = await findExactEvryActionPlan(input);
  return exact?.status === "cancelled";
}
