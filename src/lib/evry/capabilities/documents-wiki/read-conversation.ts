import { storedEvryReadArtifactDocument } from "@/lib/evry/conversations/artifacts";
import { eligibleEvryCapabilitiesFor } from "@/lib/evry/eligibility/capabilities";

import type { EvryCapabilityConversationContinuation } from "../conversation";
import { continueDocumentsWikiRead, selectDocumentsWikiRead } from "./reads";

export const continueDocumentsWikiReadConversation: EvryCapabilityConversationContinuation =
  {
    identity: "documents-wiki-reads",
    matches(input) {
      return selectDocumentsWikiRead(input.literalUserText) !== null;
    },
    async continue(input) {
      const artifact = await continueDocumentsWikiRead({
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
