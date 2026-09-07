import {
  parseEvryConversationArtifactDocument,
  storedEvryReadArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
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
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";

import type { EvryCapabilityConversationContinuation } from "../conversation";
import {
  plantIntelligenceEffectIdentityFor,
  proposePlantIntelligenceEvryEffect,
  selectPlantIntelligenceEvryEffect,
} from "./effects";
import {
  executePlantIntelligenceEvryRead,
  selectPlantIntelligenceEvryRead,
} from "./reads";
import {
  PLANT_INTELLIGENCE_PLAN_REGISTRY,
  PLANT_INTELLIGENCE_REVIEW_REGISTRY,
} from "./runtime";

type Dependencies = Readonly<{
  findPlan: typeof findEvryActionPlanByRequestKey;
  propose: typeof proposePlantIntelligenceEvryEffect;
}>;

const productionDependencies: Dependencies = {
  findPlan: findEvryActionPlanByRequestKey,
  propose: proposePlantIntelligenceEvryEffect,
};

function recoveredPlanResult(
  stored: StoredEvryActionPlan,
  expectedIdentity: string
) {
  if (!validateStoredEvryActionPlan(stored, PLANT_INTELLIGENCE_PLAN_REGISTRY))
    throw new Error(
      "Stored Plant Intelligence plan failed integrity validation"
    );
  const document = parseStoredEvryActionPlan({
    document: stored.document,
    registry: PLANT_INTELLIGENCE_PLAN_REGISTRY,
  });
  if (
    document.steps.length !== 1 ||
    document.steps[0]?.capabilityIdentity !== expectedIdentity
  )
    throw new Error(
      "Stored Plant Intelligence plan does not match the request"
    );
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: PLANT_INTELLIGENCE_REVIEW_REGISTRY,
  });
  if (!review)
    throw new Error("Stored Plant Intelligence plan has no trusted review");
  return {
    body: "Review this exact Plant Intelligence change before anything is saved.",
    artifacts: [parseEvryConversationArtifactDocument(review.confirmation)],
    activePlan: { mode: "set" as const, plan },
  };
}

function refusalArtifact() {
  return storedEvryReadArtifactDocument(
    buildEvryReadArtifact({
      title: "Plant Intelligence change unavailable",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [
        {
          reason:
            "Unavailable in this plant, not permitted, or no longer current",
          count: 1,
        },
      ],
      items: [],
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open Plant Intelligence",
          href: "/phase",
        }),
      ],
    })
  );
}

export function createPlantIntelligenceEvryConversationContinuation(
  dependencies: Dependencies = productionDependencies
): EvryCapabilityConversationContinuation {
  return {
    identity: "plant-intelligence",
    matches(input) {
      return Boolean(
        selectPlantIntelligenceEvryRead(
          input.literalUserText,
          input.pageContext
        ) ?? selectPlantIntelligenceEvryEffect(input.literalUserText)
      );
    },
    async continue(input) {
      const read = selectPlantIntelligenceEvryRead(
        input.literalUserText,
        input.pageContext
      );
      if (read) {
        const artifact = await executePlantIntelligenceEvryRead(read);
        return artifact?.kind === "read"
          ? {
              body: artifact.title,
              artifacts: [storedEvryReadArtifactDocument(artifact)],
            }
          : null;
      }
      const selection = selectPlantIntelligenceEvryEffect(
        input.literalUserText
      );
      if (!selection) return null;
      const expectedIdentity = plantIntelligenceEffectIdentityFor(selection);
      const requestKey = deriveEvryPlanRequestKey(
        `plant-intelligence-${selection.kind}`,
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
      if (stored) return recoveredPlanResult(stored, expectedIdentity);
      const contextAssessmentId =
        input.pageContext?.kind === "plant_intelligence"
          ? input.pageContext.recordId
          : null;
      const proposal = await dependencies.propose({
        actor: input.actor,
        selection,
        requestKey,
        contextAssessmentId,
      });
      if (proposal.kind === "refusal")
        return {
          body: "That Plant Intelligence change is unavailable.",
          artifacts: [refusalArtifact()],
        };
      return {
        body: "Review this exact Plant Intelligence change before anything is saved.",
        artifacts: [
          parseEvryConversationArtifactDocument(proposal.confirmation),
        ],
        activePlan: { mode: "set", plan: proposal.plan },
      };
    },
  };
}

export const continuePlantIntelligenceEvryConversation =
  createPlantIntelligenceEvryConversationContinuation();
