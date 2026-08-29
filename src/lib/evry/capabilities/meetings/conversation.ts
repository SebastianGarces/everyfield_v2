import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { authorizeEvryReadCapability } from "@/lib/evry/eligibility/capabilities";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import { MEETINGS_OPERATION_REGISTRATIONS } from "./registrations";
import { executeMeetingsRead } from "./reads";
import { resolveMeetingsEvryEffect } from "./resolver";
import { proposeMeetingsEvryEffect } from "./runtime";
import { selectMeetingsEvryRequest } from "./selection";

const READ_IDENTITY = {
  read_list: "meetings.read.list",
  read_detail: "meetings.read.detail",
  read_analytics: "meetings.read.analytics",
  read_locations: "meetings.read.locations",
} as const;

function missingMeetingResult() {
  const clarification = {
    kind: "clarification" as const,
    mode: "missing" as const,
    entityType: "meeting",
    prompt:
      "Open the meeting you want to use, keep its page context attached, then try this request again.",
  };
  return {
    body: clarification.prompt,
    artifacts: [storedEvryClarificationArtifactDocument(clarification)],
  };
}

/** Closed production continuation for Meetings reads and confirmed effects. */
export const continueMeetingsEvryConversation: EvryCapabilityConversationContinuation =
  {
    identity: "meetings",
    matches(input) {
      return selectMeetingsEvryRequest(input.literalUserText) !== null;
    },
    async continue(input) {
      const selection = selectMeetingsEvryRequest(input.literalUserText);
      if (!selection) return null;

      if (selection.kind !== "effect") {
        const identity = READ_IDENTITY[selection.kind];
        const authorization = await authorizeEvryReadCapability(identity);
        if (
          !authorization ||
          authorization.actor.userId !== input.actor.userId ||
          authorization.actor.plantId !== input.actor.plantId
        ) {
          return null;
        }
        const registration = MEETINGS_OPERATION_REGISTRATIONS.find(
          (candidate) => candidate.identity === identity
        );
        if (!registration) return null;
        const needsMeeting =
          selection.kind === "read_detail" ||
          selection.kind === "read_analytics";
        if (needsMeeting && input.pageContext?.kind !== "meeting") {
          return missingMeetingResult();
        }
        const artifact = await executeMeetingsRead({
          registration,
          authorization,
          untrustedInput:
            selection.kind === "read_list"
              ? {}
              : selection.kind === "read_locations"
                ? {}
                : { meetingId: input.pageContext?.recordId },
        });
        if (!artifact) return null;
        return artifact.kind === "read"
          ? {
              body: artifact.title,
              artifacts: [storedEvryReadArtifactDocument(artifact)],
            }
          : {
              body: artifact.prompt,
              artifacts: [storedEvryClarificationArtifactDocument(artifact)],
            };
      }

      const requestKey = deriveEvryPlanRequestKey(
        `meetings-${selection.exportName.replace(/Action$/, "").toLowerCase()}`,
        [
          input.actor.userId,
          input.actor.plantId,
          input.conversation.id,
          input.userRequestKey,
        ]
      );
      const resolved = await resolveMeetingsEvryEffect({
        actor: input.actor,
        selection,
        pageContext: input.pageContext,
        requestKey,
        now: input.now,
      });
      if (!resolved) return missingMeetingResult();
      const proposal = await proposeMeetingsEvryEffect({
        actor: input.actor,
        resolved,
        requestKey,
      });
      if (!proposal) return null;
      return {
        body: "Review this exact Meetings change before anything is written.",
        artifacts: [
          parseEvryConversationArtifactDocument(proposal.confirmation),
        ],
        activePlan: { mode: "set", plan: proposal.plan },
      };
    },
  };
