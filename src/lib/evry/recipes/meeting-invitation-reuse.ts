import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";
import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";

import { meetingInvitationRequestFromHistory } from "./meeting-invitation-conversation";
import {
  MEETING_INVITATION_RECIPE_IDENTITY,
  MEETING_INVITATION_RECIPE_REGISTRY,
  type MeetingInvitationReferenceRequest,
} from "./meeting-invitation";
import { MEETING_INVITATION_REUSE_INTRO } from "./meeting-invitation-selection";
import { defineEvryRecipeReuse } from "./reuse";

function samePlan(
  left: EvryConversationPlanIdentity,
  right: EvryConversationPlanIdentity
) {
  return left.planId === right.planId && left.fingerprint === right.fingerprint;
}

function messagesBeforeConfirmation(input: {
  conversation: EvryStoredConversation;
  plan: EvryConversationPlanIdentity;
}) {
  const confirmationIndex = input.conversation.messages.findIndex((message) =>
    message.artifacts.some(
      ({ document }) =>
        document.kind === "confirmation" && samePlan(document.plan, input.plan)
    )
  );
  return confirmationIndex < 0
    ? null
    : input.conversation.messages.slice(0, confirmationIndex);
}

function visibleLocationQuery(
  messages: EvryStoredConversation["messages"],
  request: MeetingInvitationReferenceRequest
): string | undefined {
  if (request.locationQuery) return request.locationQuery;
  if (!request.locationId) return undefined;
  for (const message of [...messages].reverse()) {
    for (const stored of [...message.artifacts].reverse()) {
      const document = stored.document;
      if (document.kind !== "clarification" || document.mode !== "choice") {
        continue;
      }
      const choice = document.choices.find(
        ({ id }) => id === request.locationId
      );
      if (!choice) continue;
      return (
        choice.distinguishingFacts.find(({ label }) => label === "Name")
          ?.value ??
        choice.distinguishingFacts.find(({ label }) => label === "Address")
          ?.value
      );
    }
  }
  return undefined;
}

export function meetingInvitationReuseDraft(input: {
  conversation: EvryStoredConversation;
  plan: EvryConversationPlanIdentity;
}) {
  const messages = messagesBeforeConfirmation(input);
  const lastUserMessage = messages?.findLast(({ author }) => author === "user");
  if (!messages || !lastUserMessage) return null;
  const request = meetingInvitationRequestFromHistory({
    conversation: { ...input.conversation, activePlan: null, messages },
    literalUserText: lastUserMessage.body,
  });
  if (!request?.durationMinutes) return null;
  const locationQuery = visibleLocationQuery(messages, request);
  if (request.locationId && !locationQuery) return null;
  const locationLine = locationQuery
    ? `Location choice: ${JSON.stringify(locationQuery)}`
    : "Location choice: Resolve the church location again.";
  const message = [
    MEETING_INVITATION_REUSE_INTRO,
    `Create a meeting for ${request.sourceText} at the church location, lasting ${request.durationMinutes} minutes.`,
    locationLine,
    "Invite the core team and add prospects who have not visited a Vision Meeting.",
    "Draft an email invitation and send it to them.",
  ].join("\n");
  return Object.freeze({
    recipeIdentity: MEETING_INVITATION_RECIPE_IDENTITY,
    message,
  });
}

export const MEETING_INVITATION_REUSE = defineEvryRecipeReuse({
  identity: MEETING_INVITATION_RECIPE_IDENTITY,
  recipeRegistry: MEETING_INVITATION_RECIPE_REGISTRY,
  project: meetingInvitationReuseDraft,
});
