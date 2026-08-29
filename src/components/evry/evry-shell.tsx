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
  evryDraftAfterSubmission,
  evrySubmissionMessage,
  finishEvryConversationLoad,
  initialEvryConversationLoadState,
  isEvryConversationLoading,
  isLatestEvryConversationLoad,
  pendingEvrySubmissionFor,
  type PendingEvrySubmission,
} from "./interaction-state";
import {
  visibleEvryPageContextFor,
  type VisibleEvryPageContext,
} from "./page-context";
import { evrySuggestionsForPathname } from "./suggestions/pathname";
import type { EligibleEvrySuggestion } from "./suggestions/types";

const EvryPanel = dynamic(() =>
  import("./evry-panel").then((module) => module.EvryPanel)
);

type EvryShellValue = Readonly<{
  activeContext: VisibleEvryPageContext | null;
  clearContext: () => void;
  closePanel: () => void;
  conversation: PublicEvryConversation | null;
  draft: string;
  error: string | null;
  expandToWorkspace: () => void;
  isEnabled: boolean;
  isComposerBlocked: boolean;
  isLoading: boolean;
  isPanelOpen: boolean;
  isSending: boolean;
  loadConversation: (conversationId: string) => Promise<void>;
  openPanel: (trigger: HTMLButtonElement) => void;
  restoreLauncherFocus: () => void;
  returnToPage: () => void;
  sendMessage: () => Promise<void>;
  setDraft: (draft: string) => void;
  statusMessage: string;
  suggestions: readonly EligibleEvrySuggestion[];
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
  const [statusMessage, setStatusMessage] = useState("");
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
  const previousPathnameRef = useRef(pathname);
  const draftRef = useRef(draft);

  const setDraft = useCallback((nextDraft: string) => {
    draftRef.current = nextDraft;
    setDraftState(nextDraft);
  }, []);

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
    [conversation?.id]
  );

  const sendMessage = useCallback(async () => {
    const message = evrySubmissionMessage(draft);
    if (
      message === null ||
      isSending ||
      isLoading ||
      requestedConversationId !== null ||
      conversationLoadStateRef.current.latest !== null
    ) {
      return;
    }

    setSending(true);
    setError(null);
    setStatusMessage("Saving your request…");
    try {
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
      pendingSubmissionRef.current = pendingSubmission;
      const body = evryConversationRequestBody(pendingSubmission);
      const response = await fetch(
        conversation
          ? `/api/evry/conversations/${conversation.id}/messages`
          : "/api/evry/conversations",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }
      );
      const nextConversation = await responseConversation(response);
      pendingSubmissionRef.current = null;
      setConversation(nextConversation);
      setDraft(evryDraftAfterSubmission(draftRef.current, message));
      setStatusMessage("Added to this conversation.");
    } catch {
      setError(
        "Unable to save your request. Check your connection and try again."
      );
      setStatusMessage("");
    } finally {
      setSending(false);
    }
  }, [
    activeContext,
    conversation,
    draft,
    isLoading,
    isSending,
    requestedConversationId,
    setDraft,
  ]);

  const value = useMemo<EvryShellValue>(
    () => ({
      activeContext,
      clearContext,
      closePanel,
      conversation,
      draft,
      error,
      expandToWorkspace,
      isEnabled: enabled,
      isComposerBlocked: isLoading || requestedConversationId !== null,
      isLoading,
      isPanelOpen,
      isSending,
      loadConversation,
      openPanel,
      restoreLauncherFocus,
      returnToPage,
      sendMessage,
      setDraft,
      statusMessage,
      suggestions,
    }),
    [
      activeContext,
      clearContext,
      closePanel,
      conversation,
      draft,
      enabled,
      error,
      expandToWorkspace,
      isLoading,
      isPanelOpen,
      isSending,
      loadConversation,
      openPanel,
      requestedConversationId,
      restoreLauncherFocus,
      returnToPage,
      sendMessage,
      setDraft,
      statusMessage,
      suggestions,
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
