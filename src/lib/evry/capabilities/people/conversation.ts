import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { eligibleEvryCapabilitiesFor } from "@/lib/evry/eligibility/capabilities";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import {
  continuePeopleEvryRead,
  proposePeopleEvryNote,
  proposePeopleEvryNoteChange,
  selectPeopleEvryRequest,
} from "./runtime";

/** Add one closed People result after shared composition selects this pack. */
export const continuePeopleEvryConversation: EvryCapabilityConversationContinuation =
  {
    identity: "people",
    matches(input) {
      return selectPeopleEvryRequest(input.literalUserText) !== null;
    },
    async continue(input) {
      const selection = selectPeopleEvryRequest(input.literalUserText);
      if (!selection) return null;

      if (
        selection.kind === "list_people" ||
        selection.kind === "list_activity"
      ) {
        const artifact = await continuePeopleEvryRead({
          eligibleCapabilities: eligibleEvryCapabilitiesFor(input.actor),
          literalUserText: input.literalUserText,
          pageContext: input.requestPageContext,
        });
        return artifact?.kind === "read"
          ? {
              body: artifact.title,
              artifacts: [storedEvryReadArtifactDocument(artifact)],
            }
          : null;
      }

      if (input.pageContext?.kind !== "person") {
        const clarification = {
          kind: "clarification" as const,
          mode: "missing" as const,
          entityType: "person",
          prompt:
            "Open the person’s record, keep its page context attached, then send the note request again.",
        };
        return {
          body: clarification.prompt,
          artifacts: [storedEvryClarificationArtifactDocument(clarification)],
        };
      }

      const requestKey = deriveEvryPlanRequestKey(
        `people-${selection.kind.replace("_", "-")}`,
        [
          input.actor.userId,
          input.actor.plantId,
          input.conversation.id,
          input.userRequestKey,
        ]
      );
      const proposal =
        selection.kind === "add_note"
          ? await proposePeopleEvryNote({
              actor: input.actor,
              pageContext: input.pageContext,
              note: selection.note,
              requestKey,
            })
          : await proposePeopleEvryNoteChange({
              actor: input.actor,
              pageContext: input.pageContext,
              selection,
              requestKey,
              now: new Date(),
            });
      if (!proposal) return null;
      return {
        body: "Review this exact note before anything changes.",
        artifacts: [
          parseEvryConversationArtifactDocument(proposal.confirmation),
        ],
        activePlan: { mode: "set", plan: proposal.plan },
      };
    },
  };
