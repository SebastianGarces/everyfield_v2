import { NextResponse } from "next/server";
import { z } from "zod";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewer,
  type EvryPlantActor,
} from "@/lib/evry/eligibility/viewer";
import {
  findOwnEvryAuditProjection,
  type EvryAuditProjection,
} from "@/lib/evry/audit";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.strictObject({ planId: z.string().uuid() });
const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

function privateJson(body: unknown, status: number = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

type FindAudit = (input: {
  actor: EvryPlantActor;
  planId: string;
}) => Promise<EvryAuditProjection | null>;

async function findAudit(input: {
  actor: EvryPlantActor;
  planId: string;
}): Promise<EvryAuditProjection | null> {
  return findOwnEvryAuditProjection({
    planId: input.planId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
  });
}

export type EvryPlanAuditGetOptions = Readonly<{
  find?: FindAudit;
}>;

type RouteContext = Readonly<{ params: Promise<{ planId: string }> }>;

/** Build an auth-first, originating-actor-only audit endpoint. */
export function createEvryPlanAuditGet({
  find = findAudit,
}: EvryPlanAuditGetOptions = {}): (
  request: Request,
  context: RouteContext
) => Promise<NextResponse> {
  return async function evryPlanAuditGet(_request, context) {
    try {
      // FIRST. A path id is not inspected before fresh session-derived plant
      // authority. The repository repeats both actor and plant predicates.
      const actor = await requireEvryPlantViewer();

      const params = routeParamsSchema.safeParse(await context.params);
      if (!params.success) return privateJson({ status: "unavailable" }, 404);

      const audit = await find({ actor, planId: params.data.planId });
      if (!audit) return privateJson({ status: "unavailable" }, 404);
      return privateJson({ status: "available", audit });
    } catch (error) {
      if (isUnauthorized(error)) {
        return privateJson({ status: "unavailable" }, 401);
      }
      if (error instanceof EvryPlantViewerRefusalError) {
        return privateJson({ status: "unavailable" }, 404);
      }
      throw error;
    }
  };
}

export const GET = createEvryPlanAuditGet();
