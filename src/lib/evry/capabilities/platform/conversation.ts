import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import {
  assertEvryPlanDocumentReviewable,
  trustedReviewForEvryPlanDocument,
} from "@/lib/evry/artifacts/trusted-plan-review";
import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import {
  authorizeEvryEffectCapability,
  eligibleEvryCapabilitiesFor,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  deriveEvryPlanRequestKey,
  parseEvryActionPlanCandidate,
  parseStoredEvryActionPlan,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { validateStoredEvryActionPlan } from "@/lib/evry/plans/integrity";
import {
  createEvryActionPlanRecord,
  findEvryActionPlanByRequestKey,
  type StoredEvryActionPlan,
} from "@/lib/evry/plans/repository";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import {
  MARK_ALL_NOTIFICATIONS_IDENTITY,
  MARK_ONE_NOTIFICATION_IDENTITY,
  SUBMIT_FEEDBACK_IDENTITY,
  feedbackArgumentsSchema,
  loadEvryUnreadNotificationSnapshot,
  markAllArgumentsSchema,
  markOneArgumentsSchema,
  platformEffectUuid,
} from "./effects";
import { continuePlatformEvryRead } from "./reads";
import {
  PLATFORM_EVRY_PLAN_REGISTRY,
  PLATFORM_EVRY_REVIEW_REGISTRY,
} from "./runtime";
import {
  selectPlatformEvryRequest,
  type PlatformEvrySelection,
} from "./selection";

function identityFor(selection: PlatformEvrySelection) {
  switch (selection.kind) {
    case "mark_one":
      return MARK_ONE_NOTIFICATION_IDENTITY;
    case "mark_all":
      return MARK_ALL_NOTIFICATIONS_IDENTITY;
    case "feedback":
      return SUBMIT_FEEDBACK_IDENTITY;
    default:
      return null;
  }
}

function refusal(
  title: string,
  body: string,
  source: Readonly<{ label: string; href: string }>
) {
  return {
    body,
    artifacts: [
      storedEvryReadArtifactDocument(
        buildEvryReadArtifact({
          title,
          filters: [{ label: "Plant", value: "Current plant" }],
          exclusions: [
            { reason: "Unavailable or no longer current", count: 1 },
          ],
          items: [],
          sourceLinks: [
            trustedEvryApplicationSourceLink({
              label: source.label,
              href: source.href,
            }),
          ],
        })
      ),
    ],
  };
}

async function storePlan(input: {
  actor: EvryPlantActor;
  identity: string;
  requestKey: EvryPlanRequestKey;
  stepId: string;
  arguments: Record<string, unknown>;
}) {
  const authorization = await authorizeEvryEffectCapability(input.identity);
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  ) {
    return null;
  }
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: input.stepId,
          capabilityIdentity: input.identity,
          arguments: input.arguments,
          dependsOn: [],
        },
      ],
    },
    registry: PLATFORM_EVRY_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(authorization.actor),
  });
  assertEvryPlanDocumentReviewable({
    document,
    reviewRegistry: PLATFORM_EVRY_REVIEW_REGISTRY,
  });
  const stored = await createEvryActionPlanRecord({
    actorUserId: authorization.actor.userId,
    plantId: authorization.actor.plantId,
    requestKey: input.requestKey,
    document,
  });
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: PLATFORM_EVRY_REVIEW_REGISTRY,
  });
  if (!review) throw new Error("Stored platform plan has no trusted review");
  return { plan, confirmation: review.confirmation };
}

async function proposeEffect(input: {
  actor: EvryPlantActor;
  selection: Extract<
    PlatformEvrySelection,
    { kind: "mark_one" | "mark_all" | "feedback" }
  >;
  requestKey: EvryPlanRequestKey;
  now: Date;
}) {
  if (input.selection.kind === "feedback") {
    return storePlan({
      actor: input.actor,
      identity: SUBMIT_FEEDBACK_IDENTITY,
      requestKey: input.requestKey,
      stepId: "submit-feedback",
      arguments: feedbackArgumentsSchema.parse({
        feedbackId: platformEffectUuid(input.requestKey, "feedback"),
        category: input.selection.category,
        description: input.selection.description,
        pageUrl: input.selection.pageUrl,
      }),
    });
  }

  const exact = await loadEvryUnreadNotificationSnapshot({
    actor: input.actor,
    notificationId:
      input.selection.kind === "mark_one"
        ? input.selection.notificationId
        : undefined,
    now: input.now,
  });
  if (exact.notifications.length === 0) return null;
  if (input.selection.kind === "mark_one") {
    return storePlan({
      actor: input.actor,
      identity: MARK_ONE_NOTIFICATION_IDENTITY,
      requestKey: input.requestKey,
      stepId: "mark-notification-read",
      arguments: markOneArgumentsSchema.parse({
        notification: exact.notifications[0],
        visibility: exact.visibility,
      }),
    });
  }
  const reviewable = markAllArgumentsSchema.safeParse(exact);
  if (!reviewable.success) return null;
  return storePlan({
    actor: input.actor,
    identity: MARK_ALL_NOTIFICATIONS_IDENTITY,
    requestKey: input.requestKey,
    stepId: "mark-all-notifications-read",
    arguments: reviewable.data,
  });
}

