import type { EvryPageContext } from "@/lib/evry/resolvers/contract";

export type EvrySubmission = Readonly<{
  conversationId: string | null;
  message: string;
  pageContext: EvryPageContext | null;
}>;

export type PendingEvrySubmission = EvrySubmission &
  Readonly<{ requestKey: string }>;

/** Refuse whitespace-only drafts without changing the bytes that are sent. */
export function evrySubmissionMessage(draft: string): string | null {
  return draft.trim().length === 0 ? null : draft;
}

function samePageContext(
  left: EvryPageContext | null,
  right: EvryPageContext | null
): boolean {
  return (
    left === right ||
    (left !== null &&
      right !== null &&
      left.kind === right.kind &&
      left.recordId === right.recordId)
  );
}

function sameSubmission(
  left: PendingEvrySubmission,
  right: EvrySubmission
): boolean {
  return (
    left.conversationId === right.conversationId &&
    left.message === right.message &&
    samePageContext(left.pageContext, right.pageContext)
  );
}

/** Reuse the idempotency key only for an exact retry of the same request. */
export function pendingEvrySubmissionFor(
  pending: PendingEvrySubmission | null,
  submission: EvrySubmission,
  mintRequestKey: () => string
): PendingEvrySubmission {
  return pending !== null && sameSubmission(pending, submission)
    ? pending
    : { ...submission, requestKey: mintRequestKey() };
}

export type EvryConversationLoadAttempt = Readonly<{
  conversationId: string;
  ordinal: number;
}>;

export type EvryConversationLoadState = Readonly<{
  latest: EvryConversationLoadAttempt | null;
  nextOrdinal: number;
}>;

export function initialEvryConversationLoadState(): EvryConversationLoadState {
  return { latest: null, nextOrdinal: 1 };
}

export function beginEvryConversationLoad(
  state: EvryConversationLoadState,
  conversationId: string
): Readonly<{
  attempt: EvryConversationLoadAttempt;
  state: EvryConversationLoadState;
}> {
  const attempt = { conversationId, ordinal: state.nextOrdinal };
  return {
    attempt,
    state: { latest: attempt, nextOrdinal: state.nextOrdinal + 1 },
  };
}

export function isLatestEvryConversationLoad(
  state: EvryConversationLoadState,
  attempt: EvryConversationLoadAttempt
): boolean {
  return (
    state.latest?.ordinal === attempt.ordinal &&
    state.latest.conversationId === attempt.conversationId
  );
}

export function canApplyEvryConversationLoadResponse(
  state: EvryConversationLoadState,
  attempt: EvryConversationLoadAttempt,
  responseConversationId: string
): boolean {
  return (
    isLatestEvryConversationLoad(state, attempt) &&
    responseConversationId === attempt.conversationId
  );
}

export function isEvryConversationLoading(
  state: EvryConversationLoadState,
  conversationId: string
): boolean {
  return state.latest?.conversationId === conversationId;
}

export function finishEvryConversationLoad(
  state: EvryConversationLoadState,
  attempt: EvryConversationLoadAttempt
): Readonly<{ applies: boolean; state: EvryConversationLoadState }> {
  if (!isLatestEvryConversationLoad(state, attempt)) {
    return { applies: false, state };
  }
  return { applies: true, state: { ...state, latest: null } };
}

/** Make every in-flight completion stale when the workspace is left. */
export function cancelEvryConversationLoads(
  state: EvryConversationLoadState
): EvryConversationLoadState {
  return { ...state, latest: null };
}
