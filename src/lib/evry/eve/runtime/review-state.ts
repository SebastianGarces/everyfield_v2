import { defineState } from "eve/context";
import { z } from "zod";
import {
  evryConversationPlanIdentitySchema,
  type EvryConversationPlanIdentity,
} from "@/lib/evry/conversations/contract";
import {
  cancelExactEvryActionPlan,
  findExactEvryActionPlan,
} from "@/lib/evry/plans/repository";
import type { EveRuntimeScope } from "./scope";

type PendingReview = { callId: string; plan: EvryConversationPlanIdentity };
export const evryReviewState = defineState<PendingReview | null>(
  "evry.pending-review",
  () => null
);
const activePlanResult = z.object({
  activePlan: z.object({
    mode: z.literal("set"),
    plan: evryConversationPlanIdentitySchema,
  }),
});

export function reviewFromPreparation(
  result: unknown,
  callId: string
): PendingReview | null {
  const parsed = activePlanResult.safeParse(result);
  return parsed.success ? { callId, plan: parsed.data.activePlan.plan } : null;
}

/** New preparation replaces an exact review; replaying its own call never cancels it. */
export async function retirePreviousReview(
  scope: EveRuntimeScope,
  callId: string
): Promise<boolean> {
  const previous = evryReviewState.get();
  if (!previous || previous.callId === callId) return true;
  const identity = {
    ...previous.plan,
    actorUserId: scope.actor.userId,
    plantId: scope.actor.plantId,
  };
  const plan = await findExactEvryActionPlan(identity);
  if (!plan) return false;
  if (plan.status === "executing") return false;
  if (["draft", "awaiting_confirmation", "approved"].includes(plan.status)) {
    if (
      !(await cancelExactEvryActionPlan({
        ...identity,
        cancelledAt: new Date(),
      }))
    )
      return false;
  }
  evryReviewState.update(() => null);
  return true;
}
