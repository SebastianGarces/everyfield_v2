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
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";

import type { EvryCapabilityConversationContinuation } from "../conversation";

import { TASK_ACTION_CONTRACTS } from "./contracts";
import { continueTaskEvryRead, selectTaskEvryRead } from "./reads";
import { resolveTaskEvryEffect } from "./resolver";
import { proposeTaskEvryEffect, TASK_PLAN_REGISTRY } from "./runtime";
import { TASK_REVIEW_REGISTRY } from "./review";
import { selectTaskEvryEffect } from "./selection";

type TaskEvryConversationDependencies = Readonly<{
  findPlanByRequestKey: typeof findEvryActionPlanByRequestKey;
  propose: typeof proposeTaskEvryEffect;
  resolve: typeof resolveTaskEvryEffect;
}>;

const productionDependencies: TaskEvryConversationDependencies = {
  findPlanByRequestKey: findEvryActionPlanByRequestKey,
  propose: proposeTaskEvryEffect,
  resolve: resolveTaskEvryEffect,
};

function taskReadMessage(count: number): string {
  if (count === 0) return "Nothing needs your attention right now.";
  return `I found ${count.toLocaleString()} matching result${count === 1 ? "" : "s"}.`;
}

function unavailableTaskResult() {
  const clarification = {
    kind: "clarification" as const,
    mode: "missing" as const,
    entityType: "task",
    prompt:
      "That Task request is unavailable in this plant or is no longer current. Open the intended Task record and try again.",
  };
  return {
    body: clarification.prompt,
    artifacts: [storedEvryClarificationArtifactDocument(clarification)],
  };
}

function recoveredPlanResult(input: {
  stored: StoredEvryActionPlan;
  expectedIdentity: string;
}) {
  if (!validateStoredEvryActionPlan(input.stored, TASK_PLAN_REGISTRY)) {
    throw new Error("Stored Task plan failed integrity validation");
  }
  const document = parseStoredEvryActionPlan({
    document: input.stored.document,
    registry: TASK_PLAN_REGISTRY,
  });
  if (
    document.steps.length !== 1 ||
    document.steps[0]?.capabilityIdentity !== input.expectedIdentity
  ) {
    throw new Error("Stored Task plan does not match the request");
  }
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: input.stored.id,
    fingerprint: input.stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: TASK_REVIEW_REGISTRY,
  });
  if (!review) throw new Error("Stored Task plan has no trusted review");
  return {
    body: "Review this exact Task change before anything is written.",
    artifacts: [parseEvryConversationArtifactDocument(review.confirmation)],
    activePlan: { mode: "set" as const, plan },
  };
}

/** Closed production continuation for Task reads and reviewed effects. */
export function createTaskEvryConversationContinuation(
  dependencies: TaskEvryConversationDependencies = productionDependencies
): EvryCapabilityConversationContinuation {
  return {
    identity: "tasks",
    matches(input) {
      return Boolean(
        selectTaskEvryRead(input.literalUserText) ??
        selectTaskEvryEffect(input.literalUserText)
      );
    },
    async continue(input) {
      const readSelection = selectTaskEvryRead(input.literalUserText);
      if (readSelection) {
        const artifact = await continueTaskEvryRead({
          eligibleCapabilities: eligibleEvryCapabilitiesFor(input.actor),
          literalUserText: input.literalUserText,
          pageContext: input.requestPageContext,
        });
        if (!artifact) return unavailableTaskResult();
        return artifact.kind === "read"
          ? {
              body: taskReadMessage(artifact.counts.returned),
              artifacts: [storedEvryReadArtifactDocument(artifact)],
            }
          : {
              body: artifact.prompt,
              artifacts: [storedEvryClarificationArtifactDocument(artifact)],
            };
      }

      const selection = selectTaskEvryEffect(input.literalUserText);
      if (!selection) return null;
      const contract = TASK_ACTION_CONTRACTS[selection.exportName];
      const requestKey = deriveEvryPlanRequestKey(
        `tasks-${selection.exportName.replace(/Action$/, "").toLowerCase()}`,
        [
          input.actor.userId,
          input.actor.plantId,
          input.conversation.id,
          input.userRequestKey,
        ]
      );
      // The immutable stored plan is recovered before any mutable target,
      // template, phase-transition, notification, or recurrence source is read.
      const stored = await dependencies.findPlanByRequestKey({
        actorUserId: input.actor.userId,
        plantId: input.actor.plantId,
        requestKey,
      });
      if (stored) {
        return recoveredPlanResult({
          stored,
          expectedIdentity: contract.operationId,
        });
      }
      const resolved = await dependencies.resolve({
        actor: input.actor,
        selection,
        pageContext: input.pageContext,
        requestKey,
        now: input.now,
      });
      if (!resolved) return unavailableTaskResult();
      const proposal = await dependencies.propose({
        actor: input.actor,
        resolved,
        requestKey,
      });
      if (!proposal) return null;
      return {
        body: "Review this exact Task change before anything is written.",
        artifacts: [
          parseEvryConversationArtifactDocument(proposal.confirmation),
        ],
        activePlan: { mode: "set", plan: proposal.plan },
      };
    },
  };
}

export const continueTaskEvryConversation =
  createTaskEvryConversationContinuation();
