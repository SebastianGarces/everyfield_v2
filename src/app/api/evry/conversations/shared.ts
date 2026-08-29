import { NextResponse } from "next/server";

import { isUnauthorized } from "@/lib/auth/unauthorized";
export { publicEvryConversation } from "@/lib/evry/conversations/public";
import { EvryPlantViewerRefusalError } from "@/lib/evry/eligibility/viewer";

const PRIVATE_HEADERS = { "cache-control": "private, no-store" } as const;

export function evryConversationJson(
  body: unknown,
  status: number = 200
): NextResponse {
  return NextResponse.json(body, { status, headers: PRIVATE_HEADERS });
}

export function evryConversationViewerRefusal(
  error: unknown
): NextResponse | null {
  if (isUnauthorized(error)) {
    return evryConversationJson({ status: "unavailable" }, 401);
  }
  if (error instanceof EvryPlantViewerRefusalError) {
    return evryConversationJson({ status: "unavailable" }, 404);
  }
  return null;
}

export function evryConversationFailure(error: unknown): NextResponse {
  const refusal = evryConversationViewerRefusal(error);
  if (refusal) return refusal;
  return evryConversationJson({ status: "unavailable" }, 503);
}
