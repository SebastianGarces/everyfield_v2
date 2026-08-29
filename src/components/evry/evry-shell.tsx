"use client";

import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
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

import { useHeader } from "@/components/header/header-context";

import type { PublicEvryConversation } from "./client-contract";
import {
  beginEvryConversationLoad,
  canApplyEvryConversationLoadResponse,
  cancelEvryConversationLoads,
  evryConversationRequestBody,
  evryConversationSubmissionEndpoint,
  evryDraftAfterSubmission,
  evrySubmissionMessage,
  finishEvryConversationLoad,
  initialEvryConversationLoadState,
  isEvryConversationLoading,
  isLatestEvryConversationLoad,
  pendingEvrySubmissionFor,
  pendingEvrySubmissionAfterConversation,
  type PendingEvrySubmission,
} from "./interaction-state";
import {
  visibleEvryPageContextFor,
  type VisibleEvryPageContext,
} from "./page-context";
import { evrySuggestionsForPathname } from "./suggestions/pathname";
import type { EligibleEvrySuggestion } from "./suggestions/types";
import { evryWorkStateForConversation } from "./streaming/conversation-state";
import type { EvryAcknowledgementTarget } from "./streaming/work-status";
import {
  evryWorkStateForStreamEvent,
  readEvryConversationStream,
} from "@/lib/evry/streaming/conversation-wire";
import {
  applyEvrySequencedWork,
  beginEvrySequencedWork,
  type EvrySequencedWorkState,
  type EvryWorkState,
} from "@/lib/evry/streaming/state";

const EvryPanel = dynamic(() =>
  import("./evry-panel").then((module) => module.EvryPanel)
);

type EvryShellValue = Readonly<{
  activeContext: VisibleEvryPageContext | null;
  acknowledgement: EvryAcknowledgementTarget | null;
  applyWorkConversation: (
    requestId: string,
    sequence: number,
    conversation: PublicEvryConversation
  ) => boolean;
  beginWork: (requestId: string, state: EvryWorkState) => void;
  clearContext: () => void;
  closePanel: () => void;
  conversation: PublicEvryConversation | null;
  draft: string;
  error: string | null;
  expandToWorkspace: () => void;
  finishWork: (requestId: string, sequence: number) => boolean;
  isEnabled: boolean;
  isComposerBlocked: boolean;
  isLoading: boolean;
  isPanelOpen: boolean;
  isSending: boolean;
  isWorking: boolean;
  loadConversation: (conversationId: string) => Promise<void>;
  openPanel: (trigger: HTMLButtonElement) => void;
  resetConversation: () => void;
  restoreLauncherFocus: () => void;
  returnToPage: () => void;
  sendMessage: () => Promise<void>;
  setDraft: (draft: string) => void;
  updateWork: (
    requestId: string,
    sequence: number,
    state: EvryWorkState
  ) => boolean;
  suggestions: readonly EligibleEvrySuggestion[];
  workRequestId: string | null;
  workState: EvryWorkState;
}>;

const EvryShellContext = createContext<EvryShellValue | null>(null);

async function responseConversation(response: Response) {
  const body: unknown = await response.json();
  if (!response.ok) throw new Error("Unable to update this conversation.");
  const { parseEvryConversationEnvelope } = await import("./client-contract");
  return parseEvryConversationEnvelope(body);
}

