import { z } from "zod";

import {
  evryConversationFailure,
  evryConversationJson,
} from "@/app/api/evry/conversations/shared";
import { requireEvryPlantViewer } from "@/lib/evry/eligibility/viewer";
import { recoverEvryActiveRun } from "@/lib/evry/runs/service";
import { resumeEvryActiveRun } from "@/lib/evry/runs/resume";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.strictObject({ requestId: z.string().uuid() });
type RouteContext = Readonly<{
  params: Promise<{ requestId: string }>;
}>;

export type EvryRunRecoveryGetOptions = Readonly<{
  recover?: typeof recoverEvryActiveRun;
  now?: () => Date;
}>;

/** Authenticate before inspecting a caller-selected durable run identity. */
export function createEvryRunRecoveryGet({
  recover = recoverEvryActiveRun,
  now = () => new Date(),
}: EvryRunRecoveryGetOptions = {}) {
  return async function evryRunRecoveryGet(
    _request: Request,
    context: RouteContext
  ): Promise<Response> {
    try {
      const actor = await requireEvryPlantViewer();
      const params = routeParamsSchema.safeParse(await context.params);
      if (!params.success) {
        return evryConversationJson({ status: "invalid" }, 400);
      }
      const recovered = await recover({
        actor,
        requestKey: params.data.requestId,
        now: now(),
      });
      return evryConversationJson(recovered, 200);
    } catch (error) {
      return evryConversationFailure(error);
    }
  };
}

export const GET = createEvryRunRecoveryGet();

const resumeBodySchema = z.strictObject({ action: z.literal("resume") });

export type EvryRunResumePostOptions = Readonly<{
  resume?: typeof resumeEvryActiveRun;
  now?: () => Date;
}>;

/** Explicit command boundary for adopting one expired durable execution. */
export function createEvryRunResumePost({
  resume = resumeEvryActiveRun,
  now = () => new Date(),
}: EvryRunResumePostOptions = {}) {
  return async function evryRunResumePost(
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
      if (!resumeBodySchema.safeParse(body).success) {
        return evryConversationJson({ status: "invalid" }, 400);
      }
      return evryConversationJson(
        await resume({
          actor,
          requestKey: params.data.requestId,
          now: now(),
        })
      );
    } catch (error) {
      return evryConversationFailure(error);
    }
  };
}

export const POST = createEvryRunResumePost();
