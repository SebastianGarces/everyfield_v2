import { and, count, eq, lte, or, sql } from "drizzle-orm";

import { db } from "@/db";
import { evryActiveRuns, type EvryActiveRunStage } from "@/db/schema";

import {
  EVRY_ACTIVE_RUN_TTL_MS,
  EvryActiveRunIdentityError,
  parseEvryActiveRunRecord,
  sameEvryActiveRunIdentity,
  type EvryActiveRunClaim,
  type EvryActiveRunIdentity,
  type EvryActiveRunRecord,
  type EvryActiveRunStoreInput,
} from "./contract";

export async function findEvryActiveRun(
  input: EvryActiveRunStoreInput
): Promise<EvryActiveRunRecord | null> {
  const [row] = await db
    .select()
    .from(evryActiveRuns)
    .where(
      and(
        eq(evryActiveRuns.churchId, input.actor.plantId),
        eq(evryActiveRuns.actorUserId, input.actor.userId),
        eq(evryActiveRuns.requestKey, input.requestKey)
      )
    )
    .limit(1);
  return row ? parseEvryActiveRunRecord(row) : null;
}

export async function countEvryActiveRunsForRequest(
  input: EvryActiveRunStoreInput
): Promise<number> {
  const [row] = await db
    .select({ value: count() })
    .from(evryActiveRuns)
    .where(
      and(
        eq(evryActiveRuns.churchId, input.actor.plantId),
        eq(evryActiveRuns.actorUserId, input.actor.userId),
        eq(evryActiveRuns.requestKey, input.requestKey)
      )
    );
  return row?.value ?? 0;
}

