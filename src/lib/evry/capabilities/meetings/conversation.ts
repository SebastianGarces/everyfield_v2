import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { authorizeEvryReadCapability } from "@/lib/evry/eligibility/capabilities";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";
import { selectMeetingInvitationReferenceRequest } from "@/lib/evry/recipes/meeting-invitation-selection";
import { resolveAuthorizedEvryPageContext } from "@/lib/evry/resolvers/page-context";
import { readEvryPlantTimeZone } from "@/lib/evry/reads/plant-time-zone";
import { instantsAtZonedTime } from "@/lib/datetime";
import { resolveOperationDatetime } from "../preparations/operations-dates";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import { meetingsReadInputForSelection } from "./read-input";
import { executeMeetingsRead } from "./reads";
import { resolveMeetingsEvryEffect } from "./resolver";
import {
  proposeMeetingsEvryEffect,
  recoverMeetingsEvryEffectProposal,
  type MeetingsEvryEffectProposal,
} from "./runtime";
import {
  selectMeetingsEvryRequest,
  type MeetingsEvryEffectSelection,
} from "./selection";

const READ_IDENTITY = {
  read_list: "meetings.read.list",
  read_detail: "meetings.read.detail",
  read_analytics: "meetings.read.analytics",
  read_locations: "meetings.read.schedule",
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

type MeetingsEffectConversationDependencies = Readonly<{
  recoverProposal: typeof recoverMeetingsEvryEffectProposal;
  resolveEffect: typeof resolveMeetingsEvryEffect;
  proposeEffect: typeof proposeMeetingsEvryEffect;
  readTimeZone?: typeof readEvryPlantTimeZone;
  resolvePageContext?: typeof resolveAuthorizedEvryPageContext;
}>;

type MeetingsReadConversationDependencies = Readonly<{
  authorizeRead: typeof authorizeEvryReadCapability;
  executeRead: typeof executeMeetingsRead;
}>;

const productionReadDependencies: MeetingsReadConversationDependencies = {
  authorizeRead: authorizeEvryReadCapability,
  executeRead: executeMeetingsRead,
};

function proposalResult(proposal: MeetingsEvryEffectProposal) {
  return {
    body: "Review this exact Meetings change before anything is written.",
    artifacts: [parseEvryConversationArtifactDocument(proposal.confirmation)],
    activePlan: { mode: "set" as const, plan: proposal.plan },
  };
}

/** Closed production continuation for Meetings reads and confirmed effects. */
export function createMeetingsEvryConversationContinuation(
  dependencies: MeetingsEffectConversationDependencies = {
    recoverProposal: recoverMeetingsEvryEffectProposal,
    resolveEffect: resolveMeetingsEvryEffect,
    proposeEffect: proposeMeetingsEvryEffect,
  },
  readDependencies: MeetingsReadConversationDependencies = productionReadDependencies,
  selectedEffect?: MeetingsEvryEffectSelection,
  targetMeetingId?: string
): EvryCapabilityConversationContinuation {
  return {
    identity: "meetings",
    matches(input) {
      return (
        selectMeetingInvitationReferenceRequest(input.literalUserText) ===
          null && selectMeetingsEvryRequest(input.literalUserText) !== null
      );
    },
    async continue(input) {
      const selection =
        selectedEffect ?? selectMeetingsEvryRequest(input.literalUserText);
      if (!selection) return null;

      if (selection.kind !== "effect") {
        const identity = READ_IDENTITY[selection.kind];
        const authorization = await readDependencies.authorizeRead(identity);
        if (
          !authorization ||
          authorization.actor.userId !== input.actor.userId ||
          authorization.actor.plantId !== input.actor.plantId
        ) {
          return null;
        }
        const needsMeeting =
          selection.kind === "read_detail" ||
          selection.kind === "read_analytics";
        if (needsMeeting && input.pageContext?.kind !== "meeting") {
          return missingMeetingResult();
        }
        const artifact = await readDependencies.executeRead({
          authorization,
          untrustedInput: meetingsReadInputForSelection(
            selection,
            input.pageContext
          ),
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
      const recovered = await dependencies.recoverProposal({
        actor: input.actor,
        expectedExportName: selection.exportName,
        requestKey,
      });
      if (recovered) return proposalResult(recovered);

      const pageContext = targetMeetingId
        ? await (
            dependencies.resolvePageContext ?? resolveAuthorizedEvryPageContext
          )({
            actor: input.actor,
            pageContext: { kind: "meeting", recordId: targetMeetingId },
          })
        : input.pageContext;
      let effectSelection = selection;
      if (selectedEffect) {
        const timezone = await (
          dependencies.readTimeZone ?? readEvryPlantTimeZone
        )(input.actor.plantId);
        const datetime =
          selection.values.datetime === undefined
            ? undefined
            : resolveOperationDatetime(
                selection.values.datetime,
                input.now,
                timezone
              );
        if (typeof datetime === "string") {
          const date = datetime.slice(0, 10);
          const hour = Number(datetime.slice(11, 13));
          const minute = Number(datetime.slice(14, 16));
          if (instantsAtZonedTime(date, hour, minute, timezone).length !== 1) {
            const clarification = {
              kind: "clarification" as const,
              mode: "missing" as const,
              entityType: "meeting_time",
              prompt:
                "That local meeting time is skipped or repeated by daylight saving. Choose another time so the meeting has one clear start time.",
            };
            return {
              body: clarification.prompt,
              artifacts: [
                storedEvryClarificationArtifactDocument(clarification),
              ],
            };
          }
        }
        effectSelection = {
          ...selection,
          values: {
            ...selection.values,
            ...(datetime ? { datetime } : {}),
            timezone,
          },
        };
      }

      const resolved = await dependencies.resolveEffect({
        actor: input.actor,
        selection: effectSelection,
        pageContext,
        requestKey,
        now: input.now,
      });
      if (!resolved) return missingMeetingResult();
      const proposal = await dependencies.proposeEffect({
        actor: input.actor,
        resolved,
        requestKey,
      });
      if (!proposal) return null;
      return proposalResult(proposal);
    },
  };
}

export const continueMeetingsEvryConversation =
  createMeetingsEvryConversationContinuation();
