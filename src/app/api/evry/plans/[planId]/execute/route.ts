import { NextResponse } from "next/server";
import { z } from "zod";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import {
  PRODUCTION_EVRY_EXECUTION_REGISTRY,
  executeProductionEvryActionPlan,
} from "@/lib/evry/capabilities/production";
import {
  executeEvryActionPlan,
  type EvryExecutionCapabilityRegistry,
} from "@/lib/evry/executor";
import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewer,
  type EvryPlantActor,
} from "@/lib/evry/eligibility/viewer";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.strictObject({ planId: z.string().uuid() });
const executionBodySchema = z.strictObject({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});
const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

function privateJson(body: unknown, status: number = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function viewerRefusal(error: unknown): NextResponse | null {
  if (isUnauthorized(error)) {
    return privateJson({ status: "unavailable", steps: [] }, 401);
  }
  if (error instanceof EvryPlantViewerRefusalError) {
    return privateJson({ status: "unavailable", steps: [] }, 404);
  }
  return null;
}

type ExecuteExactPlan = (input: {
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
  registry: EvryExecutionCapabilityRegistry;
}) => ReturnType<typeof executeEvryActionPlan>;

export type EvryPlanExecutePostOptions = Readonly<{
  registry: EvryExecutionCapabilityRegistry;
  execute?: ExecuteExactPlan;
}>;

type RouteContext = Readonly<{ params: Promise<{ planId: string }> }>;

/** Build an auth-first endpoint that accepts no caller-selected work. */
export function createEvryPlanExecutePost({
  registry,
  execute = executeEvryActionPlan,
}: EvryPlanExecutePostOptions): (
  request: Request,
  context: RouteContext
) => Promise<NextResponse> {
  return async function evryPlanExecutePost(request, context) {
    try {
      const actor = await requireEvryPlantViewer();
      const params = routeParamsSchema.safeParse(await context.params);
      if (!params.success) {
        return privateJson({ status: "invalid", steps: [] }, 400);
      }

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return privateJson({ status: "invalid", steps: [] }, 400);
      }
      const parsed = executionBodySchema.safeParse(body);
      if (!parsed.success) {
        return privateJson({ status: "invalid", steps: [] }, 400);
      }

      const result = await execute({
        actor,
        planId: params.data.planId,
        fingerprint: parsed.data.fingerprint,
        registry,
      });
      if (result.status === "unavailable") return privateJson(result, 404);
      if (result.status === "expired") return privateJson(result, 409);
      if (result.status === "retryable") return privateJson(result, 503);
      if (
        result.status === "failed" ||
        result.status === "refused" ||
        result.status === "partially_failed"
      ) {
        return privateJson(result, 409);
      }
      return privateJson(result);
    } catch (error) {
      const refusal = viewerRefusal(error);
      if (refusal) return refusal;
      throw error;
    }
  };
}

export const POST = createEvryPlanExecutePost({
  registry: PRODUCTION_EVRY_EXECUTION_REGISTRY,
  execute: executeProductionEvryActionPlan,
});
