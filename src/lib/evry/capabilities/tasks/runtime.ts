import {
  trustedReviewForEvryPlanDocument,
  type EvryArtifactReviewRegistry,
} from "@/lib/evry/artifacts/trusted-plan-review";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import type { EvryConversationPlanTargetValidator } from "@/lib/evry/conversations/plan-resume";
import {
  authorizeEvryEffectCapability,
  eligibleEvryCapabilitiesFor,
} from "@/lib/evry/eligibility/capabilities";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  createEvryExecutionCapabilityRegistry,
  defineEvryExecutionCapability,
  type EvryExecutionCapabilityRegistry,
} from "@/lib/evry/executor";
import {
  parseEvryActionPlanCandidate,
  type EvryPlanRequestKey,
} from "@/lib/evry/plans";
import { createEvryActionPlanRecord } from "@/lib/evry/plans/repository";
import { defineEvryPlanCapability } from "@/lib/evry/plans/registry";

import {
  taskEffectArgumentsAreCurrent,
  executeTaskEffect,
} from "./atomic-effect";
import { TASK_ACTION_CONTRACTS } from "./contracts";
import {
  TASKS_EFFECT_ARGUMENT_SCHEMAS,
  TASKS_EFFECT_ARGUMENT_SHAPES,
  type TaskEffectExport,
} from "./effect-contracts";
import { TASK_REVIEW_REGISTRY } from "./review";
import type { ResolvedTaskEffect } from "./resolver";

const EFFECT_EXPORTS = Object.keys(
  TASKS_EFFECT_ARGUMENT_SCHEMAS
) as TaskEffectExport[];

const PLAN_BY_EXPORT = Object.fromEntries(
  EFFECT_EXPORTS.map((exportName) => [
    exportName,
    defineEvryPlanCapability({
      identity: TASK_ACTION_CONTRACTS[exportName].operationId,
      effectClass: "database_write",
      arguments: TASKS_EFFECT_ARGUMENT_SHAPES[exportName],
    }),
  ])
) as Record<TaskEffectExport, ReturnType<typeof defineEvryPlanCapability>>;

export const TASK_PLAN_CAPABILITIES = Object.freeze(
  Object.values(PLAN_BY_EXPORT)
);

export const TASK_EXECUTION_CAPABILITIES = Object.freeze(
  EFFECT_EXPORTS.map((exportName) =>
    defineEvryExecutionCapability({
      planCapability: PLAN_BY_EXPORT[exportName],
      executeIfCurrent: executeTaskEffect,
    })
  )
);

export const TASK_EXECUTION_REGISTRY: EvryExecutionCapabilityRegistry =
  createEvryExecutionCapabilityRegistry(TASK_EXECUTION_CAPABILITIES);
export const TASK_PLAN_REGISTRY = TASK_EXECUTION_REGISTRY.planRegistry;
export const TASK_ARTIFACT_REVIEW_REGISTRY: EvryArtifactReviewRegistry =
  TASK_REVIEW_REGISTRY;

const EXPORT_BY_IDENTITY = new Map(
  Object.entries(TASK_ACTION_CONTRACTS).flatMap(([exportName, contract]) =>
    contract.operationKind === "effect"
      ? [[contract.operationId, exportName as TaskEffectExport] as const]
      : []
  )
);

export async function proposeTaskEvryEffect(input: {
  actor: EvryPlantActor;
  resolved: ResolvedTaskEffect;
  requestKey: EvryPlanRequestKey;
}) {
  const { exportName, arguments: resolvedArguments } = input.resolved;
  const contract = TASK_ACTION_CONTRACTS[exportName];
  const authorization = await authorizeEvryEffectCapability(
    contract.operationId
  );
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  ) {
    return null;
  }
  const parsed =
    TASKS_EFFECT_ARGUMENT_SCHEMAS[exportName].safeParse(resolvedArguments);
  if (!parsed.success || parsed.data.operation !== exportName) return null;
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: contract.operationId,
          capabilityIdentity: contract.operationId,
          arguments: parsed.data,
          dependsOn: [],
        },
      ],
    },
    registry: TASK_PLAN_REGISTRY,
    eligibleCapabilities: eligibleEvryCapabilitiesFor(authorization.actor),
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
    reviewRegistry: TASK_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

/** Read-only stale-confirmation gate; execution repeats every predicate. */
export const taskEvryPlanTargetIsCurrent: EvryConversationPlanTargetValidator =
  async ({ actor, step }) => {
    const exportName = EXPORT_BY_IDENTITY.get(step.capabilityIdentity);
    if (!exportName) return false;
    const parsed = TASKS_EFFECT_ARGUMENT_SCHEMAS[exportName].safeParse(
      step.arguments
    );
    return parsed.success
      ? taskEffectArgumentsAreCurrent({
          actorUserId: actor.userId,
          plantId: actor.plantId,
          exportName,
          args: parsed.data,
        })
      : false;
  };

export const TASK_EFFECT_EXPORTS: readonly TaskEffectExport[] =
  Object.freeze(EFFECT_EXPORTS);
