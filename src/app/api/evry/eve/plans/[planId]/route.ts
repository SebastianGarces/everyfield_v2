import { z } from "zod";
import { requireFreshEvryPlantViewer } from "@/lib/evry/eligibility/viewer";
import { requireSameOrigin } from "@/lib/evry/eve/runtime/auth-policy";
import { eveHttpRefusal, privateEveJson } from "@/lib/evry/eve/runtime/http";
import { readEvePlanReview } from "@/lib/evry/eve/runtime/plan-review";
import { cancelExactEvryActionPlan } from "@/lib/evry/plans/repository";
import { confirmEvryActionPlan } from "@/lib/evry/plans";
import {
  PRODUCTION_EVRY_PLAN_REGISTRY,
  executeProductionEvryActionPlan,
} from "@/lib/evry/capabilities/execution";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import { cleanupEvryPeoplePlanAttachments } from "@/lib/evry/capabilities/people/cleanup";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
const identitySchema = evryConversationPlanIdentitySchema;
const bodySchema = z.strictObject({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
  action: z.enum(["confirm", "retry", "cancel", "edit"]),
});
type RouteContext = { params: Promise<{ planId: string }> };

export async function GET(request: Request, context: RouteContext) {
  try {
    const actor = await requireFreshEvryPlantViewer();
    const identity = identitySchema.safeParse({
      ...(await context.params),
      fingerprint: new URL(request.url).searchParams.get("fingerprint"),
    });
    if (!identity.success) return privateEveJson({ status: "invalid" }, 400);
    const result = await readEvePlanReview(actor, identity.data);
    return result
      ? privateEveJson(result)
      : privateEveJson({ status: "unavailable" }, 404);
  } catch (error) {
    const refusal = eveHttpRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const actor = await requireFreshEvryPlantViewer();
    requireSameOrigin(request);
    const body = bodySchema.safeParse(await request.json().catch(() => null));
    if (!body.success) return privateEveJson({ status: "invalid" }, 400);
    const identity = identitySchema.safeParse({
      ...(await context.params),
      fingerprint: body.data.fingerprint,
    });
    if (!identity.success) return privateEveJson({ status: "invalid" }, 400);
    const current = await readEvePlanReview(actor, identity.data);
    if (!current) return privateEveJson({ status: "unavailable" }, 404);
    const { action } = body.data;
    if (action === "cancel" || action === "edit") {
      const cancelled = await cancelExactEvryActionPlan({
        ...identity.data,
        actorUserId: actor.userId,
        plantId: actor.plantId,
        cancelledAt: new Date(),
      });
      if (!cancelled) return privateEveJson({ status: "not_cancellable" }, 409);
      await cleanupEvryPeoplePlanAttachments({ actor, plan: identity.data });
    } else {
      if (action === "confirm") {
        if (
          current.plan.status === "executing" ||
          current.artifact.kind === "result"
        )
          return privateEveJson(current);
        const confirmation = await confirmEvryActionPlan({
          ...identity.data,
          actor,
          registry: PRODUCTION_EVRY_PLAN_REGISTRY,
          decidedAt: new Date(),
        });
        if (
          confirmation.status !== "approved" &&
          confirmation.status !== "already_approved"
        )
          return privateEveJson({ status: confirmation.status }, 409);
      } else if (current.plan.status === "awaiting_confirmation") {
        // Retry is never an alternative way to grant approval.
        return privateEveJson({ status: "not_confirmed" }, 409);
      }
      const execution = await executeProductionEvryActionPlan({
        ...identity.data,
        actor,
      });
      if (execution.status === "unavailable" || execution.status === "expired")
        return privateEveJson({ status: execution.status }, 409);
    }
    const result = await readEvePlanReview(actor, identity.data);
    return result
      ? privateEveJson(result)
      : privateEveJson({ status: "unavailable" }, 404);
  } catch (error) {
    const refusal = eveHttpRefusal(error);
    if (refusal) return refusal;
    throw error;
  }
}
