import { and, eq, or, sql } from "drizzle-orm";

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

export async function completeEvryActiveRun(input: {
  actor: EvryActiveRunStoreInput["actor"];
  requestKey: string;
  conversationId: string;
  completedAt: Date;
}): Promise<EvryActiveRunRecord | null> {
  const [row] = await db
    .update(evryActiveRuns)
    .set({
      status: "completed",
      conversationId: sql`case
        when ${evryActiveRuns.operation} = 'create'
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
        or(
          eq(evryActiveRuns.operation, "create"),
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
}): Promise<EvryActiveRunRecord | null> {
  const [row] = await db
    .update(evryActiveRuns)
    .set({
      status: "failed",
      ...(input.conversationId === undefined
        ? {}
        : {
            conversationId: sql`case
              when ${evryActiveRuns.operation} = 'create'
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
        eq(evryActiveRuns.status, "active")
      )
    )
    .returning();
  if (row) return parseEvryActiveRunRecord(row);
  return findEvryActiveRun(input);
}

export type EvryActiveRunStore = Readonly<{
  find: typeof findEvryActiveRun;
  claim: typeof claimEvryActiveRun;
  advance: typeof advanceEvryActiveRun;
  complete: typeof completeEvryActiveRun;
  fail: typeof failEvryActiveRun;
}>;

export const evryActiveRunStore: EvryActiveRunStore = Object.freeze({
  find: findEvryActiveRun,
  claim: claimEvryActiveRun,
  advance: advanceEvryActiveRun,
  complete: completeEvryActiveRun,
  fail: failEvryActiveRun,
});
