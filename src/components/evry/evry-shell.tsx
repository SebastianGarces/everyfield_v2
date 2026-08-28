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
  visibleEvryPageContextFor,
  type VisibleEvryPageContext,
} from "./page-context";

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
}: {
  children: ReactNode;
  enabled: boolean;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const { breadcrumbs } = useHeader();
  const visibleContext = useMemo(
    () => visibleEvryPageContextFor(pathname, breadcrumbs),
    [breadcrumbs, pathname]
  );
  const [activeContext, setActiveContext] =
    useState<VisibleEvryPageContext | null>(null);
  const [conversation, setConversation] =
    useState<PublicEvryConversation | null>(null);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState("");
  const [isPanelOpen, setPanelOpen] = useState(false);
  const [hasOpenedPanel, setHasOpenedPanel] = useState(false);
  const [isSending, setSending] = useState(false);
  const [isLoading, setLoading] = useState(false);
  const [expandedFromPanel, setExpandedFromPanel] = useState(false);
  const launcherRef = useRef<HTMLButtonElement | null>(null);
  const loadingConversationIdRef = useRef<string | null>(null);
  const previousPathnameRef = useRef(pathname);

  useEffect(() => {
    const previousPathname = previousPathnameRef.current;
    previousPathnameRef.current = pathname;
    if (
      expandedFromPanel &&
      previousPathname === "/evry" &&
      pathname !== "/evry"
    ) {
      setExpandedFromPanel(false);
      setPanelOpen(true);
    }
  }, [expandedFromPanel, pathname]);

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
      setExpandedFromPanel(false);
      setPanelOpen(true);
      router.back();
      return;
    }
    router.push("/dashboard");
  }, [expandedFromPanel, router]);

  const clearContext = useCallback(() => setActiveContext(null), []);

  const loadConversation = useCallback(
    async (conversationId: string) => {
      if (
        conversation?.id === conversationId ||
        loadingConversationIdRef.current === conversationId
      ) {
        return;
      }
      loadingConversationIdRef.current = conversationId;
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/evry/conversations/${encodeURIComponent(conversationId)}`,
          { cache: "no-store" }
        );
        setConversation(await responseConversation(response));
      } catch {
        setError("Unable to open this conversation. Try again.");
      } finally {
        if (loadingConversationIdRef.current === conversationId) {
          loadingConversationIdRef.current = null;
        }
        setLoading(false);
      }
    },
    [conversation?.id]
  );

  const sendMessage = useCallback(async () => {
    const message = draft.trim();
    if (!message || isSending) return;

    setSending(true);
    setError(null);
    setStatusMessage("Saving your request…");
    try {
      const body = JSON.stringify({
        requestKey: crypto.randomUUID(),
        message,
        pageContext: activeContext?.wire ?? null,
      });
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
      setConversation(nextConversation);
      setDraft("");
      setStatusMessage("Added to this conversation.");

      if (pathname === "/evry") {
        router.replace(`/evry?conversation=${nextConversation.id}`);
      }
    } catch {
      setError(
        "Unable to save your request. Check your connection and try again."
      );
      setStatusMessage("");
    } finally {
      setSending(false);
    }
  }, [activeContext, conversation, draft, isSending, pathname, router]);

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
      restoreLauncherFocus,
      returnToPage,
      sendMessage,
      statusMessage,
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
