import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import type { EvryCapabilityConversationContinuation } from "@/lib/evry/capabilities/conversation";
import { authorizeEvryReadCapability } from "@/lib/evry/eligibility/capabilities";
import { deriveEvryPlanRequestKey } from "@/lib/evry/plans";

import { executeTeamsRead } from "./reads";
import { resolveTeamsEvryEffect } from "./resolver";
import {
  proposeTeamsEvryEffect,
  recoverTeamsEvryEffectProposal,
} from "./runtime";
import { selectTeamsEvryRequest } from "./selection";

const READ_IDENTITY = {
  read_list: "teams.read.list",
  read_detail: "teams.read.detail",
  read_health: "teams.read.health",
  read_training: "teams.read.training",
  read_meetings: "teams.read.meetings",
  read_responsibilities: "teams.read.responsibilities",
  read_candidates: "teams.read.candidates",
} as const;

const unavailable = {
  kind: "clarification" as const,
  mode: "missing" as const,
  entityType: "ministry-team",
  prompt:
    "I could not resolve that exact Ministry Teams change in this plant. Check the team, role, person, or field values and try again.",
};

/** Closed production continuation for immediate Teams reads and confirmed effects. */
export const continueTeamsEvryConversation: EvryCapabilityConversationContinuation =
  {
    identity: "teams",
    matches(input) {
      return selectTeamsEvryRequest(input.literalUserText) !== null;
    },
    async continue(input) {
      const selection = selectTeamsEvryRequest(input.literalUserText);
      if (!selection) return null;
      if (selection.kind !== "effect") {
        const authorization = await authorizeEvryReadCapability(
          READ_IDENTITY[selection.kind]
        );
        if (
          !authorization ||
          authorization.actor.userId !== input.actor.userId ||
          authorization.actor.plantId !== input.actor.plantId
        )
          return null;
        const result = await executeTeamsRead({
          authorization,
          untrustedInput: selection,
        });
        return result
          ? {
              body: result.title,
              artifacts: [storedEvryReadArtifactDocument(result)],
            }
          : {
              body: unavailable.prompt,
              artifacts: [storedEvryClarificationArtifactDocument(unavailable)],
            };
      }
      const requestKey = deriveEvryPlanRequestKey(
        `teams-${selection.operation.toLowerCase()}`,
        [
          input.actor.userId,
          input.actor.plantId,
          input.conversation.id,
          input.userRequestKey,
        ]
      );
      const recovered = await recoverTeamsEvryEffectProposal({
        actor: input.actor,
        expectedOperation: selection.operation,
        requestKey,
      });
      if (recovered) {
        return {
          body: "Review this exact Ministry Teams change before anything is written.",
          artifacts: [
            parseEvryConversationArtifactDocument(recovered.confirmation),
          ],
          activePlan: { mode: "set" as const, plan: recovered.plan },
        };
      }
      const resolved = await resolveTeamsEvryEffect({
        actor: input.actor,
        selection,
        now: input.now,
      });
      if (!resolved)
        return {
          body: unavailable.prompt,
          artifacts: [storedEvryClarificationArtifactDocument(unavailable)],
        };
      const proposed = await proposeTeamsEvryEffect({
        actor: input.actor,
        resolved,
        requestKey,
      });
      if (!proposed) return null;
      return {
        body: "Review this exact Ministry Teams change before anything is written.",
        artifacts: [
          parseEvryConversationArtifactDocument(proposed.confirmation),
        ],
        activePlan: { mode: "set" as const, plan: proposed.plan },
      };
    },
  };
