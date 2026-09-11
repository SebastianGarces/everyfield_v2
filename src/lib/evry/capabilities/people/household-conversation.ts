import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import { proposeHouseholdEffect, selectHouseholdRequest } from "./households";

const PERSON_REQUIRED = new Set(["create", "add", "remove"]);

export const continuePeopleHouseholdConversation: EvryCapabilityConversationContinuation =
  {
    identity: "people-household-effects",
    matches(input) {
      return selectHouseholdRequest(input.literalUserText) !== null;
    },
    async continue(input) {
      const selection = selectHouseholdRequest(input.literalUserText);
      if (!selection) return null;
      if (
        PERSON_REQUIRED.has(selection.kind) &&
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
      const proposal = await proposeHouseholdEffect({
        actor: input.actor,
        pageContext: input.pageContext,
        selection,
        requestKey: deriveEvryPlanRequestKey(
          `people-household-${selection.kind}`,
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
            body: "Review this exact household change before anything is saved.",
            artifacts: [
              parseEvryConversationArtifactDocument(proposal.confirmation),
            ],
            activePlan: { mode: "set", plan: proposal.plan },
          }
        : null;
    },
  };
