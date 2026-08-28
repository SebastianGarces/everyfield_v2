import { NextResponse } from "next/server";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import {
  EvryPlantViewerRefusalError,
  requireEvryPlantViewer,
} from "@/lib/evry/eligibility/viewer";
import {
  createEvryPlantDateTimeRequestResolver,
  type EvryDateTimeClock,
  type EvryDateTimeResolution,
} from "@/lib/evry/resolvers/datetime";

export const dynamic = "force-dynamic";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

function privateJson(body: unknown, status: number = 200): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

function resolutionResponse(resolution: EvryDateTimeResolution): NextResponse {
  if (resolution.status !== "refused") return privateJson(resolution);

  switch (resolution.reason) {
    case "invalid-request":
      return privateJson({ status: "invalid" }, 400);
    case "capability-refused":
      return privateJson({ status: "refused" }, 403);
    case "plant-unavailable":
    case "invalid-stored-plant-time-zone":
      return privateJson({ status: "unavailable" }, 503);
  }
}

/** Bind the server clock without exposing it as a wire field. */
export function createEvryDateTimeResolvePost({
  now,
}: EvryDateTimeClock): (request: Request) => Promise<NextResponse> {
  const resolve = createEvryPlantDateTimeRequestResolver({ now });

  return async function evryDateTimeResolvePost(request: Request) {
    try {
      // Gate body parsing, then re-mint capability authority in the resolver.
      await requireEvryPlantViewer();

      let body: unknown;
      try {
        body = await request.json();
      } catch {
        return privateJson({ status: "invalid" }, 400);
      }

      return resolutionResponse(await resolve(body));
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

/** Backend request proof and future action-planning adapter for EV-036. */
export const POST = createEvryDateTimeResolvePost({ now: () => new Date() });
