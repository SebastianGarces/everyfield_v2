"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type { EveMessage } from "eve/client";
import { useHeader } from "@/components/header/header-context";
import { AuthenticatedNavigationIntentProvider } from "@/components/authenticated-navigation";
import type { PublicEvryConversation } from "./client-contract";
import {
  visibleEvryPageContextFor,
  type VisibleEvryPageContext,
} from "./page-context";
import { visibleEvryInsightHandoff } from "./insight-handoff";
import type { EvryAcknowledgementTarget } from "./streaming/work-status";
import type { EvryWorkState } from "@/lib/evry/streaming/state";
import { projectEveMessage } from "./eve-message-projection";
import {
  EveSessionBridge,
  readEveSession,
  type EveClient,
  type EveSnapshot,
  type EveSessionBinding,
  type EveSessionMetadata,
} from "./eve-client/session";
import { stagePeopleFile } from "./eve-client/files";
import type { PreparedEvryPeopleFile } from "./people-file-state";

const EvryPanel = dynamic(() =>
  import("./evry-panel").then((module) => module.EvryPanel)
);
const EMPTY_MESSAGES: readonly EveMessage[] = [];
type ActivePlan = PublicEvryConversation["activePlan"];
type PendingTurn = {
  bindingKey: string;
  operationId: string;
  text: string;
  clientContext:
    | string
    | { pageContext: VisibleEvryPageContext["wire"] | null };
  inputResponses?: { requestId: string; text?: string; optionId?: string }[];
  eventStartIndex: number;
};

export type EvryPeopleFileSubmission =
  | Readonly<{
      kind: "people_csv";
      file: File;
      prepared: PreparedEvryPeopleFile | null;
      duplicateResolutions: Readonly<
        Record<string, "skip" | "create" | "merge">
      > | null;
    }>
  | Readonly<{ kind: "person_photo"; file: File; personId: string }>
  | Readonly<{
      kind: "commitment_document";
      file: File;
      personId: string;
      commitmentType: "core_group" | "launch_team";
      signedDate: string;
      notes: string | null;
    }>;

export type EvryPeopleFileSubmissionResult =
  | Readonly<{ status: "submitted" }>
  | Readonly<{
      status: "needs_duplicate_resolution";
      prepared: PreparedEvryPeopleFile;
    }>
  | Readonly<{ status: "failed"; message?: string }>;

type EvryShellValue = {
  activeContext: VisibleEvryPageContext | null;
  acknowledgement: EvryAcknowledgementTarget | null;
  conversation: PublicEvryConversation | null;
  messages: readonly EveMessage[];
  sessionId: string | null;
  draft: string;
  error: string | null;
  pendingMessage: {
    body: string;
    status: "failed";
    requestId: string;
    savedMessageId: string;
  } | null;
  isEnabled: boolean;
  isPanelOpen: boolean;
  isComposerBlocked: boolean;
  isLoading: boolean;
  isSending: boolean;
  isWorking: boolean;
  workState: EvryWorkState;
  workRequestId: string | null;
  canStopWatching: boolean;
  isWatchingDetached: boolean;
  setDraft(value: string): void;
  clearContext(): void;
  closePanel(): void;
  restoreLauncherFocus(): void;
  openPanel(trigger: HTMLButtonElement): void;
  openInsightHandoff(handoff: unknown, trigger: HTMLButtonElement): boolean;
  expandToWorkspace(): void;
  returnToPage(): void;
  loadConversation(id: string): Promise<void>;
  resetConversation(): void;
  sendMessage(): Promise<void>;
  sendMessageText(text: string): Promise<void>;
  respondToQuestion(
    requestId: string,
    text: string,
    optionId?: string
  ): Promise<void>;
  resumeWatching(): void;
  stopWatching(): void;
  discardPendingMessage(): void;
  canSyncWorkspaceHistory(): boolean;
  submitPeopleFile(
    input: EvryPeopleFileSubmission
  ): Promise<EvryPeopleFileSubmissionResult>;
  updatePlan(plan: ActivePlan): void;
  setExecuting(value: boolean): void;
};
const EvryShellContext = createContext<EvryShellValue | null>(null);

