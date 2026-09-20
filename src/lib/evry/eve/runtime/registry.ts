import { createHash } from "node:crypto";
import { authorizeEvryReadCapabilityForSession } from "@/lib/evry/eligibility/capabilities";
import {
  createEveToolRegistry,
  type EveToolRegistry,
} from "../capabilities/registry";
import {
  createEvePreparation,
  evePreparationInputSchema,
} from "../preparation";
import { evryTurnInput } from "./task-state";
import { collectResult, evryResultState } from "./results";
import type { EveRuntimeScope } from "./scope";
import type { EveAuthenticatedSession } from "./auth-policy";
import {
  evryReviewState,
  retirePreviousReview,
  reviewFromPreparation,
} from "./review-state";

export function describeEveRuntimeTools(identity: EveAuthenticatedSession) {
  return createEveToolRegistry({
    context: {
      actor: identity,
      literalUserText: "",
      pageContext: null,
      now: new Date(),
    },
    authorizeRead: (name) =>
      authorizeEvryReadCapabilityForSession(name, identity.appSessionId),
    preparation: {
      inputSchema: evePreparationInputSchema,
      prepare: async () => {
        throw new Error("Discovery cannot prepare actions");
      },
    },
  }).describe();
}

export function createBoundEveRegistry(
  scope: EveRuntimeScope
): EveToolRegistry {
  const turn = evryTurnInput.get();
  const authorizeRead = (name: string) =>
    authorizeEvryReadCapabilityForSession(name, scope.appSessionId);
  const context = {
    actor: scope.actor,
    literalUserText: turn.text,
    pageContext: null,
    now: new Date(),
  };
  const registry = createEveToolRegistry({
    context,
    authorizeRead,
    preparation: createEvePreparation({
      ...context,
      conversationId: scope.conversationId,
      userRequestKey: createHash("sha256")
        .update(`${scope.eveSessionId}:${scope.turnId}`)
        .digest("hex"),
      authorizeRead,
    }),
  });
  return {
    describe: registry.describe,
    async invoke(name, input, invocation) {
      if (
        name === "actions.prepare" &&
        invocation?.callId &&
        !(await retirePreviousReview(scope, invocation.callId))
      ) {
        return {
          status: "unavailable",
          reason: "previous_review_busy",
          message:
            "The previous action is still running. Wait for its result before changing it.",
        };
      }
      const result = await registry.invoke(name, input, invocation);
      const reference = invocation?.callId;
      if (!reference) return result;
      if (name === "actions.prepare") {
        const review = reviewFromPreparation(result, reference);
        if (review) evryReviewState.update(() => review);
      }
      evryResultState.update((records) =>
        collectResult(
          records,
          { reference, turnId: scope.turnId, capability: name },
          result
        )
      );
      if (
        result &&
        typeof result === "object" &&
        !Array.isArray(result) &&
        (result.kind === "read" ||
          result.kind === "clarification" ||
          (name === "actions.prepare" && Array.isArray(result.artifacts)))
      )
        return { ...result, resultReference: reference };
      return result;
    },
  };
}
