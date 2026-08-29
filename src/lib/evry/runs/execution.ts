import type {
  EvryArtifactLifecycleResult,
  EvryArtifactLifecycleRequest,
} from "@/lib/evry/artifacts/lifecycle";
import type { RunEvryProductionArtifactLifecycle } from "@/lib/evry/artifacts/production-lifecycle";
import type { PublicEvryConversation } from "@/lib/evry/conversations/public-contract";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import {
  fingerprintEvryActiveRunRequest,
  type EvryActiveRunClaim,
  type EvryActiveRunIdentity,
} from "./contract";
import { evryActiveRunStore, type EvryActiveRunStore } from "./repository";
import { recoverEvryActiveRun } from "./service";

export type EvryExecutionRunInput = Readonly<{
  actor: EvryPlantActor;
  conversationId: string;
  request: EvryArtifactLifecycleRequest & {
    action: "execute" | "retry";
  };
  startedAt: Date;
  perform: RunEvryProductionArtifactLifecycle;
}>;

export type PreparedEvryExecutionRun = Readonly<{
  input: EvryExecutionRunInput;
  claim: EvryActiveRunClaim;
}>;

type ExecutionRunBoundaries = Readonly<{
  runs: Pick<
    EvryActiveRunStore,
    "claim" | "complete" | "fail" | "releaseExecution"
  >;
  recover: typeof recoverEvryActiveRun;
  now(): Date;
}>;

const productionBoundaries: ExecutionRunBoundaries = Object.freeze({
  runs: evryActiveRunStore,
  recover: recoverEvryActiveRun,
  now: () => new Date(),
});

function identityFor(
  input: EvryExecutionRunInput
): Extract<EvryActiveRunIdentity, { kind: "execution" }> {
  return {
    kind: "execution",
    operation: input.request.action,
    conversationId: input.conversationId,
    planId: input.request.plan.planId,
    planFingerprint: input.request.plan.fingerprint,
  };
}

export async function prepareEvryExecutionActiveRun(
  input: EvryExecutionRunInput,
  boundaries: ExecutionRunBoundaries = productionBoundaries
): Promise<PreparedEvryExecutionRun> {
  const claim = await boundaries.runs.claim({
    actor: input.actor,
    requestKey: input.request.requestKey,
    requestFingerprint: fingerprintEvryActiveRunRequest({
      version: 1,
      action: input.request.action,
      conversationId: input.conversationId,
      plan: input.request.plan,
    }),
    identity: identityFor(input),
    startedAt: input.startedAt,
  });
  return Object.freeze({ input, claim });
}

export type EvryExecutionRunResult =
  | Readonly<{ status: "active" }>
  | Readonly<{
      status: "durable";
      conversation: PublicEvryConversation;
    }>
  | Readonly<{
      status: "lifecycle";
      result: EvryArtifactLifecycleResult;
    }>;

export async function runPreparedEvryExecutionActiveRun(
  prepared: PreparedEvryExecutionRun,
  boundaries: ExecutionRunBoundaries = productionBoundaries
): Promise<EvryExecutionRunResult> {
  const { claim, input } = prepared;
  if (claim.ownership === "adopted") {
    const recovered = await boundaries.recover({
      actor: input.actor,
      requestKey: input.request.requestKey,
      now: boundaries.now(),
    });
    if (recovered.status === "durable") {
      return {
        status: "durable",
        conversation: recovered.conversation,
      };
    }
    return { status: "active" };
  }

  try {
    const result = await input.perform({
      actor: input.actor,
      conversationId: input.conversationId,
      request: input.request,
    });
    if (result.status === "unavailable") {
      const failed = await boundaries.runs.fail({
        actor: input.actor,
        requestKey: input.request.requestKey,
        conversationId: input.conversationId,
        failedAt: boundaries.now(),
        expectedVersion: claim.run.version,
      });
      if (failed?.status !== "failed") return { status: "active" };
      return { status: "lifecycle", result };
    }
    const completed = await boundaries.runs.complete({
      actor: input.actor,
      requestKey: input.request.requestKey,
      conversationId: result.resumed.conversation.id,
      completedAt: boundaries.now(),
      expectedVersion: claim.run.version,
    });
    if (completed?.status !== "completed") return { status: "active" };
    return { status: "lifecycle", result };
  } catch (error) {
    await boundaries.runs
      .releaseExecution({
        actor: input.actor,
        requestKey: input.request.requestKey,
        expectedVersion: claim.run.version,
        releasedAt: boundaries.now(),
      })
      .catch(() => null);
    throw error;
  }
}

export type EvryExecutionActiveRunCoordinator = Readonly<{
  prepare: typeof prepareEvryExecutionActiveRun;
  run: typeof runPreparedEvryExecutionActiveRun;
}>;

export const evryExecutionActiveRunCoordinator: EvryExecutionActiveRunCoordinator =
  Object.freeze({
    prepare: prepareEvryExecutionActiveRun,
    run: runPreparedEvryExecutionActiveRun,
  });
