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
import { withPreparationGate } from "./preparation-gate";

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
  scope: EveRuntimeScope,
  options: { singlePreparation?: true } = {}
): EveToolRegistry {
  let preparations = 0;
  const turn = evryTurnInput.get();
  const authorizeRead = (name: string) =>
    authorizeEvryReadCapabilityForSession(name, scope.appSessionId);
  const context = {
    actor: scope.actor,
    literalUserText: turn.text,
    pageContext: turn.pageContext,
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
      const validPreparation =
        name === "actions.prepare" &&
        evePreparationInputSchema.safeParse(input).success;
      if (validPreparation && options.singlePreparation && preparations++ > 0)
        return { status: "unavailable", reason: "one_review_per_program" };
      const perform = async () => {
        if (
          validPreparation &&
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
      };
      if (validPreparation && invocation?.callId) {
        return withPreparationGate(
          { turnId: scope.turnId, callId: invocation.callId },
          perform
        );
      }
      return perform();
    },
  };
}
