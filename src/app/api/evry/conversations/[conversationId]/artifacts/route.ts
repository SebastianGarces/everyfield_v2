import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  createEvryArtifactLifecycle,
  evryArtifactLifecycleRequestSchema,
  type EvryArtifactLifecycleResult,
  type EvryArtifactLifecycleRequest,
} from "@/lib/evry/artifacts/lifecycle";
import { revalidateProductionEvryConversationPlan } from "@/lib/evry/conversations/plan-resume";
import {
  appendTrustedEvryConversationMessage,
  resumeEvryConversation,
} from "@/lib/evry/conversations/service";
import {
  requireEvryPlantViewer,
  type EvryPlantActor,
} from "@/lib/evry/eligibility/viewer";
import {
  createEvryExecutionCapabilityRegistry,
  executeEvryActionPlan,
} from "@/lib/evry/executor";
import {
  confirmEvryActionPlan,
  createEvryPlanCapabilityRegistry,
} from "@/lib/evry/plans";
import { cancelExactEvryActionPlan } from "@/lib/evry/plans/repository";

import {
  evryConversationJson,
  evryConversationViewerRefusal,
  publicEvryConversation,
} from "../../shared";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.strictObject({ conversationId: z.string().uuid() });

type RunLifecycle = (input: {
  actor: EvryPlantActor;
  conversationId: string;
  request: EvryArtifactLifecycleRequest;
}) => Promise<EvryArtifactLifecycleResult>;

export type EvryArtifactLifecyclePostOptions = Readonly<{
  runLifecycle: RunLifecycle;
  correlationId?: () => string;
}>;

type RouteContext = Readonly<{
  params: Promise<{ conversationId: string }>;
}>;

/** Authenticate before parsing any caller-selected conversation or plan bytes. */
export function createEvryArtifactLifecyclePost({
  runLifecycle,
  correlationId = randomUUID,
}: EvryArtifactLifecyclePostOptions) {
  return async function evryArtifactLifecyclePost(
    request: Request,
    context: RouteContext
  ): Promise<Response> {
    try {
      const actor = await requireEvryPlantViewer();
      const params = routeParamsSchema.safeParse(await context.params);
      if (!params.success) {
        return evryConversationJson({ status: "invalid" }, 400);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return evryConversationJson({ status: "invalid" }, 400);
      }
      const parsed = evryArtifactLifecycleRequestSchema.safeParse(body);
      if (!parsed.success) {
        return evryConversationJson({ status: "invalid" }, 400);
      }

      const result = await runLifecycle({
        actor,
        conversationId: params.data.conversationId,
        request: parsed.data,
      });
      if (result.status === "unavailable") {
        return evryConversationJson(
          {
            status: "unavailable",
            error: { kind: "expected", message: result.message },
          },
          409
        );
      }
      return evryConversationJson({
        status: result.status,
        conversation: publicEvryConversation(result.resumed),
      });
    } catch (error) {
      const refusal = evryConversationViewerRefusal(error);
      if (refusal) return refusal;
      const supportId = correlationId();
      console.error("Unexpected Evry artifact lifecycle failure", {
        correlationId: supportId,
        error,
      });
      return evryConversationJson(
        {
          status: "failed",
          error: { kind: "unexpected", correlationId: supportId },
        },
        500
      );
    }
  };
}

// Capability packs compose these closed registries in their integration wave.
// Until then a persisted plan cannot become confirmable or executable.
const productionPlanRegistry = createEvryPlanCapabilityRegistry([]);
const productionExecutionRegistry = createEvryExecutionCapabilityRegistry([]);

const runProductionLifecycle = createEvryArtifactLifecycle({
  planRegistry: productionPlanRegistry,
  executionRegistry: productionExecutionRegistry,
  revalidatePlan: revalidateProductionEvryConversationPlan,
  resume: resumeEvryConversation,
  append: appendTrustedEvryConversationMessage,
  confirm: confirmEvryActionPlan,
  execute: executeEvryActionPlan,
  cancel: cancelExactEvryActionPlan,
  now: () => new Date(),
});

export const POST = createEvryArtifactLifecyclePost({
  runLifecycle: runProductionLifecycle,
});
