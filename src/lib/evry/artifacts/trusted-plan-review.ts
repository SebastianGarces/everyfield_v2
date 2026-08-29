import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type { EvryPlanCapabilityRegistry } from "@/lib/evry/plans";
import { validateStoredEvryActionPlan } from "@/lib/evry/plans/integrity";
import { findExactEvryActionPlan } from "@/lib/evry/plans/repository";
import { parseStoredEvryActionPlan } from "@/lib/evry/plans/schema";
import type { EvryConversationPlanIdentity } from "@/lib/evry/conversations/contract";

import type { EvryTrustedPlanReview } from "./lifecycle";

/** Reopen the exact fingerprinted plan and project only its trusted disclosure. */
export async function trustedEvryPlanReview(input: {
  actor: EvryPlantActor;
  plan: EvryConversationPlanIdentity;
  registry: EvryPlanCapabilityRegistry;
}): Promise<EvryTrustedPlanReview | null> {
  const stored = await findExactEvryActionPlan({
    planId: input.plan.planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    fingerprint: input.plan.fingerprint,
  });
  if (!stored || !validateStoredEvryActionPlan(stored, input.registry)) {
    return null;
  }
  try {
    const document = parseStoredEvryActionPlan({
      document: stored.document,
      registry: input.registry,
    });
    return Object.freeze({
      confirmation: document.confirmation
        ? Object.freeze({ ...document.confirmation })
        : null,
      steps: Object.freeze(
        document.steps.map((step) =>
          Object.freeze({
            stepId: step.id,
            disclosure: step.disclosure
              ? Object.freeze({
                  title: step.disclosure.title,
                  items: Object.freeze(
                    step.disclosure.items.map((item) =>
                      Object.freeze({ ...item })
                    )
                  ),
                  consequences: Object.freeze([
                    ...step.disclosure.consequences,
                  ]),
                })
              : null,
          })
        )
      ),
    });
  } catch {
    return null;
  }
}
