import { randomUUID } from "node:crypto";

import { z } from "zod";

import {
  evryArtifactLifecycleRequestSchema,
  type EvryArtifactLifecycleResult,
  type EvryArtifactLifecycleRequest,
} from "@/lib/evry/artifacts/lifecycle";
import { runEvryProductionArtifactLifecycle } from "@/lib/evry/artifacts/production-lifecycle";
import {
  evryExecutionActiveRunCoordinator,
  type EvryExecutionActiveRunCoordinator,
} from "@/lib/evry/runs/execution";
import { EvryActiveRunIdentityError } from "@/lib/evry/runs/contract";
import {
  requireEvryPlantViewer,
  type EvryPlantActor,
} from "@/lib/evry/eligibility/viewer";

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
  activeRuns?: EvryExecutionActiveRunCoordinator;
}>;

type RouteContext = Readonly<{
  params: Promise<{ conversationId: string }>;
}>;

/** Authenticate before parsing any caller-selected conversation or plan bytes. */
export function createEvryArtifactLifecyclePost({
  runLifecycle,
  correlationId = randomUUID,
  activeRuns,
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

      let result: EvryArtifactLifecycleResult;
      if (
        activeRuns &&
        (parsed.data.action === "execute" || parsed.data.action === "retry")
      ) {
        const prepared = await activeRuns.prepare({
          actor,
          conversationId: params.data.conversationId,
          request: { ...parsed.data, action: parsed.data.action },
          startedAt: new Date(),
          perform: runLifecycle,
        });
        const activeResult = await activeRuns.run(prepared);
        if (activeResult.status === "active") {
          return evryConversationJson({
            status: "active",
            requestId: prepared.claim.run.requestKey,
            kind: "execution",
            sequence: prepared.claim.run.version,
            stage: "executing",
            conversationId: prepared.claim.run.conversationId,
            expiresAt: prepared.claim.run.expiresAt.toISOString(),
          });
        }
        if (activeResult.status === "durable") {
          return evryConversationJson({
            status: "already_finished",
            conversation: activeResult.conversation,
          });
        }
        result = activeResult.result;
      } else {
        result = await runLifecycle({
          actor,
          conversationId: params.data.conversationId,
          request: parsed.data,
        });
      }
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
      if (error instanceof EvryActiveRunIdentityError) {
        return evryConversationJson(
          {
            status: "unavailable",
            error: {
              kind: "expected",
              message:
                "This request identity is already bound to different work.",
            },
          },
          409
        );
      }
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

export const POST = createEvryArtifactLifecyclePost({
  runLifecycle: runEvryProductionArtifactLifecycle,
  activeRuns: evryExecutionActiveRunCoordinator,
});
