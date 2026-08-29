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
  trustRunConversation: boolean;
  now: Date;
  boundaries: EvryRunRecoveryBoundaries;
}): Promise<EvryResumedConversation | null> {
  if (input.trustRunConversation && input.conversationId) {
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
    if (
      run.kind === "execution" &&
      (run.operation === "execute" || run.operation === "retry") &&
      run.stage === "executing" &&
      run.conversationId
    ) {
      return {
        status: "active",
        requestId: requestKey,
        kind: "execution",
        operation: run.operation,
        sequence: run.version,
        stage: "executing",
        conversationId: run.conversationId,
        expiresAt: run.expiresAt.toISOString(),
      };
    }
    if (
      run.kind === "conversation" &&
      run.operation === "continue" &&
      run.stage !== "executing" &&
      run.conversationId
    ) {
      return {
        status: "active",
        requestId: requestKey,
        kind: "conversation",
        operation: "continue",
        sequence: run.version,
        stage: run.stage,
        conversationId: run.conversationId,
        expiresAt: run.expiresAt.toISOString(),
      };
    }
    if (
      run.kind === "conversation" &&
      run.operation === "create" &&
      run.stage !== "executing" &&
      run.conversationId === null
    ) {
      return {
        status: "active",
        requestId: requestKey,
        kind: "conversation",
        operation: "create",
        sequence: run.version,
        stage: run.stage,
        conversationId: null,
        expiresAt: run.expiresAt.toISOString(),
      };
    }
    throw new Error("Evry active run had an invalid wire identity");
  }

  if (
    run?.status === "active" &&
    input.now >= run.expiresAt &&
    run.kind === "execution"
  ) {
    if (
      (run.operation !== "execute" && run.operation !== "retry") ||
      !run.conversationId
    ) {
      throw new Error("Evry execution run had an invalid wire identity");
    }
    return {
      status: "resumable",
      requestId: requestKey,
      kind: "execution",
      operation: run.operation,
      sequence: run.version,
      conversationId: run.conversationId,
    };
  }

  const resumed = await durableConversation({
    actor: input.actor,
    requestKey,
    conversationId: run?.conversationId ?? null,
    trustRunConversation: run?.status === "completed",
    now: input.now,
    boundaries,
  });
  if (resumed) {
    if (!run) {
      return {
        status: "durable",
        requestId: requestKey,
        kind: "conversation",
        sequence: 1,
        conversation: publicEvryConversation(resumed),
      };
    }
    if (
      run.kind === "execution" &&
      (run.operation === "execute" || run.operation === "retry")
    ) {
      return {
        status: "durable",
        requestId: requestKey,
        kind: "execution",
        sequence: run.version + 1,
        conversation: publicEvryConversation(resumed),
      };
    }
    if (
      run.kind !== "conversation" ||
      (run.operation !== "create" && run.operation !== "continue")
    ) {
      throw new Error("Evry durable run had an invalid wire identity");
    }
    return {
      status: "durable",
      requestId: requestKey,
      kind: "conversation",
      sequence: run.version + 1,
      conversation: publicEvryConversation(resumed),
    };
  }
  if (
    run?.status === "active" &&
    input.now >= run.expiresAt &&
    run.kind === "conversation"
  ) {
    if (run.operation !== "create" && run.operation !== "continue") {
      throw new Error("Evry expired run had an invalid wire identity");
    }
    return {
      status: "expired",
      requestId: requestKey,
      kind: "conversation",
      operation: run.operation,
      sequence: run.version + 1,
      conversationId: run.conversationId,
    };
  }
  return { status: "unavailable", requestId: requestKey };
}
