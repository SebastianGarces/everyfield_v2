import { runEvryProductionArtifactLifecycle } from "@/lib/evry/artifacts/production-lifecycle";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";

import { evryActiveRunStore, type EvryActiveRunStore } from "./repository";
import {
  recoverEvryActiveRun,
  type EvryRunRecoveryBoundaries,
} from "./service";
import type { EvryRunRecoveryResponse } from "./wire";

type ResumeBoundaries = Readonly<{
  runs: EvryActiveRunStore;
  resumeExecution: typeof runEvryProductionArtifactLifecycle;
  recover: typeof recoverEvryActiveRun;
  recoveryBoundaries?: EvryRunRecoveryBoundaries;
}>;

const productionBoundaries: ResumeBoundaries = Object.freeze({
  runs: evryActiveRunStore,
  resumeExecution: runEvryProductionArtifactLifecycle,
  recover: recoverEvryActiveRun,
});

/**
 * Explicitly resume only an expired execution claim. The original request key
 * and exact plan tuple come from trusted durable metadata. Recovery GET stays
 * read-only; this authenticated POST is the only adoption command.
 */
export async function resumeEvryActiveRun(input: {
  actor: EvryPlantActor;
  requestKey: string;
  now: Date;
  boundaries?: ResumeBoundaries;
}): Promise<EvryRunRecoveryResponse> {
  const boundaries = input.boundaries ?? productionBoundaries;
  const run = await boundaries.runs.find({
    actor: input.actor,
    requestKey: input.requestKey,
  });
  if (
    !run ||
    run.status !== "active" ||
    run.kind !== "execution" ||
    (run.operation !== "execute" && run.operation !== "retry") ||
    !run.conversationId ||
    !run.planId ||
    !run.planFingerprint ||
    input.now < run.expiresAt
  ) {
    return boundaries.recover({
      actor: input.actor,
      requestKey: input.requestKey,
      now: input.now,
      boundaries: boundaries.recoveryBoundaries,
    });
  }
  try {
    const result = await boundaries.resumeExecution({
      actor: input.actor,
      conversationId: run.conversationId,
      request: {
        action: run.operation,
        requestKey: run.requestKey,
        plan: evryConversationPlanIdentitySchema.parse({
          planId: run.planId,
          fingerprint: run.planFingerprint,
        }),
      },
    });
    if (result.status === "unavailable") {
      await boundaries.runs.fail({
        actor: input.actor,
        requestKey: run.requestKey,
        conversationId: run.conversationId,
        failedAt: input.now,
      });
    } else {
      await boundaries.runs.complete({
        actor: input.actor,
        requestKey: run.requestKey,
        conversationId: result.resumed.conversation.id,
        completedAt: input.now,
      });
    }
  } catch {
    await boundaries.runs.fail({
      actor: input.actor,
      requestKey: run.requestKey,
      conversationId: run.conversationId,
      failedAt: input.now,
    });
  }
  return boundaries.recover({
    actor: input.actor,
    requestKey: run.requestKey,
    now: input.now,
    boundaries: boundaries.recoveryBoundaries,
  });
}
