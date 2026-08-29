import type { EvryPageContext } from "@/lib/evry/resolvers/contract";

export type EvrySubmission = Readonly<{
  conversationId: string | null;
  message: string;
  pageContext: EvryPageContext | null;
}>;

export type PendingEvrySubmission = EvrySubmission &
  Readonly<{
    requestKey: string;
    target:
      | Readonly<{ kind: "create" }>
      | Readonly<{ kind: "continue"; conversationId: string }>;
    presentedConversationId: string | null;
  }>;

/** The ordinary conversation request contract; UI affordances add no metadata. */
export function evryConversationRequestBody(
  submission: Pick<
    PendingEvrySubmission,
    "requestKey" | "message" | "pageContext"
  >
): string {
  return JSON.stringify({
    requestKey: submission.requestKey,
    message: submission.message,
    pageContext: submission.pageContext,
  });
}

/** Refuse whitespace-only drafts without changing the bytes that are sent. */
export function evrySubmissionMessage(draft: string): string | null {
  return draft.trim().length === 0 ? null : draft;
}

/** Keep any text entered while the accepted request was in flight. */
export function evryDraftAfterSubmission(
  currentDraft: string,
  submittedDraft: string
): string {
  return currentDraft === submittedDraft ? "" : currentDraft;
}

export function evryWorkspaceConversationHref(
  urlConversationId: string | null,
  mountedConversationId: string | null,
  searchQuery: string | null = null
): string | null {
  if (urlConversationId !== null || mountedConversationId === null) return null;
  const params = new URLSearchParams();
  if (searchQuery) params.set("q", searchQuery);
  params.set("conversation", mountedConversationId);
  return `/evry?${params.toString()}`;
}

/** Attach a newly created conversation without dispatching an App Router transition. */
export function syncEvryWorkspaceConversationHistory(
  historyState: unknown,
  nativeReplaceState: (
    data: unknown,
    unused: string,
    url?: string | URL | null
  ) => void,
  urlConversationId: string | null,
  mountedConversationId: string | null,
  searchQuery: string | null = null
): boolean {
  const href = evryWorkspaceConversationHref(
    urlConversationId,
    mountedConversationId,
    searchQuery
  );
  if (href === null) return false;

  nativeReplaceState(historyState, "", href);
  return true;
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
  const sameConversation =
    left.target.kind === "create"
      ? right.conversationId === null ||
        right.conversationId === left.presentedConversationId
      : right.conversationId === left.target.conversationId;
  return (
    sameConversation &&
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
    : {
        ...submission,
        requestKey: mintRequestKey(),
        target:
          submission.conversationId === null
            ? { kind: "create" }
            : {
                kind: "continue",
                conversationId: submission.conversationId,
              },
        presentedConversationId: null,
      };
}

export function pendingEvrySubmissionAfterConversation(
  pending: PendingEvrySubmission,
  requestKey: string,
  conversationId: string
): PendingEvrySubmission {
  return pending.requestKey === requestKey
    ? { ...pending, presentedConversationId: conversationId }
    : pending;
}

export function evryConversationSubmissionEndpoint(
  pending: PendingEvrySubmission
): string {
  return pending.target.kind === "create"
    ? "/api/evry/conversations"
    : `/api/evry/conversations/${encodeURIComponent(pending.target.conversationId)}/messages`;
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

export function shouldFollowEvryTranscript(input: {
  distanceFromEnd: number;
  focusInComposer: boolean;
}): boolean {
  return input.focusInComposer || input.distanceFromEnd <= 80;
}
