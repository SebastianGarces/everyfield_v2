import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import type { EvryCapabilityConversationContinuation } from "@/lib/evry/capabilities/conversation";
import {
  authorizeEvryReadCapability,
  eligibleEvryCapabilitiesFor,
  EVRY_PEOPLE_READ_PROBE_IDENTITY,
} from "@/lib/evry/eligibility/capabilities";
import {
  deriveEvryPlanRequestKey,
  parseStoredEvryActionPlan,
} from "@/lib/evry/plans";
import { validateStoredEvryActionPlan } from "@/lib/evry/plans/integrity";
import {
  findEvryActionPlanByRequestKey,
  type StoredEvryActionPlan,
} from "@/lib/evry/plans/repository";
import {
  createEvryRecipePlan,
  EvryRecipeCompilationError,
} from "@/lib/evry/recipes/compiler";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";

import {
  MEETING_INVITATION_PLAN_RESOLVER_INPUT_SCHEMA,
  MEETING_INVITATION_RECIPE_IDENTITY,
  MEETING_INVITATION_RECIPE_REGISTRY,
  MEETING_INVITATION_REVIEW_REGISTRY,
  resolveAuthorizedMeetingInvitationRequest,
} from "./meeting-invitation";
import { selectMeetingInvitationReferenceRequest } from "./meeting-invitation-selection";

function latestMeetingClarification(
  input: Parameters<EvryCapabilityConversationContinuation["matches"]>[0]
) {
  for (const message of [...(input.conversation.messages ?? [])].reverse()) {
    if (message.author !== "assistant") continue;
    for (const stored of message.artifacts) {
      const artifact = stored.artifact;
      if (
        artifact.kind === "clarification" &&
        artifact.entityType.startsWith("meeting_")
      ) {
        return artifact;
      }
    }
    return null;
  }
  return null;
}

function addYear(sourceText: string, year: string) {
  if (/\b(?:19|20)\d{2}\b/.test(sourceText)) return sourceText;
  return sourceText.replace(/^(\p{L}+\s+\d{1,2})(\s+at\b)/iu, `$1, ${year}$2`);
}

/** Fold focused clarification answers back into the original closed request. */
export function meetingInvitationRequestForConversation(
  input: Parameters<EvryCapabilityConversationContinuation["matches"]>[0]
) {
  const direct = selectMeetingInvitationReferenceRequest(input.literalUserText);
  if (direct) return direct;
  if (input.conversation.activePlan || !latestMeetingClarification(input)) {
    return null;
  }
  const messages = input.conversation.messages ?? [];
  const originalIndex = messages.findLastIndex(
    (message) =>
      message.author === "user" &&
      selectMeetingInvitationReferenceRequest(message.body) !== null
  );
  if (originalIndex < 0) return null;
  const original = selectMeetingInvitationReferenceRequest(
    messages[originalIndex]!.body
  );
  if (!original) return null;
  const replies = messages
    .slice(originalIndex + 1)
    .filter(({ author }) => author === "user")
    .map(({ body }) => body);
  if (replies.at(-1) !== input.literalUserText)
    replies.push(input.literalUserText);
  let durationMinutes = original.durationMinutes;
  let sourceText = original.sourceText;
  let locationId = original.locationId;
  for (const reply of replies) {
    const duration = /\b(\d{1,4})\s*minutes?\b/i.exec(reply);
    if (duration) durationMinutes = Number(duration[1]);
    const year = /\b((?:19|20)\d{2})\b/.exec(reply);
    if (year) sourceText = addYear(sourceText, year[1]);
  }
  const clarification = latestMeetingClarification(input);
  if (clarification?.mode === "choice") {
    const reply = input.literalUserText.normalize("NFKC").trim().toLowerCase();
    const choice = clarification.choices.find(
      ({ id, label }) =>
        reply === id.toLowerCase() || reply === label.trim().toLowerCase()
    );
    if (choice) locationId = choice.id;
  }
  return Object.freeze({
    ...original,
    sourceText,
    durationMinutes,
    locationId,
  });
}