function recoverPlan(input: {
  stored: StoredEvryActionPlan;
  expectedIdentity: string;
}) {
  if (
    !validateStoredEvryActionPlan(input.stored, PLATFORM_EVRY_PLAN_REGISTRY)
  ) {
    throw new Error("Stored platform plan failed integrity validation");
  }
  const document = parseStoredEvryActionPlan({
    document: input.stored.document,
    registry: PLATFORM_EVRY_PLAN_REGISTRY,
  });
  if (
    document.steps.length !== 1 ||
    document.steps[0]?.capabilityIdentity !== input.expectedIdentity
  ) {
    throw new Error("Stored platform plan does not match the request");
  }
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: input.stored.id,
    fingerprint: input.stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: PLATFORM_EVRY_REVIEW_REGISTRY,
  });
  if (!review) throw new Error("Stored platform plan has no trusted review");
  return {
    body: "Review this exact change before it is applied.",
    artifacts: [parseEvryConversationArtifactDocument(review.confirmation)],
    activePlan: { mode: "set" as const, plan },
  };
}

export function createPlatformEvryConversationContinuation(
  dependencies: Readonly<{
    findPlan: typeof findEvryActionPlanByRequestKey;
    propose: typeof proposeEffect;
    read: typeof continuePlatformEvryRead;
  }> = {
    findPlan: findEvryActionPlanByRequestKey,
    propose: proposeEffect,
    read: continuePlatformEvryRead,
  }
): EvryCapabilityConversationContinuation {
  return {
    identity: "platform",
    matches(input) {
      return selectPlatformEvryRequest(input.literalUserText) !== null;
    },
    async continue(input) {
      const selection = selectPlatformEvryRequest(input.literalUserText);
      if (!selection) return null;
      if (selection.kind === "clarification") {
        const clarification = {
          kind: "clarification" as const,
          mode: "missing" as const,
          entityType: selection.subject,
          prompt: selection.prompt,
        };
        return {
          body: clarification.prompt,
          artifacts: [storedEvryClarificationArtifactDocument(clarification)],
        };
      }
      if (
        selection.kind === "dashboard" ||
        selection.kind === "notification_count" ||
        selection.kind === "notifications"
      ) {
        const artifact = await dependencies.read({
          actor: input.actor,
          selection,
        });
        return artifact
          ? {
              body: artifact.title,
              artifacts: [storedEvryReadArtifactDocument(artifact)],
            }
          : refusal(
              "Unavailable",
              "This read is unavailable for this account.",
              selection.kind === "dashboard"
                ? { label: "Open dashboard", href: "/dashboard" }
                : { label: "Open notifications", href: "/notifications" }
            );
      }
      const expectedIdentity = identityFor(selection);
      if (!expectedIdentity) return null;
      const requestKey = deriveEvryPlanRequestKey(
        `platform-${selection.kind.replaceAll("_", "-")}`,
        [
          input.actor.userId,
          input.actor.plantId,
          input.conversation.id,
          input.userRequestKey,
        ]
      );
      const stored = await dependencies.findPlan({
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        requestKey,
      });
      if (stored) return recoverPlan({ stored, expectedIdentity });
      const proposal = await dependencies.propose({
        actor: input.actor,
        selection,
        requestKey,
        now: input.now,
      });
      if (!proposal) {
        return refusal(
          selection.kind === "mark_all"
            ? "Notification set needs narrowing"
            : "Change unavailable",
          selection.kind === "mark_all"
            ? "The complete unread set is empty or too large to show in one exact confirmation. Mark a visible notification individually, or open notifications to review the set."
            : "The requested target is unavailable, already read, or no longer visible.",
          selection.kind === "feedback"
            ? { label: "Open dashboard", href: "/dashboard" }
            : { label: "Open notifications", href: "/notifications" }
        );
      }
      return {
        body: "Review this exact change before it is applied.",
        artifacts: [
          parseEvryConversationArtifactDocument(proposal.confirmation),
        ],
        activePlan: { mode: "set", plan: proposal.plan },
      };
    },
  };
}

export const continuePlatformEvryConversation =
  createPlatformEvryConversationContinuation();
