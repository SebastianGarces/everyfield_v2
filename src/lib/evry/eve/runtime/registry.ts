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
import { fixtureRun } from "./fixture-bridge";
import { eveAttachments } from "./attachments";
import type { EveAttachmentResolver } from "./attachment-contract";
import { preparationModelOutput } from "./preparation-output";
import { createEveActionStatusReader } from "./action-status";
import {
  describeHistoryContinuation,
  historyContinuationModelOutput,
} from "./history-continuation";

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
    readActionStatus: async () => {
      throw new Error("Discovery cannot read a conversation review");
    },
    preparation: {
      inputSchema: evePreparationInputSchema,
      prepare: async () => {
        throw new Error("Discovery cannot prepare actions");
      },
    },
  })
    .describe()
    .map(describeHistoryContinuation);
}

export function createBoundEveRegistry(
  scope: EveRuntimeScope,
  options: { singlePreparation?: true } = {}
): EveToolRegistry {
  let preparations = 0;
  const turn = evryTurnInput.get();
  const fixture = fixtureRun({
    ...scope.actor,
    appSessionId: scope.appSessionId,
  });
  const authorizeRead = async (name: string) => {
    const result = await authorizeEvryReadCapabilityForSession(
      name,
      scope.appSessionId
    );
    fixture?.authorize(Boolean(result));
    return result;
  };
  const context = {
    actor: scope.actor,
    literalUserText: turn.text,
    pageContext: turn.pageContext,
    now: fixture?.now ?? new Date(),
  };
  const resolveAttachment: EveAttachmentResolver = (id, kind) =>
    eveAttachments.resolve(
      { ...scope.actor, sessionId: scope.eveSessionId },
      id,
      kind
    );
  const registry = createEveToolRegistry({
    context,
    authorizeRead,
    resolveAttachment,
    readActionStatus: createEveActionStatusReader(scope, undefined, (allowed) =>
      fixture?.authorize(allowed)
    ),
    preparation: createEvePreparation({
      ...context,
      conversationId: scope.conversationId,
      userRequestKey: createHash("sha256")
        .update(`${scope.eveSessionId}:${scope.turnId}`)
        .digest("hex"),
      authorizeRead,
      resolveAttachment,
    }),
  });
  return {
    describe: () => registry.describe().map(describeHistoryContinuation),
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
        fixture?.call({ id: reference, name, input, output: result });
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
        if (name === "actions.prepare") {
          const modelOutput = preparationModelOutput(result);
          if (modelOutput !== result) return modelOutput;
        }
        if (name === "people.history.query") {
          const modelOutput = historyContinuationModelOutput(input, result);
          if (
            modelOutput &&
            typeof modelOutput === "object" &&
            !Array.isArray(modelOutput) &&
            modelOutput !== result
          )
            return { ...modelOutput, resultReference: reference };
        }
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
