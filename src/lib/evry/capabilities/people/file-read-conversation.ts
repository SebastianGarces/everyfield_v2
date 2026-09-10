import { storedEvryReadArtifactDocument } from "@/lib/evry/conversations/artifacts";
import { eligibleEvryCapabilitiesFor } from "@/lib/evry/eligibility/capabilities";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import { continuePeopleFileRead, selectPeopleFileRead } from "./file-reads";

export const continuePeopleFileReadConversation: EvryCapabilityConversationContinuation =
  {
    identity: "people-file-reads",
    matches(input) {
      return selectPeopleFileRead(input.literalUserText) !== null;
    },
    async continue(input) {
      const artifact = await continuePeopleFileRead({
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
