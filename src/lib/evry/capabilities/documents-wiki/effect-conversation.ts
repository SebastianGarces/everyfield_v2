import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import { parseEvryConversationArtifactDocument } from "@/lib/evry/conversations/artifacts";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
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
  DOCUMENTS_WIKI_EFFECT_IDENTITIES,
  DOCUMENTS_WIKI_PLAN_REGISTRY,
  DOCUMENTS_WIKI_REVIEW_REGISTRY,
  proposeDocumentsWikiEffect,
  selectDocumentsWikiEffect,
  type DocumentsWikiEffectSelection,
} from "./effects";

type DocumentsWikiConversationDependencies = Readonly<{
  findPlanByRequestKey: typeof findEvryActionPlanByRequestKey;
  propose: typeof proposeDocumentsWikiEffect;
}>;

const productionDependencies: DocumentsWikiConversationDependencies = {
  findPlanByRequestKey: findEvryActionPlanByRequestKey,
  propose: proposeDocumentsWikiEffect,
};

function expectedIdentity(selection: DocumentsWikiEffectSelection): string {
  return DOCUMENTS_WIKI_EFFECT_IDENTITIES[selection.kind];
}

function recoveredResult(input: {
  stored: StoredEvryActionPlan;
  expectedIdentity: string;
}) {
  if (
    !validateStoredEvryActionPlan(input.stored, DOCUMENTS_WIKI_PLAN_REGISTRY)
  ) {
    throw new Error("Stored Documents/wiki plan failed integrity validation");
  }
  const document = parseStoredEvryActionPlan({
    document: input.stored.document,
    registry: DOCUMENTS_WIKI_PLAN_REGISTRY,
  });
  if (
    document.steps.length !== 1 ||
    document.steps[0]?.capabilityIdentity !== input.expectedIdentity
  ) {
    throw new Error("Stored Documents/wiki plan does not match the request");
  }
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: input.stored.id,
    fingerprint: input.stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: DOCUMENTS_WIKI_REVIEW_REGISTRY,
  });
  if (!review)
    throw new Error("Stored Documents/wiki plan has no trusted review");
  return {
    body: "Review this exact Documents or Wiki change before anything is saved.",
    artifacts: [parseEvryConversationArtifactDocument(review.confirmation)],
    activePlan: { mode: "set" as const, plan },
  };
}

/** Recover request-key durable plans before consulting mutable templates/articles. */
export function createDocumentsWikiEffectConversationContinuation(
  dependencies: DocumentsWikiConversationDependencies = productionDependencies
): EvryCapabilityConversationContinuation {
  return {
    identity: "documents-wiki-effects",
    matches(input) {
      return selectDocumentsWikiEffect(input.literalUserText) !== null;
    },
    async continue(input) {
      const selection = selectDocumentsWikiEffect(input.literalUserText);
      if (!selection) return null;
      const requestKey = deriveEvryPlanRequestKey(
        `documents-wiki-${selection.kind}`,
        [
          input.actor.userId,
          input.actor.plantId,
          input.conversation.id,
          input.userRequestKey,
        ]
      );
      const identity = expectedIdentity(selection);
      const stored = await dependencies.findPlanByRequestKey({
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        requestKey,
      });
      if (stored)
        return recoveredResult({ stored, expectedIdentity: identity });
      const proposal = await dependencies.propose({
        actor: input.actor,
        selection,
        requestKey,
      });
      return proposal
        ? {
            body: "Review this exact Documents or Wiki change before anything is saved.",
            artifacts: [
              parseEvryConversationArtifactDocument(proposal.confirmation),
            ],
            activePlan: { mode: "set", plan: proposal.plan },
          }
        : null;
    },
  };
}

export const continueDocumentsWikiEffectConversation =
  createDocumentsWikiEffectConversationContinuation();