export async function claimEvryActiveRun(input: {
  actor: EvryActiveRunStoreInput["actor"];
  requestKey: string;
  requestFingerprint: string;
  identity: EvryActiveRunIdentity;
  startedAt: Date;
}): Promise<EvryActiveRunClaim> {
  const [inserted] = await db
    .insert(evryActiveRuns)
    .values({
      churchId: input.actor.plantId,
      actorUserId: input.actor.userId,
      requestKey: input.requestKey,
      requestFingerprint: input.requestFingerprint,
      kind: input.identity.kind,
      operation: input.identity.operation,
      status: "active",
      stage: input.identity.kind === "execution" ? "executing" : "accepted",
      version: 0,
      conversationId: input.identity.conversationId,
      planId: input.identity.planId,
      planFingerprint: input.identity.planFingerprint,
      startedAt: input.startedAt,
      changedAt: input.startedAt,
      expiresAt: new Date(input.startedAt.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
      completedAt: null,
    })
    .onConflictDoNothing({
      target: [
        evryActiveRuns.churchId,
        evryActiveRuns.actorUserId,
        evryActiveRuns.requestKey,
      ],
    })
    .returning();
  if (inserted) {
    return {
      ownership: "claimed",
      run: parseEvryActiveRunRecord(inserted),
    };
  }
  const existing = await findEvryActiveRun(input);
  if (
    !existing ||
    !sameEvryActiveRunIdentity(
      existing,
      input.identity,
      input.requestFingerprint
    )
  ) {
    throw new EvryActiveRunIdentityError();
  }
  return { ownership: "adopted", run: existing };
}

export async function advanceEvryActiveRun(input: {
  actor: EvryActiveRunStoreInput["actor"];
  requestKey: string;
  stage: Exclude<EvryActiveRunStage, "accepted" | "executing">;
  changedAt: Date;
}): Promise<EvryActiveRunRecord | null> {
  const [row] = await db
    .update(evryActiveRuns)
    .set({
      stage: input.stage,
      changedAt: input.changedAt,
      version: sql`${evryActiveRuns.version} + 1`,
    })
    .where(
      and(
        eq(evryActiveRuns.churchId, input.actor.plantId),
        eq(evryActiveRuns.actorUserId, input.actor.userId),
        eq(evryActiveRuns.requestKey, input.requestKey),
        eq(evryActiveRuns.kind, "conversation"),
        eq(evryActiveRuns.status, "active")
      )
    )
    .returning();
  return row ? parseEvryActiveRunRecord(row) : null;
}

/**
 * Fence one expired execution owner. The version is the lease epoch: exactly
 * one caller can replace the observed epoch, and the renewed expiry prevents
 * another adopter from entering while that owner reconciles the attempt.
 */
export async function adoptExpiredEvryExecutionRun(input: {
  actor: EvryActiveRunStoreInput["actor"];
  requestKey: string;
  expectedVersion: number;
  adoptedAt: Date;
}): Promise<EvryActiveRunRecord | null> {
  const [row] = await db
    .update(evryActiveRuns)
    .set({
      changedAt: input.adoptedAt,
      expiresAt: new Date(input.adoptedAt.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
      version: sql`${evryActiveRuns.version} + 1`,
    })
    .where(
      and(
        eq(evryActiveRuns.churchId, input.actor.plantId),
        eq(evryActiveRuns.actorUserId, input.actor.userId),
        eq(evryActiveRuns.requestKey, input.requestKey),
        eq(evryActiveRuns.kind, "execution"),
        eq(evryActiveRuns.status, "active"),
        eq(evryActiveRuns.version, input.expectedVersion),
        lte(evryActiveRuns.expiresAt, input.adoptedAt)
      )
    )
    .returning();
  return row ? parseEvryActiveRunRecord(row) : null;
}

export async function completeEvryActiveRun(input: {
  actor: EvryActiveRunStoreInput["actor"];
  requestKey: string;
  conversationId: string;
  completedAt: Date;
  expectedVersion?: number;
}): Promise<EvryActiveRunRecord | null> {
  const [row] = await db
    .update(evryActiveRuns)
    .set({
      status: "completed",
      conversationId: sql`case
        when ${evryActiveRuns.operation} in ('create', 'reuse')
          then coalesce(${evryActiveRuns.conversationId}, ${input.conversationId})
        else ${evryActiveRuns.conversationId}
      end`,
      changedAt: input.completedAt,
      completedAt: input.completedAt,
      version: sql`${evryActiveRuns.version} + 1`,
    })
    .where(
      and(
        eq(evryActiveRuns.churchId, input.actor.plantId),
        eq(evryActiveRuns.actorUserId, input.actor.userId),
        eq(evryActiveRuns.requestKey, input.requestKey),
        eq(evryActiveRuns.status, "active"),
        ...(input.expectedVersion === undefined
          ? []
          : [eq(evryActiveRuns.version, input.expectedVersion)]),
        or(
          eq(evryActiveRuns.operation, "create"),
          eq(evryActiveRuns.operation, "reuse"),
          eq(evryActiveRuns.conversationId, input.conversationId)
        )
      )
    )
    .returning();
  if (row) return parseEvryActiveRunRecord(row);
  return findEvryActiveRun(input);
}

export async function failEvryActiveRun(input: {
  actor: EvryActiveRunStoreInput["actor"];
  requestKey: string;
  conversationId?: string | null;
  failedAt: Date;
  expectedVersion?: number;
}): Promise<EvryActiveRunRecord | null> {
  const [row] = await db
    .update(evryActiveRuns)
    .set({
      status: "failed",
      ...(input.conversationId === undefined
        ? {}
        : {
            conversationId: sql`case
              when ${evryActiveRuns.operation} in ('create', 'reuse')
                then coalesce(${evryActiveRuns.conversationId}, ${input.conversationId})
              else ${evryActiveRuns.conversationId}
            end`,
          }),
      changedAt: input.failedAt,
      completedAt: input.failedAt,
      version: sql`${evryActiveRuns.version} + 1`,
    })
    .where(
      and(
        eq(evryActiveRuns.churchId, input.actor.plantId),
        eq(evryActiveRuns.actorUserId, input.actor.userId),
        eq(evryActiveRuns.requestKey, input.requestKey),
        eq(evryActiveRuns.status, "active"),
        ...(input.expectedVersion === undefined
          ? []
          : [eq(evryActiveRuns.version, input.expectedVersion)])
      )
    )
    .returning();
  if (row) return parseEvryActiveRunRecord(row);
  return findEvryActiveRun(input);
}

/** Make an uncertain execution immediately adoptable without declaring loss. */
export async function releaseEvryExecutionRun(input: {
  actor: EvryActiveRunStoreInput["actor"];
  requestKey: string;
  expectedVersion: number;
  releasedAt: Date;
}): Promise<EvryActiveRunRecord | null> {
  const [row] = await db
    .update(evryActiveRuns)
    .set({
      changedAt: input.releasedAt,
      expiresAt: input.releasedAt,
      version: sql`${evryActiveRuns.version} + 1`,
    })
    .where(
      and(
        eq(evryActiveRuns.churchId, input.actor.plantId),
        eq(evryActiveRuns.actorUserId, input.actor.userId),
        eq(evryActiveRuns.requestKey, input.requestKey),
        eq(evryActiveRuns.kind, "execution"),
        eq(evryActiveRuns.status, "active"),
        eq(evryActiveRuns.version, input.expectedVersion)
      )
    )
    .returning();
  if (row) return parseEvryActiveRunRecord(row);
  return findEvryActiveRun(input);
}

export type EvryActiveRunStore = Readonly<{
  find: typeof findEvryActiveRun;
  countForRequest: typeof countEvryActiveRunsForRequest;
  claim: typeof claimEvryActiveRun;
  advance: typeof advanceEvryActiveRun;
  adoptExpiredExecution: typeof adoptExpiredEvryExecutionRun;
  complete: typeof completeEvryActiveRun;
  fail: typeof failEvryActiveRun;
  releaseExecution: typeof releaseEvryExecutionRun;
}>;

export const evryActiveRunStore: EvryActiveRunStore = Object.freeze({
  find: findEvryActiveRun,
  countForRequest: countEvryActiveRunsForRequest,
  claim: claimEvryActiveRun,
  advance: advanceEvryActiveRun,
  adoptExpiredExecution: adoptExpiredEvryExecutionRun,
  complete: completeEvryActiveRun,
  fail: failEvryActiveRun,
  releaseExecution: releaseEvryExecutionRun,
});