type Dependencies = Readonly<{
  authorizeRead: typeof authorizeEvryReadCapability;
  findPlan: typeof findEvryActionPlanByRequestKey;
  resolveAuthorized: typeof resolveAuthorizedMeetingInvitationRequest;
  createPlan: typeof createEvryRecipePlan;
}>;

const productionDependencies: Dependencies = Object.freeze({
  authorizeRead: authorizeEvryReadCapability,
  findPlan: findEvryActionPlanByRequestKey,
  resolveAuthorized: resolveAuthorizedMeetingInvitationRequest,
  createPlan: createEvryRecipePlan,
});

function proposalFromStored(stored: StoredEvryActionPlan) {
  const planRegistry =
    MEETING_INVITATION_RECIPE_REGISTRY.executionRegistry.planRegistry;
  if (!validateStoredEvryActionPlan(stored, planRegistry)) {
    throw new Error(
      "Stored meeting invitation plan failed integrity validation"
    );
  }
  const document = parseStoredEvryActionPlan({
    document: stored.document,
    registry: planRegistry,
  });
  if (document.recipe?.identity !== MEETING_INVITATION_RECIPE_IDENTITY) {
    throw new Error("Stored plan does not match the meeting invitation recipe");
  }
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: MEETING_INVITATION_REVIEW_REGISTRY,
  });
  if (!review) {
    throw new Error("Stored meeting invitation plan has no trusted review");
  }
  return {
    body: "Review this exact meeting, guest list, notifications, and invitation send before anything is written.",
    artifacts: [parseEvryConversationArtifactDocument(review.confirmation)],
    activePlan: { mode: "set" as const, plan },
  };
}

/** Ordinary production continuation for the canonical FRD 3.5 recipe. */
export function createMeetingInvitationConversationContinuation(
  dependencies: Dependencies = productionDependencies
): EvryCapabilityConversationContinuation {
  return {
    identity: MEETING_INVITATION_RECIPE_IDENTITY,
    matches(input) {
      return meetingInvitationRequestForConversation(input) !== null;
    },
    async continue(input) {
      const request = meetingInvitationRequestForConversation(input);
      if (!request) return null;
      const requestKey = deriveEvryPlanRequestKey("meeting-invitation", [
        input.actor.userId,
        input.actor.plantId,
        input.conversation.id,
        input.userRequestKey,
      ]);
      const recovered = await dependencies.findPlan({
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        requestKey,
      });
      if (recovered) return proposalFromStored(recovered);

      const authorization = await dependencies.authorizeRead(
        EVRY_PEOPLE_READ_PROBE_IDENTITY
      );
      if (
        !authorization ||
        authorization.actor.userId !== input.actor.userId ||
        authorization.actor.plantId !== input.actor.plantId
      ) {
        return null;
      }
      const resolution = await dependencies.resolveAuthorized({
        authorization,
        request,
        requestKey,
        now: input.now,
      });
      if (resolution.kind === "clarification") {
        return {
          body: resolution.artifact.prompt,
          artifacts: [
            storedEvryClarificationArtifactDocument(resolution.artifact),
          ],
        };
      }
      if (resolution.kind !== "planned") return null;

      const rawResolverInput =
        MEETING_INVITATION_PLAN_RESOLVER_INPUT_SCHEMA.parse({
          request,
          requestKey,
          now: input.now.toISOString(),
        });
      let stored: StoredEvryActionPlan;
      try {
        stored = await dependencies.createPlan({
          actor: input.actor,
          policy: {
            classification: "application_action",
            continuation: {
              kind: "application_action",
              literalUserText: input.literalUserText,
            },
          },
          recipeIdentity: MEETING_INVITATION_RECIPE_IDENTITY,
          inputValues: { plan: rawResolverInput },
          requestKey,
          registry: MEETING_INVITATION_RECIPE_REGISTRY,
          reviewRegistry: MEETING_INVITATION_REVIEW_REGISTRY,
          eligibleCapabilities: eligibleEvryCapabilitiesFor(input.actor),
        });
      } catch (error) {
        if (error instanceof EvryRecipeCompilationError) return null;
        throw error;
      }
      return proposalFromStored(stored);
    },
  };
}

export const continueMeetingInvitationConversation =
  createMeetingInvitationConversationContinuation();
