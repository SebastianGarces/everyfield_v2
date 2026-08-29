import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { eligibleEvryCapabilitiesFor } from "@/lib/evry/eligibility/capabilities";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import {
  proposeCommunicationEvryMessageEffect,
  selectCommunicationEvryMessageEffect,
} from "./messages";
import {
  continueCommunicationEvryRead,
  selectCommunicationEvryRead,
} from "./reads";
import {
  proposeCommunicationEvryTemplateEffect,
  selectCommunicationEvryTemplateEffect,
} from "./templates";

/** One closed Communication continuation: deterministic reads or reviewed effects. */
export const continueCommunicationEvryConversation: EvryCapabilityConversationContinuation =
  {
    identity: "communication",
    matches(input) {
      return Boolean(
        selectCommunicationEvryRead(input.literalUserText) ??
        selectCommunicationEvryTemplateEffect(input.literalUserText) ??
        selectCommunicationEvryMessageEffect(input.literalUserText)
      );
    },
    async continue(input) {
      const readSelection = selectCommunicationEvryRead(input.literalUserText);
      if (readSelection) {
        const artifact = await continueCommunicationEvryRead({
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

      const templateSelection = selectCommunicationEvryTemplateEffect(
        input.literalUserText
      );
      const messageSelection = selectCommunicationEvryMessageEffect(
        input.literalUserText
      );
      if (!templateSelection && !messageSelection) return null;
      if (
        messageSelection?.kind === "send" &&
        messageSelection.recipientIds === null &&
        input.pageContext?.kind !== "person"
      ) {
        const clarification = {
          kind: "clarification" as const,
          mode: "missing" as const,
          entityType: "person",
          prompt:
            "Open the person’s record, keep its page context attached, then send the email request again.",
        };
        return {
          body: clarification.prompt,
          artifacts: [storedEvryClarificationArtifactDocument(clarification)],
        };
      }

      const selectionKind = templateSelection
        ? templateSelection.kind
        : messageSelection!.kind;
      const requestKey = deriveEvryPlanRequestKey(
        `communication-${selectionKind.replaceAll("_", "-")}`,
        [
          input.actor.userId,
          input.actor.plantId,
          input.conversation.id,
          input.userRequestKey,
        ]
      );
      const proposal = templateSelection
        ? await proposeCommunicationEvryTemplateEffect({
            actor: input.actor,
            selection: templateSelection,
            requestKey,
          })
        : await proposeCommunicationEvryMessageEffect({
            actor: input.actor,
            pageContext: input.pageContext,
            selection: messageSelection!,
            requestKey,
            now: new Date(),
          });
      return proposal
        ? {
            body: "Review this exact Communication change before anything is saved or sent.",
            artifacts: [
              parseEvryConversationArtifactDocument(proposal.confirmation),
            ],
            activePlan: { mode: "set", plan: proposal.plan },
          }
        : null;
    },
  };