export function EvryShell({
  children,
  enabled,
  eligibleSuggestions,
}: {
  children: ReactNode;
  enabled: boolean;
  eligibleSuggestions: readonly EligibleEvrySuggestion[];
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { breadcrumbs } = useHeader();
  const visibleContext = useMemo(
    () => visibleEvryPageContextFor(pathname, breadcrumbs),
    [breadcrumbs, pathname]
  );
  const suggestions = useMemo(
    () => evrySuggestionsForPathname(pathname, eligibleSuggestions),
    [eligibleSuggestions, pathname]
  );
  const [activeContext, setActiveContext] =
    useState<VisibleEvryPageContext | null>(null);
  const [conversation, setConversation] =
    useState<PublicEvryConversation | null>(null);
  const [draft, setDraftState] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [acknowledgement, setAcknowledgement] =
    useState<EvryAcknowledgementTarget | null>(null);
  const [sequencedWork, setSequencedWork] =
    useState<EvrySequencedWorkState | null>(null);
  const [pendingWorkRequestId, setPendingWorkRequestId] = useState<
    string | null
  >(null);
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [hasOpenedPanel, setHasOpenedPanel] = useState(false);
  const [isSending, setSending] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [requestedConversationId, setRequestedConversationId] = useState<
    string | null
  >(null);
  const [expandedFromPanel, setExpandedFromPanel] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const conversationLoadStateRef = useRef(initialEvryConversationLoadState());
  const pendingSubmissionRef = useRef<PendingEvrySubmission | null>(null);
  const sequencedWorkRef = useRef<EvrySequencedWorkState | null>(null);
  const pendingWorkRequestIdRef = useRef<string | null>(null);
  const previousPathnameRef = useRef(pathname);
  const draftRef = useRef(draft);
  const isWorking = pendingWorkRequestId !== null;

  const setDraft = useCallback((nextDraft: string) => {
    draftRef.current = nextDraft;
    setDraftState(nextDraft);
  }, []);

  const presentWork = useCallback((requestId: string, state: EvryWorkState) => {
    const next = beginEvrySequencedWork(requestId, state);
    sequencedWorkRef.current = next;
    setSequencedWork(next);
  }, []);

  const beginWork = useCallback(
    (requestId: string, state: EvryWorkState) => {
      setAcknowledgement((current) =>
        current?.requestId === requestId ? current : null
      );
      presentWork(requestId, state);
      pendingWorkRequestIdRef.current = requestId;
      setPendingWorkRequestId(requestId);
    },
    [presentWork]
  );

  const updateWork = useCallback(
    (requestId: string, sequence: number, state: EvryWorkState) => {
      const current = sequencedWorkRef.current;
      if (!current) return false;
      const next = applyEvrySequencedWork(current, {
        requestId,
        sequence,
        state,
      });
      if (next === current) return false;
      sequencedWorkRef.current = next;
      setSequencedWork(next);
      return true;
    },
    []
  );

  const finishWork = useCallback((requestId: string, sequence: number) => {
    const current = sequencedWorkRef.current;
    if (!current || pendingWorkRequestIdRef.current !== requestId) return false;
    const next = applyEvrySequencedWork(current, {
      requestId,
      sequence,
      state: current.state,
    });
    if (next === current) return false;
    sequencedWorkRef.current = next;
    pendingWorkRequestIdRef.current = null;
    setSequencedWork(next);
    setPendingWorkRequestId(null);
    return true;
  }, []);

  const clearWork = useCallback(() => {
    sequencedWorkRef.current = null;
    pendingWorkRequestIdRef.current = null;
    setSequencedWork(null);
    setPendingWorkRequestId(null);
  }, []);

  const applyWorkConversation = useCallback(
    (
      requestId: string,
      sequence: number,
      nextConversation: PublicEvryConversation
    ) => {
      if (
        !updateWork(
          requestId,
          sequence,
          evryWorkStateForConversation(nextConversation)
        )
      ) {
        return false;
      }
      setConversation(nextConversation);
      setError(null);
      return true;
    },
    [updateWork]
  );

  const cancelActiveConversationLoads = useCallback(() => {
    conversationLoadStateRef.current = cancelEvryConversationLoads(
      conversationLoadStateRef.current
    );
    setLoading(false);
    setRequestedConversationId(null);
    setError(null);
  }, []);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (previousPathname === "/evry" && pathname !== "/evry") {
      cancelActiveConversationLoads();
      if (expandedFromPanel) {
        setExpandedFromPanel(false);
        setPanelOpen(true);
      }
    }
  }, [cancelActiveConversationLoads, expandedFromPanel, pathname]);

  const openPanel = useCallback(
    (trigger: HTMLButtonElement) => {
      launcherRef.current = trigger;
      if (pathname === "/evry") {
        document.getElementById("evry-message")?.focus();
        return;
      }
      setActiveContext(visibleContext);
      setError(null);
      setHasOpenedPanel(true);
      setPanelOpen(true);
    },
    [pathname, visibleContext]
  );

  const closePanel = useCallback(() => setPanelOpen(false), []);
  const restoreLauncherFocus = useCallback(
    () => launcherRef.current?.focus(),
    []
  );

  const expandToWorkspace = useCallback(() => {
    setExpandedFromPanel(true);
    setPanelOpen(false);
    const query = conversation ? `?conversation=${conversation.id}` : "";
    router.push(`/evry${query}`);
  }, [conversation, router]);

  const returnToPage = useCallback(() => {
    if (expandedFromPanel) {
      cancelActiveConversationLoads();
      setExpandedFromPanel(false);
      setPanelOpen(true);
      router.back();
      return;
    }
    router.push("/dashboard");
  }, [cancelActiveConversationLoads, expandedFromPanel, router]);

  const clearContext = useCallback(() => setActiveContext(null), []);
  const loadConversation = useCallback(
    async (conversationId: string) => {
      if (isSending || isWorking) return;
      if (conversation?.id === conversationId) {
        setRequestedConversationId(null);
        return;
      }
      if (
        isEvryConversationLoading(
          conversationLoadStateRef.current,
          conversationId
        )
      ) {
        return;
      }
      const load = beginEvryConversationLoad(
        conversationLoadStateRef.current,
        conversationId
      );
      conversationLoadStateRef.current = load.state;
      setConversation(null);
      setRequestedConversationId(conversationId);
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/evry/conversations/${encodeURIComponent(conversationId)}`,
          { cache: "no-store" }
        );
        const loadedConversation = await responseConversation(response);
        if (
          !isLatestEvryConversationLoad(
            conversationLoadStateRef.current,
            load.attempt
          )
        ) {
          return;
        }
        if (
          !canApplyEvryConversationLoadResponse(
            conversationLoadStateRef.current,
            load.attempt,
            loadedConversation.id
          )
        ) {
          throw new Error("Conversation response did not match its request.");
        }
        setConversation(loadedConversation);
        setRequestedConversationId(null);
        presentWork(
          `load:${load.attempt.conversationId}:${load.attempt.ordinal}`,
          evryWorkStateForConversation(loadedConversation)
        );
      } catch {
        if (
          isLatestEvryConversationLoad(
            conversationLoadStateRef.current,
            load.attempt
          )
        ) {
          setError(
            "Unable to open this conversation. Reload the page to try again."
          );
        }
      } finally {
        const completion = finishEvryConversationLoad(
          conversationLoadStateRef.current,
          load.attempt
        );
        conversationLoadStateRef.current = completion.state;
        if (completion.applies) {
          setLoading(false);
        }
      }
    },
    [conversation?.id, isSending, isWorking, presentWork]
  );

  const resetConversation = useCallback(() => {
    if (isSending || isWorking) return;
    cancelActiveConversationLoads();
    pendingSubmissionRef.current = null;
    setConversation(null);
    setActiveContext(null);
    setDraft("");
    setError(null);
    setAcknowledgement(null);
    clearWork();
  }, [
    cancelActiveConversationLoads,
    clearWork,
    isSending,
    isWorking,
    setDraft,
  ]);

  const sendMessage = useCallback(async () => {
    const message = evrySubmissionMessage(draft);
    if (
      message === null ||
      isSending ||
      isWorking ||
      isLoading ||
      requestedConversationId !== null ||
      conversationLoadStateRef.current.latest !== null
    ) {
      return;
    }

    const pageContext = activeContext?.wire ?? null;
    const pendingSubmission = pendingEvrySubmissionFor(
      pendingSubmissionRef.current,
      {
        conversationId: conversation?.id ?? null,
        message,
        pageContext,
      },
      () => crypto.randomUUID()
    );
    setAcknowledgement({
      requestId: pendingSubmission.requestKey,
      submittedAt: performance.now(),
    });
    setSending(true);
    setError(null);
    beginWork(pendingSubmission.requestKey, {
      phase: "reading",
      message: pageContext
        ? "Checking this conversation and page context"
        : "Checking this conversation",
    });
    try {
      pendingSubmissionRef.current = pendingSubmission;
      const body = evryConversationRequestBody(pendingSubmission);
      let lastSequence = 0;
      const response = await fetch(
        evryConversationSubmissionEndpoint(pendingSubmission),
        {
          method: "POST",
          headers: {
            accept: "application/x-ndjson",
            "content-type": "application/json",
          },
          body,
        }
      );
      const streamed = await readEvryConversationStream(response, {
        requestId: pendingSubmission.requestKey,
        expectedConversationId: conversation?.id ?? null,
        onEvent(event) {
          lastSequence = event.sequence;
          if (event.type === "work") {
            updateWork(
              event.requestId,
              event.sequence,
              evryWorkStateForStreamEvent(event)
            );
          } else if (event.type === "conversation") {
            if (
              applyWorkConversation(
                event.requestId,
                event.sequence,
                event.conversation
              )
            ) {
              pendingSubmissionRef.current =
                pendingEvrySubmissionAfterConversation(
                  pendingSubmission,
                  event.requestId,
                  event.conversation.id
                );
            }
          } else if (event.type === "complete") {
            finishWork(event.requestId, event.sequence);
          }
        },
      });
      pendingSubmissionRef.current = null;
      if (!streamed.sawComplete || lastSequence < 2) {
        throw new Error("Evry response did not complete.");
      }
      setDraft(evryDraftAfterSubmission(draftRef.current, message));
    } catch {
      const failure =
        "Unable to save your request. Check your connection and try again.";
      setError(failure);
      const failureSequence =
        (sequencedWorkRef.current?.requestId === pendingSubmission.requestKey
          ? sequencedWorkRef.current.sequence
          : 0) + 1;
      updateWork(pendingSubmission.requestKey, failureSequence, {
        phase: "failed",
        message: failure,
      });
      finishWork(pendingSubmission.requestKey, failureSequence + 1);
    } finally {
      setSending(false);
    }
  }, [
    activeContext,
    applyWorkConversation,
    beginWork,
    conversation,
    draft,
    finishWork,
    isLoading,
    isSending,
    isWorking,
    requestedConversationId,
    setDraft,
    updateWork,
  ]);

  const value = useMemo<EvryShellValue>(
    () => ({
      activeContext,
      acknowledgement,
      applyWorkConversation,
      beginWork,
      clearContext,
      closePanel,
      conversation,
      draft,
      error,
      expandToWorkspace,
      finishWork,
      isEnabled: enabled,
      isComposerBlocked:
        isLoading || isWorking || requestedConversationId !== null,
      isLoading,
      isPanelOpen,
      isSending,
      isWorking,
      loadConversation,
      openPanel,
      resetConversation,
      restoreLauncherFocus,
      returnToPage,
      sendMessage,
      setDraft,
      updateWork,
      suggestions,
      workRequestId: sequencedWork?.requestId ?? null,
      workState: sequencedWork?.state ?? { phase: "idle" },
    }),
    [
      activeContext,
      acknowledgement,
      applyWorkConversation,
      beginWork,
      clearContext,
      closePanel,
      conversation,
      draft,
      enabled,
      error,
      expandToWorkspace,
      finishWork,
      isLoading,
      isPanelOpen,
      isSending,
      isWorking,
      loadConversation,
      openPanel,
      resetConversation,
      requestedConversationId,
      restoreLauncherFocus,
      returnToPage,
      sendMessage,
      setDraft,
      sequencedWork,
      suggestions,
      updateWork,
    ]
  );

  return (
    <EvryShellContext.Provider value={value}>
      {children}
      {enabled && hasOpenedPanel ? <EvryPanel /> : null}
    </EvryShellContext.Provider>
  );
}

export function useEvryShell(): EvryShellValue {
  const value = useContext(EvryShellContext);
  if (!value) throw new Error("useEvryShell must be used within EvryShell");
  return value;
}
