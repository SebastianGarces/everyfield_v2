import { ForbiddenError } from "eve/channels/auth";
import { NextResponse } from "next/server";
import { isUnauthorized } from "@/lib/auth/unauthorized";
import { EvryPlantViewerRefusalError } from "@/lib/evry/eligibility/viewer";

export function privateEveJson(body: unknown, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "cache-control": "private, no-store" },
  });
}

export function eveHttpRefusal(error: unknown) {
  if (isUnauthorized(error))
    return privateEveJson({ status: "unavailable" }, 401);
  if (error instanceof ForbiddenError)
    return privateEveJson({ status: "unavailable" }, 403);
  if (error instanceof EvryPlantViewerRefusalError)
    return privateEveJson({ status: "unavailable" }, 404);
  return null;
}
