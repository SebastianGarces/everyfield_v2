import { eligibleEvryCapabilitiesFor } from "@/lib/evry/eligibility/capabilities";
import {
  PRODUCTION_EVRY_PLAN_REGISTRY,
  productionEvryPlanTargetIsCurrent,
} from "@/lib/evry/capabilities/production";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { validateStoredEvryActionPlan } from "@/lib/evry/plans/integrity";
import {
  isTerminalEvryPlanStatus,
  type EvryPlanStatus,
} from "@/lib/evry/plans/lifecycle";
import {
  findExactEvryActionPlan,
  type StoredEvryActionPlan,
} from "@/lib/evry/plans/repository";
import type { EvryPlanCapabilityRegistry } from "@/lib/evry/plans/registry";
import {
  parseStoredEvryActionPlan,
  type EvryActionStep,
} from "@/lib/evry/plans/schema";

import type { EvryRevalidatedActivePlan } from "./context";
import {
  evryConversationPlanIdentitySchema,
  type EvryConversationPlanIdentity,
} from "./contract";

export type EvryConversationPlanResumeRevalidator = (input: {
  actor: EvryPlantActor;
  identity: EvryConversationPlanIdentity;
  checkedAt: Date;
}) => Promise<EvryRevalidatedActivePlan>;

export type EvryConversationPlanTargetValidator = (input: {
  actor: EvryPlantActor;
  plan: StoredEvryActionPlan;
  step: EvryActionStep;
  checkedAt: Date;
}) => Promise<boolean>;

type PlanResumeBoundaries = Readonly<{
  registry: EvryPlanCapabilityRegistry;
  loadExact: typeof findExactEvryActionPlan;
  eligibleCapabilitiesForActor(
    actor: EvryPlantActor
  ): readonly Readonly<{ identity: string }>[];
  targetIsCurrent: EvryConversationPlanTargetValidator;
}>;

function stale(
  identity: EvryConversationPlanIdentity
): EvryRevalidatedActivePlan {
  return Object.freeze({
    identity,
    status: "stale" as const,
    expiresAt: null,
    confirmable: false,
  });
}

function currentPlan(
  stored: StoredEvryActionPlan,
  checkedAt: Date
): EvryRevalidatedActivePlan & Readonly<{ status: EvryPlanStatus }> {
  const expiredBeforeExecution =
    (stored.status === "awaiting_confirmation" ||
      stored.status === "approved") &&
    stored.expiresAt <= checkedAt;
  const status = expiredBeforeExecution ? "expired" : stored.status;
  return Object.freeze({
    identity: evryConversationPlanIdentitySchema.parse({
      planId: stored.id,
      fingerprint: stored.fingerprint,
    }),
    status,
    expiresAt: stored.expiresAt.toISOString(),
    confirmable: status === "awaiting_confirmation",
  });
}

/**
 * Compose a trusted read-only resume boundary for an installed capability pack.
 * It reparses the exact stored plan, rechecks current actor eligibility, and
 * lets each capability validate its target/preconditions without applying it.
 */
export function createEvryConversationPlanResumeRevalidator(
  boundaries: PlanResumeBoundaries
): EvryConversationPlanResumeRevalidator {
  return async function revalidate({ actor, identity, checkedAt }) {
    const stored = await boundaries.loadExact({
      planId: identity.planId,
      actorUserId: actor.userId,
      plantId: actor.plantId,
      fingerprint: identity.fingerprint,
    });
    if (
      !stored ||
      stored.id !== identity.planId ||
      stored.actorUserId !== actor.userId ||
      stored.plantId !== actor.plantId ||
      stored.fingerprint !== identity.fingerprint
    ) {
      return stale(identity);
    }

    // The exact plan row is immutable. Once its separate lifecycle row reaches
    // a terminal status, that historical fact remains authoritative even when
    // its capability pack is later retired or the actor loses permission.
    // Clock-expired pending plans are terminal for the same reason.
    const revalidated = currentPlan(stored, checkedAt);
    if (isTerminalEvryPlanStatus(revalidated.status)) return revalidated;

    if (!validateStoredEvryActionPlan(stored, boundaries.registry)) {
      return stale(identity);
    }

    const document = parseStoredEvryActionPlan({
      document: stored.document,
      registry: boundaries.registry,
    });
    const eligible = new Set(
      boundaries
        .eligibleCapabilitiesForActor(actor)
        .map(({ identity: capabilityIdentity }) => capabilityIdentity)
    );
    if (document.steps.some((step) => !eligible.has(step.capabilityIdentity))) {
      return stale(identity);
    }

    if (
      revalidated.status === "draft" ||
      revalidated.status === "awaiting_confirmation" ||
      revalidated.status === "approved"
    ) {
      for (const step of document.steps) {
        if (
          !(await boundaries.targetIsCurrent({
            actor,
            plan: stored,
            step,
            checkedAt,
          }))
        ) {
          return stale(identity);
        }
      }
    }
    return revalidated;
  };
}

export const revalidateProductionEvryConversationPlan =
  createEvryConversationPlanResumeRevalidator({
    registry: PRODUCTION_EVRY_PLAN_REGISTRY,
    loadExact: findExactEvryActionPlan,
    eligibleCapabilitiesForActor: eligibleEvryCapabilitiesFor,
    targetIsCurrent: productionEvryPlanTargetIsCurrent,
  });
