import {
  storedEvryClarificationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { eligibleEvryCapabilitiesFor } from "@/lib/evry/eligibility/capabilities";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import { continuePeopleDomainRead, selectPeopleRead } from "./reads";

const PERSON_CONTEXT_KINDS = new Set([
  "person",
  "photo",
  "person_tags",
  "person_skills",
  "person_assessments",
  "person_interviews",
  "person_commitments",
  "latest_commitment",
]);

export const continuePeopleDomainReadConversation: EvryCapabilityConversationContinuation =
  {
    identity: "people-domain-reads",
    matches(input) {
      return selectPeopleRead(input.literalUserText) !== null;
    },
    async continue(input) {
      const selection = selectPeopleRead(input.literalUserText);
      if (!selection) return null;
      if (
        PERSON_CONTEXT_KINDS.has(selection.kind) &&
        input.requestPageContext?.kind !== "person"
      ) {
        const clarification = {
          kind: "clarification" as const,
          mode: "missing" as const,
          entityType: "person",
          prompt: "Open the person’s record and send this read request again.",
        };
        return {
          body: clarification.prompt,
          artifacts: [storedEvryClarificationArtifactDocument(clarification)],
        };
      }
      const artifact = await continuePeopleDomainRead({
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
    },
  };
