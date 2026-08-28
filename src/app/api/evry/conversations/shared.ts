import { NextResponse } from "next/server";

import { isUnauthorized } from "@/lib/auth/unauthorized";
import type { EvryResumedConversation } from "@/lib/evry/conversations/service";
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

export function publicEvryConversation(resumed: EvryResumedConversation) {
  const { conversation } = resumed;
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt.toISOString(),
    lastActivityAt: conversation.lastActivityAt.toISOString(),
    activePlan: resumed.activePlan,
    stateVersion: conversation.stateVersion,
    state: conversation.state,
    messages: conversation.messages.map((message) => ({
      id: message.id,
      sequence: message.sequence,
      author: message.author,
      body: message.body,
      pageContext: message.pageContext,
      deliveryStatus: message.deliveryStatus,
      createdAt: message.createdAt.toISOString(),
      artifacts: message.artifacts.map(({ id, ordinal, artifact }) => ({
        id,
        ordinal,
        artifact,
      })),
    })),
  };
}
