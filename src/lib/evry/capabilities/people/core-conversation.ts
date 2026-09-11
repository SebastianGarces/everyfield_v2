import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import { proposePeopleCoreEffect, selectPeopleCoreRequest } from "./core";

const CONTEXT_FREE = new Set(["create", "quick_add", "reorder"]);

export const continuePeopleCoreConversation: EvryCapabilityConversationContinuation =
  {
    identity: "people-core-effects",
    matches(input) {
      return selectPeopleCoreRequest(input.literalUserText) !== null;
    },
    async continue(input) {
      const selection = selectPeopleCoreRequest(input.literalUserText);
      if (!selection) return null;
      if (
        !CONTEXT_FREE.has(selection.kind) &&
        input.pageContext?.kind !== "person"
      ) {
        const clarification = {
          kind: "clarification" as const,
          mode: "missing" as const,
          entityType: "person",
          prompt: "Open the person’s record and send this request again.",
        };
        return {
          body: clarification.prompt,
          artifacts: [storedEvryClarificationArtifactDocument(clarification)],
        };
      }
      const proposal = await proposePeopleCoreEffect({
        actor: input.actor,
        pageContext: input.pageContext,
        selection,
        requestKey: deriveEvryPlanRequestKey(
          `people-${selection.kind.replaceAll("_", "-")}`,
          [
            input.actor.userId,
            input.actor.plantId,
            input.conversation.id,
            input.userRequestKey,
          ]
        ),
      });
      return proposal
        ? {
            body: "Review this exact People change before anything is saved.",
            artifacts: [
              parseEvryConversationArtifactDocument(proposal.confirmation),
            ],
            activePlan: { mode: "set", plan: proposal.plan },
          }
        : null;
    },
  };
