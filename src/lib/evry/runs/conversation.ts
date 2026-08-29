import type { PublicEvryConversation } from "@/lib/evry/conversations/public-contract";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryConversationStreamStage } from "@/lib/evry/streaming/conversation-wire";

import {
  fingerprintEvryActiveRunRequest,
  type EvryActiveRunClaim,
  type EvryActiveRunIdentity,
} from "./contract";
import { evryActiveRunStore, type EvryActiveRunStore } from "./repository";
import { recoverEvryActiveRun } from "./service";

export type EvryConversationRunInput = Readonly<{
  actor: EvryPlantActor;
  requestKey: string;
  identity: Extract<EvryActiveRunIdentity, { kind: "conversation" }>;
  fingerprintInput: unknown;
  startedAt: Date;
  perform(
    report: (stage: EvryConversationStreamStage) => Promise<void>
  ): Promise<Readonly<{ conversation: PublicEvryConversation }> | null>;
}>;

export type PreparedEvryConversationRun = Readonly<{
  input: EvryConversationRunInput;
  claim: EvryActiveRunClaim;
}>;

export type EvryConversationRunResult =
  | Readonly<{ conversation: PublicEvryConversation }>
  | Readonly<{ status: "active" }>
  | null;

type EvryConversationRunBoundaries = Readonly<{
  runs: Pick<EvryActiveRunStore, "claim" | "advance" | "complete" | "fail">;
  recover: typeof recoverEvryActiveRun;
  now(): Date;
}>;

const productionBoundaries: EvryConversationRunBoundaries = Object.freeze({
  runs: evryActiveRunStore,
  recover: recoverEvryActiveRun,
  now: () => new Date(),
});

export async function prepareEvryConversationActiveRun(
  input: EvryConversationRunInput,
  boundaries: EvryConversationRunBoundaries = productionBoundaries
): Promise<PreparedEvryConversationRun> {
  const claim = await boundaries.runs.claim({
    actor: input.actor,
    requestKey: input.requestKey,
    requestFingerprint: fingerprintEvryActiveRunRequest(input.fingerprintInput),
    identity: input.identity,
    startedAt: input.startedAt,
  });
  return Object.freeze({ input, claim });
}

/** Persist each stage before presentation, and settle before durable output. */
export async function runPreparedEvryConversationActiveRun(
  prepared: PreparedEvryConversationRun,
  report: (stage: EvryConversationStreamStage) => void,
  boundaries: EvryConversationRunBoundaries = productionBoundaries
): Promise<EvryConversationRunResult> {
  const { claim, input } = prepared;
  if (claim.ownership === "adopted") {
    const recovered = await boundaries.recover({
      actor: input.actor,
      requestKey: input.requestKey,
      now: boundaries.now(),
    });
    if (recovered.status === "durable") {
      return { conversation: recovered.conversation };
    }
    return recovered.status === "active" ? { status: "active" } : null;
  }

  let durableConversationId: string | null = null;
  try {
    const result = await input.perform(async (stage) => {
      const advanced = await boundaries.runs.advance({
        actor: input.actor,
        requestKey: input.requestKey,
        stage,
        changedAt: boundaries.now(),
      });
      if (!advanced) throw new Error("Evry active run could not advance");
      report(stage);
    });
    if (!result) {
      await boundaries.runs.fail({
        actor: input.actor,
        requestKey: input.requestKey,
        failedAt: boundaries.now(),
      });
      return null;
    }
    durableConversationId = result.conversation.id;
    const completed = await boundaries.runs.complete({
      actor: input.actor,
      requestKey: input.requestKey,
      conversationId: durableConversationId,
      completedAt: boundaries.now(),
    });
    if (!completed || completed.status !== "completed") {
      throw new Error("Evry active run did not durably complete");
    }
    return result;
  } catch (error) {
    await boundaries.runs
      .fail({
        actor: input.actor,
        requestKey: input.requestKey,
        conversationId: durableConversationId,
        failedAt: boundaries.now(),
      })
      .catch(() => null);
    throw error;
  }
}

export type EvryConversationActiveRunCoordinator = Readonly<{
  prepare: typeof prepareEvryConversationActiveRun;
  run: typeof runPreparedEvryConversationActiveRun;
}>;

export const evryConversationActiveRunCoordinator: EvryConversationActiveRunCoordinator =
  Object.freeze({
    prepare: prepareEvryConversationActiveRun,
    run: runPreparedEvryConversationActiveRun,
  });
