import { NextResponse } from "next/server";
import { z } from "zod";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewer,
  type EvryPlantActor,
} from "@/lib/evry/eligibility/viewer";
import {
  confirmEvryActionPlan,
  createEvryPlanCapabilityRegistry,
  type EvryPlanCapabilityRegistry,
} from "@/lib/evry/plans";
import type { ConfirmEvryActionPlanResult } from "@/lib/evry/plans/repository";

export const dynamic = "force-dynamic";

const routeParamsSchema = z.strictObject({ planId: z.string().uuid() });
const confirmationBodySchema = z.strictObject({
  fingerprint: z.string().regex(/^[0-9a-f]{64}$/),
});

const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

function privateJson(body: unknown, status: number = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function viewerRefusal(error: unknown): NextResponse | null {
  if (isUnauthorized(error)) {
    return privateJson({ status: "unavailable" }, 401);
  }
  if (error instanceof EvryPlantViewerRefusalError) {
    return privateJson({ status: "unavailable" }, 404);
  }
  return null;
}

type ConfirmExactPlan = (input: {
  actor: EvryPlantActor;
  planId: string;
  fingerprint: string;
  decidedAt: Date;
  registry: EvryPlanCapabilityRegistry;
}) => Promise<ConfirmEvryActionPlanResult>;

export type EvryPlanConfirmPostOptions = Readonly<{
  registry: EvryPlanCapabilityRegistry;
  confirm?: ConfirmExactPlan;
  now?: () => Date;
}>;

type RouteContext = Readonly<{ params: Promise<{ planId: string }> }>;

/** Build an auth-first exact-fingerprint confirmation endpoint. */
export function createEvryPlanConfirmPost({
  registry,
  confirm = confirmEvryActionPlan,
  now = () => new Date(),
}: EvryPlanConfirmPostOptions): (
  request: Request,
  context: RouteContext
) => Promise<NextResponse> {
  return async function evryPlanConfirmPost(request, context) {
    try {
      // FIRST. Neither a path id nor a request body is parsed before a fresh
      // authenticated actor is minted for the plant scope used by the CAS.
      const actor = await requireEvryPlantViewer();

      const params = routeParamsSchema.safeParse(await context.params);
      if (!params.success) return privateJson({ status: "invalid" }, 400);

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return privateJson({ status: "invalid" }, 400);
      }
      const parsed = confirmationBodySchema.safeParse(body);
      if (!parsed.success) return privateJson({ status: "invalid" }, 400);

      const result = await confirm({
        actor,
        planId: params.data.planId,
        fingerprint: parsed.data.fingerprint,
        decidedAt: now(),
        registry,
      });

      if (result.status === "unavailable") {
        return privateJson(result, 404);
      }
      if (result.status === "expired" || result.status === "not_confirmable") {
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

// Capability packs compose this closed registry in their integration wave.
// Until then production cannot approve a plan whose contract is not installed.
const productionRegistry = createEvryPlanCapabilityRegistry([]);

export const POST = createEvryPlanConfirmPost({
  registry: productionRegistry,
});
