import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import { proposeTaxonomyEffect, selectTaxonomyRequest } from "./taxonomies";

const PERSON_REQUIRED = new Set([
  "assign_tag",
  "remove_tag",
  "add_skill",
  "update_skill",
  "remove_skill",
]);

export const continuePeopleTaxonomyConversation: EvryCapabilityConversationContinuation =
  {
    identity: "people-tags-skills",
    matches(input) {
      return selectTaxonomyRequest(input.literalUserText) !== null;
    },
    async continue(input) {
      const selection = selectTaxonomyRequest(input.literalUserText);
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
      const proposal = await proposeTaxonomyEffect({
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
