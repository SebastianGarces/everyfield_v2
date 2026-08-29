import { and, desc, eq, exists, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/db";
import {
  churches,
  evryActionPlans,
  evryActionPlanStates,
  evryConversationArtifacts,
  evryConversationMessages,
  evryConversations,
  type EvryConversationArtifactKind,
  type EvryPlanStatus,
} from "@/db/schema";
import {
  DEFAULT_CHURCH_TIME_ZONE,
  formatDateTime,
  formatRelativeTimestamp,
} from "@/lib/datetime";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

export const EVRY_CONVERSATION_HISTORY_LIMIT = 100;

export const evryConversationHistorySearchSchema = z
  .string()
  .max(120)
  .transform((value) => {
    const trimmed = value.trim();
    return trimmed.length === 0 ? null : trimmed;
  });

export type EvryConversationActionableState =
  | "ready"
  | "awaiting_confirmation"
  | "running"
  | "needs_attention"
  | "completed"
  | "rebuild_required";

export type EvryConversationHistoryItem = Readonly<{
  id: string;
  title: string;
  lastActivityAt: string;
  lastActivityLabel: string;
  lastActivityTitle: string;
  actionableState: EvryConversationActionableState;
}>;

type EvryConversationHistoryRecord = Readonly<{
  id: string;
  title: string;
  lastActivityAt: Date;
  timeZone: string;
  activePlanId: string | null;
  activePlanStatus: EvryPlanStatus | null;
  activePlanExpiresAt: Date | null;
  latestMessageSequence: number | null;
  latestArtifactMessageSequence: number | null;
  latestArtifactKind: EvryConversationArtifactKind | null;
}>;

function escapeLikeTerm(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll("%", "\\%")
    .replaceAll("_", "\\_");
}

export function evryConversationActionableState(input: {
  activePlanId: string | null;
  activePlanStatus: EvryPlanStatus | null;
  activePlanExpiresAt: Date | null;
  latestMessageSequence: number | null;
  latestArtifactMessageSequence: number | null;
  latestArtifactKind: EvryConversationArtifactKind | null;
  now: Date;
}): EvryConversationActionableState {
  if (input.activePlanId === null) return "ready";
  if (input.activePlanStatus === null || input.activePlanExpiresAt === null) {
    return "rebuild_required";
  }

  if (
    (input.activePlanStatus === "awaiting_confirmation" ||
      input.activePlanStatus === "approved") &&
    input.activePlanExpiresAt <= input.now
  ) {
    return "rebuild_required";
  }

  const hasLaterPlainTurn =
    input.latestMessageSequence !== null &&
    input.latestArtifactMessageSequence !== null &&
    input.latestMessageSequence > input.latestArtifactMessageSequence;
  const latestArtifactStartsNewWork =
    input.latestArtifactKind === "clarification" ||
    input.latestArtifactKind === "read" ||
    input.latestArtifactKind === "settings_handoff" ||
    input.latestArtifactKind === "boundary";
  const terminalPlanHasLaterWork =
    input.activePlanStatus === "completed" ||
    input.activePlanStatus === "partially_failed" ||
    input.activePlanStatus === "failed" ||
    input.activePlanStatus === "cancelled" ||
    input.activePlanStatus === "superseded" ||
    input.activePlanStatus === "expired";
  if (terminalPlanHasLaterWork) {
    if (hasLaterPlainTurn) return "ready";
    if (latestArtifactStartsNewWork) {
      return input.latestArtifactKind === "clarification"
        ? "needs_attention"
        : "ready";
    }
  }

  switch (input.activePlanStatus) {
    case "draft":
    case "approved":
    case "executing":
      return "running";
    case "awaiting_confirmation":
      return "awaiting_confirmation";
    case "partially_failed":
    case "failed":
      return "needs_attention";
    case "expired":
      return "rebuild_required";
    case "completed":
    case "cancelled":
    case "superseded":
      return "completed";
  }
}

/**
 * Build the one history query. Both the conversation and transcript-search
 * arms carry the authenticated actor and plant, so a forged id or search term
 * cannot widen either side of the read.
 */
export function buildEvryConversationHistoryQuery(input: {
  actorUserId: string;
  plantId: string;
  search: string | null;
}) {
  const pattern =
    input.search === null ? null : `%${escapeLikeTerm(input.search)}%`;
  const transcriptMatch =
    pattern === null
      ? null
      : db
          .select({ present: sql<number>`1` })
          .from(evryConversationMessages)
          .where(
            and(
              eq(evryConversationMessages.conversationId, evryConversations.id),
              eq(evryConversationMessages.actorUserId, input.actorUserId),
              eq(evryConversationMessages.churchId, input.plantId),
              ilike(evryConversationMessages.body, pattern)
            )
          )
          .limit(1);
  const searchCondition =
    pattern === null || transcriptMatch === null
      ? undefined
      : or(ilike(evryConversations.title, pattern), exists(transcriptMatch));
  const latestArtifactMessageSequence = sql<number | null>`(
    select ${evryConversationMessages.sequence}
    from ${evryConversationArtifacts}
    inner join ${evryConversationMessages}
      on ${evryConversationMessages.id} = ${evryConversationArtifacts.messageId}
      and ${evryConversationMessages.conversationId} = ${evryConversations.id}
      and ${evryConversationMessages.actorUserId} = ${evryConversations.actorUserId}
      and ${evryConversationMessages.churchId} = ${evryConversations.churchId}
    where ${evryConversationArtifacts.conversationId} = ${evryConversations.id}
      and ${evryConversationArtifacts.actorUserId} = ${evryConversations.actorUserId}
      and ${evryConversationArtifacts.churchId} = ${evryConversations.churchId}
    order by ${evryConversationMessages.sequence} desc, ${evryConversationArtifacts.ordinal} desc
    limit 1
  )`;
  const latestArtifactKind = sql<EvryConversationArtifactKind | null>`(
    select ${evryConversationArtifacts.kind}
    from ${evryConversationArtifacts}
    inner join ${evryConversationMessages}
      on ${evryConversationMessages.id} = ${evryConversationArtifacts.messageId}
      and ${evryConversationMessages.conversationId} = ${evryConversations.id}
      and ${evryConversationMessages.actorUserId} = ${evryConversations.actorUserId}
      and ${evryConversationMessages.churchId} = ${evryConversations.churchId}
    where ${evryConversationArtifacts.conversationId} = ${evryConversations.id}
      and ${evryConversationArtifacts.actorUserId} = ${evryConversations.actorUserId}
      and ${evryConversationArtifacts.churchId} = ${evryConversations.churchId}
    order by ${evryConversationMessages.sequence} desc, ${evryConversationArtifacts.ordinal} desc
    limit 1
  )`;

  return db
    .select({
      id: evryConversations.id,
      title: evryConversations.title,
      lastActivityAt: evryConversations.lastActivityAt,
      timeZone: churches.timeZone,
      activePlanId: evryConversations.activePlanId,
      activePlanStatus: evryActionPlanStates.status,
      activePlanExpiresAt: evryActionPlans.expiresAt,
      latestMessageSequence: sql<number | null>`case
        when ${evryConversations.nextMessageSequence} = 0 then null
        else ${evryConversations.nextMessageSequence} - 1
      end`,
      latestArtifactMessageSequence,
      latestArtifactKind,
    })
    .from(evryConversations)
    .innerJoin(churches, eq(churches.id, evryConversations.churchId))
    .leftJoin(
      evryActionPlans,
      and(
        eq(evryActionPlans.id, evryConversations.activePlanId),
        eq(evryActionPlans.churchId, evryConversations.churchId),
        eq(evryActionPlans.actorUserId, evryConversations.actorUserId),
        eq(evryActionPlans.fingerprint, evryConversations.activePlanFingerprint)
      )
    )
    .leftJoin(
      evryActionPlanStates,
      and(
        eq(evryActionPlanStates.planId, evryActionPlans.id),
        eq(evryActionPlanStates.churchId, evryConversations.churchId)
      )
    )
    .where(
      and(
        eq(evryConversations.actorUserId, input.actorUserId),
        eq(evryConversations.churchId, input.plantId),
        searchCondition
      )
    )
    .orderBy(desc(evryConversations.lastActivityAt), desc(evryConversations.id))
    .limit(EVRY_CONVERSATION_HISTORY_LIMIT);
}

export async function listEvryConversationHistoryRecords(input: {
  actorUserId: string;
  plantId: string;
  search: string | null;
}): Promise<readonly EvryConversationHistoryRecord[]> {
  return buildEvryConversationHistoryQuery(input);
}

export async function listEvryConversationHistory(input: {
  actor: EvryPlantActor;
  search: string | null;
  now: Date;
  list?: typeof listEvryConversationHistoryRecords;
}): Promise<readonly EvryConversationHistoryItem[]> {
  const records = await (input.list ?? listEvryConversationHistoryRecords)({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    search: input.search,
  });

  return Object.freeze(
    records.map((record) => {
      const timeZone = record.timeZone || DEFAULT_CHURCH_TIME_ZONE;
      return Object.freeze({
        id: record.id,
        title: record.title,
        lastActivityAt: record.lastActivityAt.toISOString(),
        lastActivityLabel: formatRelativeTimestamp(
          record.lastActivityAt,
          input.now,
          timeZone
        ),
        lastActivityTitle: formatDateTime(
          record.lastActivityAt,
          "short",
          timeZone
        ),
        actionableState: evryConversationActionableState({
          activePlanId: record.activePlanId,
          activePlanStatus: record.activePlanStatus,
          activePlanExpiresAt: record.activePlanExpiresAt,
          latestMessageSequence: record.latestMessageSequence,
          latestArtifactMessageSequence: record.latestArtifactMessageSequence,
          latestArtifactKind: record.latestArtifactKind,
          now: input.now,
        }),
      });
    })
  );
}