/** Chat identity and navigation live above either mounted transcript surface. */
export function EvryShell({
  children,
  enabled,
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const pathname = usePathname();
  const locationSearch = useSearchParams().toString();
  const navigationPending = useRef(false);
  const router = useRouter();
  const { breadcrumbs } = useHeader();
  const visibleContext = useMemo(
    () => visibleEvryPageContextFor(pathname, breadcrumbs),
    [pathname, breadcrumbs]
  );
  const [activeContext, setActiveContext] =
    useState<VisibleEvryPageContext | null>(null);
  const [binding, setBinding] = useState<EveSessionBinding>({ key: "new" });
  const bindingRef = useRef(binding);
  bindingRef.current = binding;
  const [client, setClient] = useState<EveClient | null>(null);
  const clientRef = useRef<EveClient | null>(null);
  const finishedSnapshot = useRef<EveSnapshot | null>(null);
  const replayCompletion = useRef<ReturnType<
    typeof Promise.withResolvers<void>
  > | null>(null);
  const pendingTurn = useRef<PendingTurn | null>(null);
  const [failedTurn, setFailedTurn] = useState<PendingTurn | null>(null);
  const [dismissedFailure, setDismissedFailure] = useState(false);
  const sendingTurn = useRef<string | null>(null);
  const [metadata, setMetadata] = useState<EveSessionMetadata | null>(null);
  const metadataRef = useRef(metadata);
  metadataRef.current = metadata;
  const cache = useRef(new Map<string, EveSessionBinding>());
  const lookup = useRef<AbortController | null>(null);
  const [loading, setLoading] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [acknowledgement, setAcknowledgement] =
    useState<EvryAcknowledgementTarget | null>(null);
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [hasOpenedPanel, setHasOpenedPanel] = useState(false);
  const [expandedFromPanel, setExpandedFromPanel] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [executing, setExecuting] = useState(false);
  const [activePlan, updatePlan] = useState<ActivePlan>(null);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const previousPath = useRef(pathname);
  const messages = client?.data.messages ?? EMPTY_MESSAGES;
  const isSending = client?.status === "submitted";
  const isWorking =
    isSending || client?.status === "streaming" || executing || uploading;
  const isLoading =
    loading || (client?.status === "resuming" && messages.length === 0);
  const isComposerBlocked =
    !client || loading || isWorking || client.status === "resuming";
  const lastUser = messages.findLast((message) => message.role === "user");
  const interruptedMessage = failedTurn
    ? {
        body: failedTurn.text,
        status: "failed" as const,
        requestId: failedTurn.operationId,
        savedMessageId: lastUser?.id ?? "",
      }
    : lastUser?.metadata?.status === "failed"
      ? {
          body: lastUser.parts
            .filter((part) => part.type === "text")
            .map((part) => part.text)
            .join(""),
          status: "failed" as const,
          requestId: lastUser.id,
          savedMessageId: lastUser.id,
        }
      : null;
  const pendingMessage = dismissedFailure ? null : interruptedMessage;
  const workRequestId =
    acknowledgement?.requestId ?? messages.at(-1)?.metadata?.turnId ?? null;
  const workState: EvryWorkState =
    error || client?.error
      ? {
          phase: "failed",
          message:
            error ??
            "The response was interrupted. Reconnect to pick up where you left off.",
        }
      : uploading
        ? { phase: "reading", message: "Checking your file…" }
        : executing
          ? { phase: "execution", message: "Applying your confirmed changes…" }
          : isSending
            ? { phase: "reading", message: "Thinking…" }
            : client?.status === "streaming"
              ? { phase: "reading", message: "Working on your request…" }
              : client?.status === "resuming"
                ? { phase: "reading", message: "Reconnecting…" }
                : { phase: "idle" };

  const conversation = useMemo<PublicEvryConversation | null>(() => {
    if (!metadata) return null;
    return {
      id: metadata.conversationId,
      title: metadata.title,
      createdAt: metadata.createdAt,
      lastActivityAt: metadata.updatedAt,
      activePlan,
      stateVersion: client?.events.length ?? 0,
      state: null,
      messages: messages.map((message, sequence) => {
        const parts = projectEveMessage(message);
        return {
          id: message.id,
          sequence,
          author: message.role,
          body: parts
            .flatMap((part) =>
              part.kind === "text"
                ? [part.text]
                : part.kind === "question"
                  ? [part.prompt]
                  : []
            )
            .join("\n\n"),
          artifacts: parts.flatMap((part, ordinal) =>
            part.kind === "artifact"
              ? [{ id: part.key, ordinal, artifact: part.artifact }]
              : []
          ),
          pageContext: null,
          deliveryStatus:
            message.metadata?.status === "failed" ? "interrupted" : "complete",
          createdAt: metadata.createdAt,
        };
      }),
    };
  }, [metadata, messages, activePlan, client?.events.length]);

  const onClient = useCallback((next: EveClient) => {
    clientRef.current = next;
    setClient(next);
    const current = metadataRef.current;
    if (current && next.session)
      cache.current.set(current.conversationId, {
        key: bindingRef.current.key,
        metadata: current,
        session: next.session,
        events: next.events,
      });
  }, []);
  const onSession = useCallback((id: string) => {
    if (metadataRef.current?.id === id) return;
    const key = bindingRef.current.key;
    void readEveSession({ sessionId: id })
      .then((next) => {
        if (bindingRef.current.key !== key) return;
        setMetadata(next);
      })
      .catch(() => {
        if (bindingRef.current.key === key)
          setError(
            "Your message is saved, but the conversation list could not refresh. Reconnect to try again."
          );
      });
  }, []);
  const onFinish = useCallback((snapshot: EveSnapshot) => {
    finishedSnapshot.current = snapshot;
    replayCompletion.current?.resolve();
    replayCompletion.current = null;
    const id = snapshot.session?.sessionId;
    if (!id) return;
    const key = bindingRef.current.key;
    void readEveSession({ sessionId: id })
      .then((next) => {
        if (bindingRef.current.key === key) setMetadata(next);
      })
      .catch(() => {});
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    if (metadataRef.current?.conversationId === id) return;
    lookup.current?.abort();
    const controller = new AbortController();
    lookup.current = controller;
    setLoading(true);
    setError(null);
    try {
      const cached = cache.current.get(id);
      const next =
        cached?.metadata ??
        (await readEveSession({ conversationId: id }, controller.signal));
      if (controller.signal.aborted) return;
      setMetadata(next);
      updatePlan(null);
      setAcknowledgement(null);
      setDraft("");
      pendingTurn.current = null;
      sendingTurn.current = null;
      replayCompletion.current?.resolve();
      replayCompletion.current = null;
      setFailedTurn(null);
      setDismissedFailure(false);
      clientRef.current = null;
      setClient(null);
      setBinding(
        cached ?? {
          key: next.id,
          metadata: next,
          session: { sessionId: next.id, streamIndex: 0 },
        }
      );
    } catch {
      if (!controller.signal.aborted)
        setError("Unable to open this conversation. Try again.");
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, []);
  const resetConversation = useCallback(() => {
    if (!metadataRef.current && !clientRef.current?.data.messages.length)
      return;
    lookup.current?.abort();
    setLoading(false);
    setMetadata(null);
    updatePlan(null);
    setAcknowledgement(null);
    setError(null);
    setDraft("");
    pendingTurn.current = null;
    sendingTurn.current = null;
    replayCompletion.current?.resolve();
    replayCompletion.current = null;
    setFailedTurn(null);
    setDismissedFailure(false);
    clientRef.current = null;
    setClient(null);
    setBinding({ key: crypto.randomUUID() });
  }, []);
  useEffect(() => () => lookup.current?.abort(), []);
  useEffect(() => {
    navigationPending.current = false;
  }, [pathname, locationSearch]);
  useEffect(() => {
    if (
      previousPath.current === "/evry" &&
      pathname !== "/evry" &&
      metadataRef.current
    ) {
      setPanelOpen(true);
      setHasOpenedPanel(true);
      setActiveContext(visibleContext);
    }
    previousPath.current = pathname;
  }, [pathname, visibleContext]);

  const contextForTurn = useCallback(
    () => ({ pageContext: activeContext?.wire ?? null }),
    [activeContext]
  );
  const requestHeaders = useCallback((): Record<string, string> => {
    const operationId = pendingTurn.current?.operationId;
    return operationId ? { "x-evry-operation-id": operationId } : {};
  }, []);
  const readFinishedSnapshot = useCallback(() => finishedSnapshot.current, []);
  const replaySession = useCallback(
    (current: EveClient, request?: PendingTurn) => {
      if (!current.session)
        throw new Error("A saved session is required for replay");
      // Remount from authoritative events: native resume can reuse a settled reader.
      const completion = Promise.withResolvers<void>();
      replayCompletion.current = completion;
      const next: EveSessionBinding = {
        key: crypto.randomUUID(),
        session: current.session,
        events: current.events,
      };
      if (request) request.bindingKey = next.key;
      bindingRef.current = next;
      clientRef.current = null;
      setBinding(next);
      return completion.promise;
    },
    []
  );
  const deliver = useCallback(
    async (request: PendingTurn, reconnect = false) => {
      const current = clientRef.current;
      if (!current || sendingTurn.current) return false;
      sendingTurn.current = request.operationId;
      finishedSnapshot.current = null;
      setError(null);
      setDismissedFailure(false);
      try {
        if (reconnect && current.session) {
          // A lost POST response may still have queued a turn. Never send it twice.
          await replaySession(current, request);
        } else {
          // No session was received. The same creation key recovers an accepted POST.
          if (reconnect) current.reset();
          if (request.inputResponses)
            await current.respond(request.inputResponses, {
              clientContext: request.clientContext,
            });
          else
            await current.send(request.text, {
              clientContext: request.clientContext,
            });
        }
        const settled = readFinishedSnapshot();
        if (!settled || settled.status === "error")
          throw new Error("delivery failed");
        if (reconnect && current.session) {
          const received = settled.events
            .slice(request.eventStartIndex)
            .some((event) =>
              request.inputResponses
                ? event.type === "input.resolved" &&
                  request.inputResponses.every((response) =>
                    event.data.resolutions.some(
                      (resolution) =>
                        resolution.requestId === response.requestId &&
                        resolution.outcome !== "invalid"
                    )
                  )
                : event.type === "message.received" &&
                  event.data.message === request.text
            );
          if (!received) {
            if (bindingRef.current.key === request.bindingKey) {
              pendingTurn.current = null;
              setFailedTurn(null);
              setDraft((value) => value || request.text);
              setError(
                "That message isn't in the saved conversation yet. Your draft is ready if you want to send it again."
              );
            }
            return false;
          }
        }
        if (bindingRef.current.key === request.bindingKey) {
          pendingTurn.current = null;
          setFailedTurn(null);
          setDraft((value) => (value === request.text ? "" : value));
        }
        return true;
      } catch {
        if (bindingRef.current.key === request.bindingKey) {
          setFailedTurn(request);
          setDraft((value) => value || request.text);
          setError(
            (readFinishedSnapshot()?.session ?? current.session)
              ? "The response was interrupted. Your draft is kept. Reconnect to check the conversation before sending again."
              : "We couldn't connect. Your message is kept. Reconnect to retry it."
          );
        }
        return false;
      } finally {
        if (sendingTurn.current === request.operationId)
          sendingTurn.current = null;
      }
    },
    [readFinishedSnapshot, replaySession]
  );
  const send = useCallback(
    async (
      text: string,
      attachment?: Record<string, string | number | null | unknown[] | object>
    ) => {
      const current = clientRef.current;
      if (
        !current ||
        sendingTurn.current ||
        !text.trim() ||
        loading ||
        executing ||
        current.status === "submitted" ||
        current.status === "streaming" ||
        current.status === "resuming"
      )
        return false;
      const retained = pendingTurn.current;
      if (retained) {
        if (retained.text !== text || attachment) {
          setError(
            "Reconnect to check your last message before sending a different one."
          );
          return false;
        }
        return deliver(retained, true);
      }
      setError(null);
      const operationId = crypto.randomUUID();
      setAcknowledgement({
        requestId: operationId,
        submittedAt: performance.now(),
      });
      setDraft("");
      const question = current.data.messages
        .flatMap(projectEveMessage)
        .findLast((part) => part.kind === "question");
      const request: PendingTurn = {
        bindingKey: bindingRef.current.key,
        operationId,
        text,
        clientContext: attachment
          ? JSON.stringify({ ...contextForTurn(), attachment })
          : contextForTurn(),
        inputResponses:
          question?.kind === "question" && !attachment
            ? [{ requestId: question.requestId, text }]
            : undefined,
        eventStartIndex: current.events.length,
      };
      pendingTurn.current = request;
      return deliver(request);
    },
    [contextForTurn, deliver, executing, loading]
  );
  const sendMessageText = useCallback(
    async (text: string) => {
      await send(text);
    },
    [send]
  );
  const sendMessage = useCallback(async () => {
    await send(draft);
  }, [send, draft]);
  const respondToQuestion = useCallback(
    async (requestId: string, text: string, optionId?: string) => {
      if (pendingTurn.current || !clientRef.current) return;
      const request: PendingTurn = {
        bindingKey: bindingRef.current.key,
        operationId: crypto.randomUUID(),
        text,
        clientContext: contextForTurn(),
        inputResponses: [
          {
            requestId,
            ...(optionId ? { optionId } : {}),
            ...(text ? { text } : {}),
          },
        ],
        eventStartIndex: clientRef.current.events.length,
      };
      pendingTurn.current = request;
      await deliver(request);
    },
    [contextForTurn, deliver]
  );
  const resumeWatching = useCallback(() => {
    setError(null);
    if (pendingTurn.current) {
      void deliver(pendingTurn.current, true);
      return;
    }
    if (!clientRef.current?.session) {
      setError(
        "There is no saved conversation to reconnect to. Your draft is kept."
      );
      return;
    }
    void replaySession(clientRef.current)
      .then(() => {
        if (readFinishedSnapshot()?.status === "error")
          setError("Unable to reconnect. Try again.");
      })
      .catch(() => setError("Unable to reconnect. Try again."));
  }, [deliver, readFinishedSnapshot, replaySession]);
  const stopWatching = useCallback(() => {
    void clientRef.current
      ?.cancel()
      .catch(() =>
        setError("Unable to stop the response. Reconnect to check its status.")
      );
  }, []);

  const submitPeopleFile = useCallback(
    async (
      input: EvryPeopleFileSubmission
    ): Promise<EvryPeopleFileSubmissionResult> => {
      if (isComposerBlocked)
        return {
          status: "failed",
          message: "Wait for the current response to finish.",
        };
      setUploading(true);
      setError(null);
      try {
        const prepared =
          input.kind === "people_csv" && input.prepared
            ? input.prepared
            : await stagePeopleFile(input);
        if (
          input.kind === "people_csv" &&
          input.duplicateResolutions === null &&
          prepared.duplicateRows.length
        )
          return { status: "needs_duplicate_resolution", prepared };
        const attachment = {
          kind: input.kind,
          reference: prepared.reference,
          ...(input.kind === "people_csv"
            ? {
                duplicateResolutions: Object.entries(
                  input.duplicateResolutions ?? {}
                ).map(([rowNumber, resolution]) => ({
                  rowNumber: Number(rowNumber),
                  resolution,
                })),
              }
            : { personId: input.personId }),
          ...(input.kind === "commitment_document"
            ? {
                commitmentType: input.commitmentType,
                signedDate: input.signedDate,
                notes: input.notes,
              }
            : {}),
        };
        const submitted = await send(
          input.kind === "people_csv"
            ? `Review importing people from ${input.file.name}.`
            : input.kind === "person_photo"
              ? `Review adding ${input.file.name} as this person's photo.`
              : `Review adding ${input.file.name} as this person's commitment document.`,
          attachment
        );
        if (!submitted)
          return {
            status: "failed",
            message:
              "Your file is ready. Reconnect to retry sending its review.",
          };
        return { status: "submitted" };
      } catch {
        return {
          status: "failed",
          message:
            "Unable to prepare this file. Keep it selected and try again.",
        };
      } finally {
        setUploading(false);
      }
    },
    [isComposerBlocked, send]
  );

  const openPanel = useCallback(
    (trigger: HTMLButtonElement) => {
      launcherRef.current = trigger;
      if (pathname === "/evry") {
        document.getElementById("evry-message")?.focus();
        return;
      }
      setActiveContext(visibleContext);
      setHasOpenedPanel(true);
      setPanelOpen(true);
    },
    [pathname, visibleContext]
  );
  const openInsightHandoff = useCallback(
    (handoff: unknown, trigger: HTMLButtonElement) => {
      const context = visibleEvryInsightHandoff(handoff);
      if (!enabled || !context) return false;
      launcherRef.current = trigger;
      setActiveContext(context);
      setHasOpenedPanel(true);
      setPanelOpen(true);
      return true;
    },
    [enabled]
  );
  const restoreLauncherFocus = useCallback(() => {
    if (launcherRef.current?.isConnected) launcherRef.current.focus();
    else document.getElementById("evry-launcher")?.focus();
  }, []);
  const expandToWorkspace = useCallback(() => {
    navigationPending.current = true;
    setExpandedFromPanel(true);
    setPanelOpen(false);
    router.push(
      metadata ? `/evry?conversation=${metadata.conversationId}` : "/evry?new=1"
    );
  }, [metadata, router]);
  const returnToPage = useCallback(() => {
    navigationPending.current = true;
    if (expandedFromPanel) {
      setExpandedFromPanel(false);
      setPanelOpen(true);
      router.back();
    } else router.push("/dashboard");
  }, [expandedFromPanel, router]);
  const canSyncWorkspaceHistory = useCallback(
    () => pathname === "/evry" && !navigationPending.current,
    [pathname]
  );
  const recordNavigationIntent = useCallback(() => {
    navigationPending.current = true;
  }, []);

  const value: EvryShellValue = {
    activeContext,
    acknowledgement,
    conversation,
    messages,
    sessionId: metadata?.id ?? client?.session?.sessionId ?? null,
    draft,
    error,
    pendingMessage,
    isEnabled: enabled,
    isPanelOpen,
    isComposerBlocked,
    isLoading,
    isSending,
    isWorking,
    workState,
    workRequestId,
    setDraft,
    clearContext: () => setActiveContext(null),
    closePanel: () => setPanelOpen(false),
    restoreLauncherFocus,
    openPanel,
    openInsightHandoff,
    expandToWorkspace,
    returnToPage,
    loadConversation,
    resetConversation,
    sendMessage,
    sendMessageText,
    respondToQuestion,
    resumeWatching,
    stopWatching,
    discardPendingMessage: () => {
      setError(null);
      setDismissedFailure(true);
      setDraft((value) => value || pendingMessage?.body || "");
    },
    canStopWatching: isSending || client?.status === "streaming",
    isWatchingDetached: client?.status === "error",
    canSyncWorkspaceHistory,
    submitPeopleFile,
    updatePlan,
    setExecuting,
  };
  return (
    <EvryShellContext.Provider value={value}>
      {enabled ? (
        <EveSessionBridge
          key={binding.key}
          binding={binding}
          onChange={onClient}
          onSession={onSession}
          onFinish={onFinish}
          headers={requestHeaders}
        />
      ) : null}
      <AuthenticatedNavigationIntentProvider value={recordNavigationIntent}>
        {children}
        {enabled && hasOpenedPanel ? <EvryPanel /> : null}
      </AuthenticatedNavigationIntentProvider>
    </EvryShellContext.Provider>
  );
}

export function useEvryShell(): EvryShellValue {
  const value = useContext(EvryShellContext);
  if (!value) throw new Error("useEvryShell must be used within EvryShell");
  return value;
}
