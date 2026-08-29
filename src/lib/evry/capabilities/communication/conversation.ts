import {
  parseEvryConversationArtifactDocument,
  storedEvryClarificationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { eligibleEvryCapabilitiesFor } from "@/lib/evry/eligibility/capabilities";
import {
  deriveEvryPlanRequestKey,
  parseStoredEvryActionPlan,
} from "@/lib/evry/plans";
import { validateStoredEvryActionPlan } from "@/lib/evry/plans/integrity";
import {
  findEvryActionPlanByRequestKey,
  type StoredEvryActionPlan,
} from "@/lib/evry/plans/repository";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import {
  COMMUNICATION_MESSAGE_SEND_IDENTITY,
  COMMUNICATION_RESEND_NON_OPENERS_IDENTITY,
  proposeCommunicationEvryMessageEffect,
  selectCommunicationEvryMessageEffect,
} from "./messages";
import {
  continueCommunicationEvryRead,
  selectCommunicationEvryRead,
} from "./reads";
import {
  COMMUNICATION_TEMPLATE_CREATE_IDENTITY,
  COMMUNICATION_TEMPLATE_DELETE_IDENTITY,
  COMMUNICATION_TEMPLATE_FORK_IDENTITY,
  COMMUNICATION_TEMPLATE_UPDATE_IDENTITY,
  proposeCommunicationEvryTemplateEffect,
  selectCommunicationEvryTemplateEffect,
} from "./templates";
import {
  COMMUNICATION_EVRY_PLAN_REGISTRY,
  COMMUNICATION_EVRY_REVIEW_REGISTRY,
} from "./runtime";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";

type CommunicationEvryConversationDependencies = Readonly<{
  findPlanByRequestKey: typeof findEvryActionPlanByRequestKey;
  proposeMessage: typeof proposeCommunicationEvryMessageEffect;
  proposeTemplate: typeof proposeCommunicationEvryTemplateEffect;
}>;

const productionDependencies: CommunicationEvryConversationDependencies = {
  findPlanByRequestKey: findEvryActionPlanByRequestKey,
  proposeMessage: proposeCommunicationEvryMessageEffect,
  proposeTemplate: proposeCommunicationEvryTemplateEffect,
};

function expectedEffectIdentity(
  selection:
    | ReturnType<typeof selectCommunicationEvryMessageEffect>
    | ReturnType<typeof selectCommunicationEvryTemplateEffect>
): string | null {
  switch (selection?.kind) {
    case "send":
      return COMMUNICATION_MESSAGE_SEND_IDENTITY;
    case "resend":
      return COMMUNICATION_RESEND_NON_OPENERS_IDENTITY;
    case "create_template":
      return COMMUNICATION_TEMPLATE_CREATE_IDENTITY;
    case "update_template":
      return COMMUNICATION_TEMPLATE_UPDATE_IDENTITY;
    case "delete_template":
      return COMMUNICATION_TEMPLATE_DELETE_IDENTITY;
    case "fork_template":
      return COMMUNICATION_TEMPLATE_FORK_IDENTITY;
    default:
      return null;
  }
}

function recoveredPlanResult(input: {
  stored: StoredEvryActionPlan;
  expectedIdentity: string;
}) {
  if (
    !validateStoredEvryActionPlan(
      input.stored,
      COMMUNICATION_EVRY_PLAN_REGISTRY
    )
  ) {
    throw new Error("Stored Communication plan failed integrity validation");
  }
  const document = parseStoredEvryActionPlan({
    document: input.stored.document,
    registry: COMMUNICATION_EVRY_PLAN_REGISTRY,
  });
  if (
    document.steps.length !== 1 ||
    document.steps[0]?.capabilityIdentity !== input.expectedIdentity
  ) {
    throw new Error("Stored Communication plan does not match the request");
  }
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: input.stored.id,
    fingerprint: input.stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: COMMUNICATION_EVRY_REVIEW_REGISTRY,
  });
  if (!review) {
    throw new Error("Stored Communication plan has no trusted review");
  }
  return {
    body: "Review this exact Communication change before anything is saved or sent.",
    artifacts: [parseEvryConversationArtifactDocument(review.confirmation)],
    activePlan: { mode: "set" as const, plan },
  };
}

/** One closed Communication continuation: deterministic reads or reviewed effects. */
export function createCommunicationEvryConversationContinuation(
  dependencies: CommunicationEvryConversationDependencies = productionDependencies
): EvryCapabilityConversationContinuation {
  return {
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
        messageSelection.audience.kind === "page_person" &&
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
      const expectedIdentity = expectedEffectIdentity(
        templateSelection ?? messageSelection
      );
      if (!expectedIdentity) return null;
      const stored = await dependencies.findPlanByRequestKey({
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        requestKey,
      });
      if (stored) {
        return recoveredPlanResult({ stored, expectedIdentity });
      }
      const proposal = templateSelection
        ? await dependencies.proposeTemplate({
            actor: input.actor,
            selection: templateSelection,
            requestKey,
          })
        : await dependencies.proposeMessage({
            actor: input.actor,
            pageContext: input.pageContext,
            selection: messageSelection!,
            requestKey,
            now: new Date(),
          });
      if (proposal.kind === "refusal") {
        return {
          body: proposal.body,
          artifacts: [proposal.artifact],
        };
      }
      return {
        body: "Review this exact Communication change before anything is saved or sent.",
        artifacts: [
          parseEvryConversationArtifactDocument(proposal.confirmation),
        ],
        activePlan: { mode: "set", plan: proposal.plan },
      };
    },
  };
}

export const continueCommunicationEvryConversation =
  createCommunicationEvryConversationContinuation();
