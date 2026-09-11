import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import { proposeMilestoneEffect, selectMilestoneRequest } from "./milestones";

export const continuePeopleMilestoneConversation: EvryCapabilityConversationContinuation =
  {
    identity: "people-milestone-effects",
    matches(input) {
      return selectMilestoneRequest(input.literalUserText) !== null;
    },
    async continue(input) {
      const selection = selectMilestoneRequest(input.literalUserText);
      if (!selection) return null;
      if (input.pageContext?.kind !== "person") {
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
      const proposal = await proposeMilestoneEffect({
        actor: input.actor,
        pageContext: input.pageContext,
        selection,
        requestKey: deriveEvryPlanRequestKey(`people-${selection.kind}`, [
          input.actor.userId,
          input.actor.plantId,
          input.conversation.id,
          input.userRequestKey,
        ]),
      });
      return proposal
        ? {
            body: "Review this exact People milestone before anything is saved.",
            artifacts: [
              parseEvryConversationArtifactDocument(proposal.confirmation),
            ],
            activePlan: { mode: "set", plan: proposal.plan },
          }
        : null;
    },
  };
