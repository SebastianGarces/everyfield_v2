import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  evryConversationRequestKeySchema,
  type EvryConversationRequestKey,
} from "@/lib/evry/conversations/contract";
import { publicEvryConversation } from "@/lib/evry/conversations/public";
import {
  findEvryConversationRecordByRequestKey,
  type EvryStoredConversation,
} from "@/lib/evry/conversations/repository";
import {
  resumeEvryConversation,
  type EvryResumedConversation,
} from "@/lib/evry/conversations/service";

import { evryActiveRunStore, type EvryActiveRunStore } from "./repository";
import type { EvryRunRecoveryResponse } from "./wire";

export type EvryRunRecoveryBoundaries = Readonly<{
  runs: Pick<EvryActiveRunStore, "find">;
  resume(input: {
    actor: EvryPlantActor;
    conversationId: string;
    now: Date;
  }): Promise<EvryResumedConversation | null>;
  findConversationByRequest(input: {
    actorUserId: string;
    plantId: string;
    requestKey: EvryConversationRequestKey;
  }): Promise<EvryStoredConversation | null>;
}>;

const productionBoundaries: EvryRunRecoveryBoundaries = Object.freeze({
  runs: evryActiveRunStore,
  resume: resumeEvryConversation,
  findConversationByRequest: findEvryConversationRecordByRequestKey,
});

async function durableConversation(input: {
  actor: EvryPlantActor;
  requestKey: EvryConversationRequestKey;
  conversationId: string | null;
  now: Date;
  boundaries: EvryRunRecoveryBoundaries;
}): Promise<EvryResumedConversation | null> {
  if (input.conversationId) {
    const resumed = await input.boundaries.resume({
      actor: input.actor,
      conversationId: input.conversationId,
      now: input.now,
    });
    if (resumed) return resumed;
  }
  const conversation = await input.boundaries.findConversationByRequest({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey: input.requestKey,
  });
  if (!conversation) return null;
  return input.boundaries.resume({
    actor: input.actor,
    conversationId: conversation.id,
    now: input.now,
  });
}

/**
 * Read one reconnect snapshot. It never starts a model or effect. Missing,
 * failed, and expired rows reconcile against durable conversation state once,
 * then terminate instead of leaving the client in an infinite loading state.
 */
export async function recoverEvryActiveRun(input: {
  actor: EvryPlantActor;
  requestKey: string;
  now: Date;
  boundaries?: EvryRunRecoveryBoundaries;
}): Promise<EvryRunRecoveryResponse> {
  const requestKey = evryConversationRequestKeySchema.parse(input.requestKey);
  const boundaries = input.boundaries ?? productionBoundaries;
  const run = await boundaries.runs.find({
    actor: input.actor,
    requestKey,
  });
  if (run?.status === "active" && input.now < run.expiresAt) {
    return {
      status: "active",
      requestId: requestKey,
      kind: run.kind,
      sequence: run.version,
      stage: run.stage,
      conversationId: run.conversationId,
      expiresAt: run.expiresAt.toISOString(),
    };
  }

  if (
    run?.status === "active" &&
    input.now >= run.expiresAt &&
    run.kind === "execution"
  ) {
    return {
      status: "resumable",
      requestId: requestKey,
      kind: "execution",
    };
  }

  const resumed = await durableConversation({
    actor: input.actor,
    requestKey,
    conversationId: run?.conversationId ?? null,
    now: input.now,
    boundaries,
  });
  if (resumed) {
    return {
      status: "durable",
      requestId: requestKey,
      kind: run?.kind ?? "conversation",
      sequence: (run?.version ?? 0) + 1,
      conversation: publicEvryConversation(resumed),
    };
  }
  return {
    status:
      run?.status === "active" && input.now >= run.expiresAt
        ? "expired"
        : "unavailable",
    requestId: requestKey,
  };
}
