import { createEvryArtifactReviewRegistry } from "@/lib/evry/artifacts/trusted-plan-review";
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
} from "@/lib/evry/executor";
import {
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
import { defineEvryPlanCapability } from "@/lib/evry/plans/registry";
import { trustedReviewForEvryPlanDocument } from "@/lib/evry/artifacts/trusted-plan-review";

import { executeTeamsEffect } from "./atomic-effect";
import { TEAMS_CAPABILITIES } from "./catalog";
import {
  TEAMS_EFFECT_ARGUMENT_SHAPE,
  TEAMS_EFFECT_IDENTITY_BY_OPERATION,
  parseTeamsEffectArguments,
  type TeamsEffectOperation,
} from "./effect-contracts";
import { TEAMS_ARTIFACT_REVIEWS } from "./review";
import {
  teamsEffectArgumentsAreCurrent,
  type ResolvedTeamsEffect,
} from "./resolver";

const PLAN_BY_OPERATION = Object.fromEntries(
  Object.entries(TEAMS_EFFECT_IDENTITY_BY_OPERATION).map(
    ([operation, identity]) => [
      operation,
      defineEvryPlanCapability({
        identity,
        effectClass: "database_write",
        arguments: TEAMS_EFFECT_ARGUMENT_SHAPE,
      }),
    ]
  )
) as Record<TeamsEffectOperation, ReturnType<typeof defineEvryPlanCapability>>;

export const TEAMS_EXECUTION_CAPABILITIES = Object.freeze(
  Object.values(PLAN_BY_OPERATION).map((planCapability) =>
    defineEvryExecutionCapability({
      planCapability,
      executeIfCurrent: executeTeamsEffect,
    })
  )
);
export const TEAMS_EXECUTION_REGISTRY = createEvryExecutionCapabilityRegistry(
  TEAMS_EXECUTION_CAPABILITIES
);
export const TEAMS_PLAN_REGISTRY = TEAMS_EXECUTION_REGISTRY.planRegistry;
export const TEAMS_REVIEW_REGISTRY = createEvryArtifactReviewRegistry(
  TEAMS_ARTIFACT_REVIEWS
);

const OPERATION_BY_IDENTITY = new Map(
  Object.entries(TEAMS_EFFECT_IDENTITY_BY_OPERATION).map(
    ([operation, identity]) => [identity, operation as TeamsEffectOperation]
  )
);

export async function proposeTeamsEvryEffect(input: {
  actor: EvryPlantActor;
  resolved: ResolvedTeamsEffect;
  requestKey: EvryPlanRequestKey;
}) {
  const identity = TEAMS_EFFECT_IDENTITY_BY_OPERATION[input.resolved.operation];
  const authorization = await authorizeEvryEffectCapability(identity);
  if (
    !authorization ||
    authorization.actor.userId !== input.actor.userId ||
    authorization.actor.plantId !== input.actor.plantId
  )
    return null;
  let args;
  try {
    args = parseTeamsEffectArguments(
      input.resolved.operation,
      input.resolved.arguments
    );
  } catch {
    return null;
  }
  const document = parseEvryActionPlanCandidate({
    candidate: {
      steps: [
        {
          id: identity,
          capabilityIdentity: identity,
          arguments: args,
          dependsOn: [],
        },
      ],
    },
    registry: TEAMS_PLAN_REGISTRY,
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
    reviewRegistry: TEAMS_REVIEW_REGISTRY,
  });
  return review ? { plan, confirmation: review.confirmation } : null;
}

function proposalFromStored(
  stored: StoredEvryActionPlan,
  expectedIdentity: string
) {
  if (!validateStoredEvryActionPlan(stored, TEAMS_PLAN_REGISTRY))
    throw new Error("Stored Teams plan failed its integrity check");
  const document = parseStoredEvryActionPlan({
    document: stored.document,
    registry: TEAMS_PLAN_REGISTRY,
  });
  const step = document.steps[0];
  if (
    !step ||
    document.steps.length !== 1 ||
    step.capabilityIdentity !== expectedIdentity
  )
    throw new Error(
      "Stored Teams plan does not match the request-bound operation"
    );
  const plan = evryConversationPlanIdentitySchema.parse({
    planId: stored.id,
    fingerprint: stored.fingerprint,
  });
  const review = trustedReviewForEvryPlanDocument({
    plan,
    document,
    reviewRegistry: TEAMS_REVIEW_REGISTRY,
  });
  if (!review) throw new Error("Stored Teams plan is not reviewable");
  return { plan, confirmation: review.confirmation };
}

export async function recoverTeamsEvryEffectProposal(input: {
  actor: EvryPlantActor;
  expectedOperation: TeamsEffectOperation;
  requestKey: EvryPlanRequestKey;
  findPlan?: typeof findEvryActionPlanByRequestKey;
}) {
  const stored = await (input.findPlan ?? findEvryActionPlanByRequestKey)({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey: input.requestKey,
  });
  return stored
    ? proposalFromStored(
        stored,
        TEAMS_EFFECT_IDENTITY_BY_OPERATION[input.expectedOperation]
      )
    : null;
}

export const teamsEvryPlanTargetIsCurrent: EvryConversationPlanTargetValidator =
  async ({ actor, step }) => {
    const operation = OPERATION_BY_IDENTITY.get(step.capabilityIdentity);
    return operation
      ? teamsEffectArgumentsAreCurrent({
          plantId: actor.plantId,
          operation,
          arguments: step.arguments,
        })
      : false;
  };

if (
  TEAMS_CAPABILITIES.filter(({ operationKind }) => operationKind === "effect")
    .length !== TEAMS_EXECUTION_CAPABILITIES.length
) {
  throw new Error("Every Teams effect must install an execution capability");
}
