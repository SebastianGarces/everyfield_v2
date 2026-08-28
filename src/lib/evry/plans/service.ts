import type { EvryAllowedPolicyDecision } from "@/lib/evry/policy";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import { validateStoredEvryActionPlan } from "./integrity";
import {
  confirmExactEvryActionPlan,
  createEvryActionPlanRecord,
  findExactEvryActionPlan,
  reviseExactEvryActionPlan,
  type ConfirmEvryActionPlanResult,
  type ReviseEvryActionPlanResult,
  type StoredEvryActionPlan,
} from "./repository";
import type { EvryPlanRequestKey } from "./request-key";
import type { EvryPlanCapabilityRegistry } from "./registry";
import { parseEvryActionPlanCandidate } from "./schema";

type EvryApplicationActionDecision = Extract<
  EvryAllowedPolicyDecision,
  { classification: "application_action" }
>;

export async function createEvryActionPlan(input: {
  actor: EvryPlantActor;
  policy: EvryApplicationActionDecision;
  candidate: unknown;
  requestKey: EvryPlanRequestKey;
  registry: EvryPlanCapabilityRegistry;
  eligibleCapabilities: readonly Readonly<{ identity: string }>[];
}): Promise<StoredEvryActionPlan> {
  if (input.policy.classification !== "application_action") {
    throw new Error("Only an application action may create an Evry plan");
  }

  const document = parseEvryActionPlanCandidate(input);
  return createEvryActionPlanRecord({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey: input.requestKey,
    document,
  });
}

export async function confirmEvryActionPlan(input: {
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
  decidedAt: Date;
  registry: EvryPlanCapabilityRegistry;
}): Promise<ConfirmEvryActionPlanResult> {
  const exact = await findExactEvryActionPlan({
    planId: input.planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: input.fingerprint,
  });
  if (!exact || !validateStoredEvryActionPlan(exact, input.registry)) {
    return { status: "unavailable" };
  }

  return confirmExactEvryActionPlan({
    planId: input.planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: input.fingerprint,
    decidedAt: input.decidedAt,
  });
}

export async function reviseEvryActionPlan(input: {
  actor: EvryPlantActor;
  oldPlanId: string;
  oldFingerprint: string;
  candidate: unknown;
  requestKey: EvryPlanRequestKey;
  registry: EvryPlanCapabilityRegistry;
  eligibleCapabilities: readonly Readonly<{ identity: string }>[];
}): Promise<ReviseEvryActionPlanResult> {
  const oldPlan = await findExactEvryActionPlan({
    planId: input.oldPlanId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: input.oldFingerprint,
  });
  if (!oldPlan || !validateStoredEvryActionPlan(oldPlan, input.registry)) {
    return { status: "unavailable" };
  }

  const replacementDocument = parseEvryActionPlanCandidate(input);
  return reviseExactEvryActionPlan({
    oldPlanId: input.oldPlanId,
    oldFingerprint: input.oldFingerprint,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey: input.requestKey,
    replacementDocument,
  });
}
