import {
  parseEvryConversationArtifactDocument,
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
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";

import type { EvryCapabilityConversationContinuation } from "../conversation";
import {
  LAUNCH_EFFECT_IDENTITIES,
  proposeLaunchEvryEffect,
  selectLaunchEvryEffect,
} from "./effects";
import { continueLaunchEvryRead, selectLaunchEvryRead } from "./reads";
import {
  LAUNCH_EVRY_PLAN_REGISTRY,
  LAUNCH_EVRY_REVIEW_REGISTRY,
} from "./runtime";

type Dependencies = Readonly<{
  findPlanByRequestKey: typeof findEvryActionPlanByRequestKey;
  propose: typeof proposeLaunchEvryEffect;
}>;

const productionDependencies: Dependencies = {
  findPlanByRequestKey: findEvryActionPlanByRequestKey,
  propose: proposeLaunchEvryEffect,
};

function identityForSelection(
  selection: NonNullable<ReturnType<typeof selectLaunchEvryEffect>>
) {
  switch (selection.kind) {
    case "schedule":
      return LAUNCH_EFFECT_IDENTITIES.schedule;
    case "complete_milestone":
      return LAUNCH_EFFECT_IDENTITIES.completeMilestone;
    case "reopen_milestone":
      return LAUNCH_EFFECT_IDENTITIES.reopenMilestone;
    case "set_task_completion":
      return LAUNCH_EFFECT_IDENTITIES.setTaskCompletion;
    case "record_outcome":
      return LAUNCH_EFFECT_IDENTITIES.recordOutcome;
    case "correct_outcome":
      return LAUNCH_EFFECT_IDENTITIES.correctOutcome;
  }
}

function recoveredPlanResult(
  stored: StoredEvryActionPlan,
  expectedIdentity: string
) {
  if (!validateStoredEvryActionPlan(stored, LAUNCH_EVRY_PLAN_REGISTRY))
    throw new Error("Stored Launch plan failed integrity validation");
  const document = parseStoredEvryActionPlan({
    document: stored.document,
    registry: LAUNCH_EVRY_PLAN_REGISTRY,
  });
  if (
    document.steps.length !== 1 ||
    document.steps[0]?.capabilityIdentity !== expectedIdentity
  )
    throw new Error("Stored Launch plan does not match the request");
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: LAUNCH_EVRY_REVIEW_REGISTRY,
  });
  if (!review) throw new Error("Stored Launch plan has no trusted review");
  return {
    body: "Review this exact Launch change before anything is saved.",
    artifacts: [parseEvryConversationArtifactDocument(review.confirmation)],
    activePlan: { mode: "set" as const, plan },
  };
}

function refusal() {
  return storedEvryReadArtifactDocument(
    buildEvryReadArtifact({
      title: "Launch change unavailable",
      filters: [{ label: "Plant", value: "Current plant" }],
      exclusions: [
        { reason: "Unavailable in this plant or no longer current", count: 1 },
      ],
      items: [],
      sourceLinks: [
        trustedEvryApplicationSourceLink({
          label: "Open Launch Sunday",
          href: "/launch",
        }),
      ],
    })
  );
}

export function createLaunchEvryConversationContinuation(
  dependencies: Dependencies = productionDependencies
): EvryCapabilityConversationContinuation {
  return {
    identity: "launch",
    matches(input) {
      return Boolean(
        selectLaunchEvryRead(input.literalUserText) ??
        selectLaunchEvryEffect(input.literalUserText)
      );
    },
    async continue(input) {
      const read = selectLaunchEvryRead(input.literalUserText);
      if (read) {
        const artifact = await continueLaunchEvryRead({
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
      const selection = selectLaunchEvryEffect(input.literalUserText);
      if (!selection) return null;
      const expectedIdentity = identityForSelection(selection);
      const requestKey = deriveEvryPlanRequestKey(
        `launch-${selection.kind.replaceAll("_", "-")}`,
        [
          input.actor.userId,
          input.actor.plantId,
          input.conversation.id,
          input.userRequestKey,
        ]
      );
      const stored = await dependencies.findPlanByRequestKey({
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        requestKey,
      });
      if (stored) return recoveredPlanResult(stored, expectedIdentity);
      const proposal = await dependencies.propose({
        actor: input.actor,
        selection,
        requestKey,
      });
      if (proposal.kind === "refusal")
        return { body: proposal.body, artifacts: [refusal()] };
      return {
        body: "Review this exact Launch change before anything is saved.",
        artifacts: [
          parseEvryConversationArtifactDocument(proposal.confirmation),
        ],
        activePlan: { mode: "set", plan: proposal.plan },
      };
    },
  };
}

export const continueLaunchEvryConversation =
  createLaunchEvryConversationContinuation();
