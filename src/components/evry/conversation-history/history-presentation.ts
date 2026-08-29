import type { PublicEvryConversation } from "@/components/evry/client-contract";
import type {
  EvryConversationActionableState,
  EvryConversationHistoryItem,
} from "@/lib/evry/conversations/history";

export const EVRY_HISTORY_STATE_PRESENTATION = Object.freeze({
  ready: { label: "Ready", tone: "neutral" },
  awaiting_confirmation: { label: "Awaiting review", tone: "attention" },
  running: { label: "In progress", tone: "progress" },
  needs_attention: { label: "Needs attention", tone: "danger" },
  completed: { label: "Completed", tone: "success" },
  rebuild_required: { label: "Rebuild needed", tone: "attention" },
} satisfies Record<
  EvryConversationActionableState,
  Readonly<{
    label: string;
    tone: "neutral" | "attention" | "progress" | "danger" | "success";
  }>
>);

type ActivePlanView = Readonly<{
  status:
    | "draft"
    | "awaiting_confirmation"
    | "approved"
    | "executing"
    | "completed"
    | "partially_failed"
    | "failed"
    | "cancelled"
    | "superseded"
    | "expired"
    | "stale";
  confirmable: boolean;
}>;

function recordOf(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

function activePlanView(value: unknown): ActivePlanView | null {
  const record = recordOf(value);
  if (!record || typeof record.confirmable !== "boolean") return null;
  switch (record.status) {
    case "draft":
    case "awaiting_confirmation":
    case "approved":
    case "executing":
    case "completed":
    case "partially_failed":
    case "failed":
    case "cancelled":
    case "superseded":
    case "expired":
    case "stale":
      return { status: record.status, confirmable: record.confirmable };
    default:
      return null;
  }
}

function latestArtifact(conversation: PublicEvryConversation) {
  for (
    let messageIndex = conversation.messages.length - 1;
    messageIndex >= 0;
    messageIndex -= 1
  ) {
    const message = conversation.messages[messageIndex];
    if (!message) continue;
    for (
      let artifactIndex = message.artifacts.length - 1;
      artifactIndex >= 0;
      artifactIndex -= 1
    ) {
      const artifact = message.artifacts[artifactIndex];
      if (artifact)
        return {
          messageId: message.id,
          messageIndex,
          artifact: artifact.artifact,
        };
    }
  }
  return null;
}

export function evryHistoryStateForConversation(
  conversation: PublicEvryConversation
): EvryConversationActionableState {
  const plan = activePlanView(conversation.activePlan);
  const latest = latestArtifact(conversation);
  const latestDocument = recordOf(latest?.artifact);
  const terminalPlanHasLaterPlainTurn =
    latest !== null && latest.messageIndex < conversation.messages.length - 1;
  const latestArtifactStartsNewWork =
    latestDocument?.kind === "clarification" ||
    latestDocument?.kind === "read" ||
    latestDocument?.kind === "settings_handoff" ||
    latestDocument?.kind === "boundary";
  if (plan) {
    const terminal =
      plan.status === "completed" ||
      plan.status === "partially_failed" ||
      plan.status === "failed" ||
      plan.status === "cancelled" ||
      plan.status === "superseded" ||
      plan.status === "expired";
    if (terminal && terminalPlanHasLaterPlainTurn) return "ready";
    if (terminal && latestArtifactStartsNewWork) {
      return latestDocument?.kind === "clarification"
        ? "needs_attention"
        : "ready";
    }

    switch (plan.status) {
      case "draft":
      case "approved":
      case "executing":
        return "running";
      case "awaiting_confirmation":
        return plan.confirmable ? "awaiting_confirmation" : "rebuild_required";
      case "partially_failed":
      case "failed":
        return "needs_attention";
      case "expired":
      case "stale":
        return "rebuild_required";
      case "completed":
      case "cancelled":
      case "superseded":
        return "completed";
    }
  }

  const artifact = latestDocument;
  if (artifact?.kind === "progress") return "running";
  if (artifact?.kind === "confirmation") return "rebuild_required";
  if (artifact?.kind === "result") {
    return artifact.status === "completed" ? "completed" : "needs_attention";
  }
  return "ready";
}

export type EvryHistoryCheckpoint = Readonly<{
  messageId: string;
  kind: string;
  label: string;
  title: string;
  detail: string | null;
  rebuildRequired: boolean;
}>;

function artifactString(
  artifact: Record<string, unknown>,
  key: string
): string | null {
  const value = artifact[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

/** Return the newest structured checkpoint even when later plain turns exist. */
export function latestEvryHistoryCheckpoint(
  conversation: PublicEvryConversation
): EvryHistoryCheckpoint | null {
  const latest = latestArtifact(conversation);
  if (!latest) return null;
  const artifact = recordOf(latest.artifact);
  if (!artifact || typeof artifact.kind !== "string") return null;
  const plan = activePlanView(conversation.activePlan);
  const rebuildRequired =
    artifact.kind === "confirmation" &&
    (plan === null ||
      plan.status === "expired" ||
      plan.status === "stale" ||
      (plan.status === "awaiting_confirmation" && !plan.confirmable));

  switch (artifact.kind) {
    case "read":
      return {
        messageId: latest.messageId,
        kind: artifact.kind,
        label: "Last result",
        title: artifactString(artifact, "title") ?? "Read result",
        detail: null,
        rebuildRequired: false,
      };
    case "clarification":
      return {
        messageId: latest.messageId,
        kind: artifact.kind,
        label: "Decision needed",
        title: artifactString(artifact, "prompt") ?? "Evry needs a choice",
        detail: null,
        rebuildRequired: false,
      };
    case "settings_handoff":
      return {
        messageId: latest.messageId,
        kind: artifact.kind,
        label: "Settings handoff",
        title: "Continue this work in Settings",
        detail: null,
        rebuildRequired: false,
      };
    case "confirmation":
      return {
        messageId: latest.messageId,
        kind: artifact.kind,
        label: rebuildRequired ? "Rebuild needed" : "Plan checkpoint",
        title: artifactString(artifact, "title") ?? "Plan ready for review",
        detail: rebuildRequired
          ? "This plan stays in your history, but its approval is no longer current."
          : artifactString(artifact, "actionLabel"),
        rebuildRequired,
      };
    case "progress":
      return {
        messageId: latest.messageId,
        kind: artifact.kind,
        label: "Work in progress",
        title: artifactString(artifact, "title") ?? "Evry is working",
        detail: null,
        rebuildRequired: false,
      };
    case "result":
      return {
        messageId: latest.messageId,
        kind: artifact.kind,
        label:
          artifact.status === "completed" ? "Completed" : "Needs attention",
        title: artifactString(artifact, "title") ?? "Result",
        detail:
          artifact.status === "partially_failed"
            ? "Some steps completed and some need attention."
            : null,
        rebuildRequired: false,
      };
    case "boundary":
      return {
        messageId: latest.messageId,
        kind: artifact.kind,
        label: "Request boundary",
        title: "Evry kept this request inside EveryField work",
        detail: null,
        rebuildRequired: false,
      };
    default:
      return null;
  }
}

export function conversationMatchesVisibleSearch(
  conversation: PublicEvryConversation,
  search: string | null
): boolean {
  if (search === null) return true;
  const term = search.normalize("NFKC").toLocaleLowerCase("en-US");
  return [
    conversation.title,
    ...conversation.messages.map(({ body }) => body),
  ].some((value) =>
    value.normalize("NFKC").toLocaleLowerCase("en-US").includes(term)
  );
}

export function evryHistoryHref(input: {
  conversationId?: string | null;
  newConversation?: boolean;
  search?: string | null;
}): string {
  const params = new URLSearchParams();
  if (input.search) params.set("q", input.search);
  if (input.newConversation) {
    params.set("new", "1");
  } else if (input.conversationId) {
    params.set("conversation", input.conversationId);
  }
  const query = params.toString();
  return query.length === 0 ? "/evry" : `/evry?${query}`;
}

export type EvryCreatedConversationSyncMarker =
  | Readonly<{
      kind: "awaiting";
      previousConversationId: string | null;
    }>
  | Readonly<{
      kind: "captured";
      conversationId: string;
    }>
  | null;

export function awaitingEvryCreatedConversation(
  previousConversationId: string | null
): EvryCreatedConversationSyncMarker {
  return { kind: "awaiting", previousConversationId };
}

/** Capture exactly one conversation created in New mode and consume it once. */
export function evryCreatedConversationSyncDecision(input: {
  marker: EvryCreatedConversationSyncMarker;
  mountedConversationId: string | null;
  urlConversationId: string | null;
}): Readonly<{
  nextMarker: EvryCreatedConversationSyncMarker;
  conversationIdToSync: string | null;
}> {
  const captured =
    input.marker?.kind === "awaiting" &&
    input.mountedConversationId !== null &&
    input.mountedConversationId !== input.marker.previousConversationId
      ? {
          kind: "captured" as const,
          conversationId: input.mountedConversationId,
        }
      : input.marker;
  if (captured === null || captured.kind === "awaiting") {
    return { nextMarker: captured, conversationIdToSync: null };
  }
  if (input.mountedConversationId !== captured.conversationId) {
    return { nextMarker: captured, conversationIdToSync: null };
  }
  if (input.urlConversationId === captured.conversationId) {
    return { nextMarker: null, conversationIdToSync: null };
  }
  return input.urlConversationId === null
    ? {
        nextMarker: null,
        conversationIdToSync: captured.conversationId,
      }
    : { nextMarker: captured, conversationIdToSync: null };
}

/** Keep a stale mounted conversation out of a newly-reset composer. */
export function evryHistorySelectedConversationId(input: {
  isCreatingNew: boolean;
  previousConversationId: string | null;
  mountedConversationId: string | null;
  routeConversationId: string | null;
}): string | null {
  if (!input.isCreatingNew) return input.routeConversationId;
  return input.mountedConversationId === input.previousConversationId
    ? null
    : input.mountedConversationId;
}

export function canUseEvryNewComposer(input: {
  isCreatingNew: boolean;
  mountedConversationId: string | null;
}): boolean {
  return input.isCreatingNew && input.mountedConversationId === null;
}

/** Route loads yield while New or a different App Router transition owns state. */
export function evryHistoryConversationIdToLoad(input: {
  isCreatingNew: boolean;
  navigationPending: boolean;
  routeConversationId: string | null;
}): string | null {
  return input.isCreatingNew || input.navigationPending
    ? null
    : input.routeConversationId;
}

/** Expansion may reveal an existing unsent panel composer; never erase it. */
export function shouldRestoreEvryNewComposer(input: {
  routeConversationId: string | null;
  loadedConversationId: string | null;
  hasDraft: boolean;
  hasPageContext: boolean;
}): boolean {
  return (
    input.routeConversationId === null &&
    input.loadedConversationId === null &&
    (input.hasDraft || input.hasPageContext)
  );
}

/** Keep a loaded composer unavailable until navigation and loading agree. */
export function canUseEvryHistoryComposer(input: {
  navigationPending: boolean;
  selectedConversationId: string | null;
  loadedConversationId: string | null;
}): boolean {
  return (
    !input.navigationPending &&
    input.selectedConversationId !== null &&
    input.loadedConversationId === input.selectedConversationId
  );
}

export function historyItemForCurrentConversation(
  conversation: PublicEvryConversation
): EvryConversationHistoryItem {
  return {
    id: conversation.id,
    title: conversation.title,
    lastActivityAt: conversation.lastActivityAt,
    lastActivityLabel: "Just now",
    lastActivityTitle: "Updated in this conversation",
    actionableState: evryHistoryStateForConversation(conversation),
  };
}
