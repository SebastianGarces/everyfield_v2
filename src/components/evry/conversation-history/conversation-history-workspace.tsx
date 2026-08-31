"use client";

import { ArrowLeft, LoaderCircle, MessagesSquare } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { useEvryShell } from "@/components/evry/evry-shell";
import { syncEvryWorkspaceConversationHistory } from "@/components/evry/interaction-state";
import { Button } from "@/components/ui/button";
import type { EvryConversationHistoryItem } from "@/lib/evry/conversations/history";
import { cn } from "@/lib/utils";

import { ConversationHistoryCheckpoint } from "./history-checkpoint";
import { ConversationHistoryList, HistoryStateBadge } from "./history-list";
import {
  awaitingEvryCreatedConversation,
  canUseEvryHistoryComposer,
  canUseEvryNewComposer,
  conversationMatchesVisibleSearch,
  evryCreatedConversationSyncDecision,
  evryHistoryHref,
  evryHistorySelectedConversationId,
  evryHistoryStateForConversation,
  historyItemForCurrentConversation,
  latestEvryHistoryCheckpoint,
  shouldRestoreEvryNewComposer,
  type EvryCreatedConversationSyncMarker,
} from "./history-presentation";

export function ConversationHistoryWorkspace({
  conversations,
  conversationId,
  conversationSurface,
  newConversation,
  searchQuery,
}: {
  conversations: readonly EvryConversationHistoryItem[];
  conversationId: string | null;
  conversationSurface: ReactNode;
  newConversation: boolean;
  searchQuery: string | null;
}) {
  const {
    activeContext,
    conversation,
    draft,
    error,
    isLoading,
    isSending,
    isWorking,
    loadConversation,
    resetConversation,
    setDraft,
  } = useEvryShell();
  const [routeConversationId, setRouteConversationId] =
    useState(conversationId);
  const [routeNewConversation, setRouteNewConversation] =
    useState(newConversation);
  const restoreNewComposer = shouldRestoreEvryNewComposer({
    routeConversationId,
    loadedConversationId: conversation?.id ?? null,
    hasDraft: draft.length > 0,
    hasPageContext: activeContext !== null,
  });
  const ownsNewConversation = routeNewConversation || restoreNewComposer;
  const [newConversationOriginId] = useState(() =>
    routeNewConversation ? (conversation?.id ?? null) : null
  );
  const didResetNewModeRef = useRef(false);
  const createdConversationSyncMarkerRef =
    useRef<EvryCreatedConversationSyncMarker>(
      ownsNewConversation
        ? awaitingEvryCreatedConversation(newConversationOriginId)
        : null
    );
  const historyPaneRef = useRef<HTMLElement>(null);
  const detailPaneRef = useRef<HTMLElement>(null);
  const historyHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailHeadingRef = useRef<HTMLHeadingElement>(null);
  const detailStatusRef = useRef<HTMLDivElement>(null);
  const selectedConversationId = evryHistorySelectedConversationId({
    isCreatingNew: ownsNewConversation,
    previousConversationId: newConversationOriginId,
    mountedConversationId: conversation?.id ?? null,
    routeConversationId,
  });
  const isConversationNavigationPending =
    selectedConversationId !== null &&
    conversation?.id !== selectedConversationId;
  const selectedConversation =
    conversation?.id === selectedConversationId ? conversation : null;
  const isNewComposer = canUseEvryNewComposer({
    isCreatingNew: ownsNewConversation,
    mountedConversationId: conversation?.id ?? null,
  });
  const isNewComposerResetPending =
    ownsNewConversation && selectedConversationId === null && !isNewComposer;
  const hasDetail = selectedConversationId !== null || ownsNewConversation;
  const blocked =
    isLoading ||
    isSending ||
    isWorking ||
    isConversationNavigationPending ||
    isNewComposerResetPending;

  const visibleConversations = useMemo(() => {
    if (
      conversation === null ||
      !conversationMatchesVisibleSearch(conversation, searchQuery)
    ) {
      return conversations;
    }

    const existing = conversations.find(({ id }) => id === conversation.id);
    const current =
      existing?.lastActivityAt === conversation.lastActivityAt
        ? {
            ...existing,
            actionableState: evryHistoryStateForConversation(conversation),
          }
        : historyItemForCurrentConversation(conversation);
    return Object.freeze(
      [current, ...conversations.filter(({ id }) => id !== current.id)].sort(
        (left, right) => right.lastActivityAt.localeCompare(left.lastActivityAt)
      )
    );
  }, [conversation, conversations, searchQuery]);

  const selectedHistoryItem = visibleConversations.find(
    ({ id }) => id === selectedConversationId
  );
  const selectedState = selectedConversation
    ? evryHistoryStateForConversation(selectedConversation)
    : selectedHistoryItem?.actionableState;
  const checkpoint = selectedConversation
    ? latestEvryHistoryCheckpoint(selectedConversation)
    : null;
  const canUseSelectedComposer = canUseEvryHistoryComposer({
    navigationPending: isConversationNavigationPending,
    selectedConversationId,
    loadedConversationId: conversation?.id ?? null,
  });

  useEffect(() => {
    if (!routeNewConversation || didResetNewModeRef.current) return;
    didResetNewModeRef.current = true;
    resetConversation();
  }, [resetConversation, routeNewConversation]);

  useEffect(() => {
    function restoreLocation(): void {
      const params = new URLSearchParams(window.location.search);
      const nextConversationId = params.get("conversation");
      const nextNewConversation = params.get("new") === "1";
      setRouteConversationId(nextConversationId);
      setRouteNewConversation(nextNewConversation);
      didResetNewModeRef.current = !nextNewConversation;
      createdConversationSyncMarkerRef.current = nextNewConversation
        ? awaitingEvryCreatedConversation(conversation?.id ?? null)
        : null;
      if (nextNewConversation) resetConversation();
    }

    window.addEventListener("popstate", restoreLocation);
    return () => window.removeEventListener("popstate", restoreLocation);
  }, [conversation?.id, loadConversation, resetConversation]);

  useEffect(() => {
    const destinationPane = hasDetail
      ? detailPaneRef.current
      : historyPaneRef.current;
    if (
      destinationPane === null ||
      destinationPane.contains(document.activeElement)
    ) {
      return;
    }

    if (hasDetail) {
      (isNewComposer || (selectedConversation && canUseSelectedComposer)
        ? detailHeadingRef.current
        : detailStatusRef.current
      )?.focus();
      return;
    }

    historyHeadingRef.current?.focus();
  }, [canUseSelectedComposer, hasDetail, isNewComposer, selectedConversation]);

  useEffect(() => {
    if (
      ownsNewConversation ||
      routeConversationId === null ||
      routeConversationId === conversation?.id
    ) {
      return;
    }
    void loadConversation(routeConversationId);
  }, [
    conversation?.id,
    loadConversation,
    ownsNewConversation,
    routeConversationId,
  ]);

  useEffect(() => {
    const decision = evryCreatedConversationSyncDecision({
      marker: createdConversationSyncMarkerRef.current,
      mountedConversationId: conversation?.id ?? null,
      urlConversationId: routeConversationId,
    });
    createdConversationSyncMarkerRef.current = decision.nextMarker;
    if (decision.conversationIdToSync === null) return;

    setRouteConversationId(decision.conversationIdToSync);
    setRouteNewConversation(false);

    syncEvryWorkspaceConversationHistory(
      window.history.state,
      (state, unused, href) =>
        window.History.prototype.replaceState.call(
          window.history,
          state,
          unused,
          href
        ),
      null,
      decision.conversationIdToSync,
      searchQuery
    );
  }, [conversation?.id, routeConversationId, searchQuery]);

  function showConversationList(): void {
    if (blocked) return;
    createdConversationSyncMarkerRef.current = null;
    setRouteConversationId(null);
    setRouteNewConversation(false);
    window.history.pushState(
      window.history.state,
      "",
      evryHistoryHref({ search: searchQuery })
    );
  }

  function selectConversation(nextConversationId: string): void {
    if (blocked) return;
    createdConversationSyncMarkerRef.current = null;
    setRouteConversationId(nextConversationId);
    setRouteNewConversation(false);
    window.history.pushState(
      window.history.state,
      "",
      evryHistoryHref({
        conversationId: nextConversationId,
        search: searchQuery,
      })
    );
  }

  function startNewConversation(): void {
    if (blocked) return;
    createdConversationSyncMarkerRef.current = awaitingEvryCreatedConversation(
      conversation?.id ?? null
    );
    didResetNewModeRef.current = true;
    setRouteConversationId(null);
    setRouteNewConversation(true);
    resetConversation();
    window.history.pushState(
      window.history.state,
      "",
      evryHistoryHref({ newConversation: true, search: searchQuery })
    );
  }

  return (
    <div className="grid min-h-0 min-w-0 flex-1 overflow-hidden lg:grid-cols-[minmax(17rem,21rem)_minmax(0,1fr)]">
      <aside
        ref={historyPaneRef}
        aria-label="Conversation history"
        data-focus-pane="history"
        className={cn(
          "min-h-0 min-w-0 overflow-x-clip border-r lg:flex",
          hasDetail ? "hidden" : "flex"
        )}
      >
        <ConversationHistoryList
          blocked={blocked}
          conversations={visibleConversations}
          newConversationHref={evryHistoryHref({
            newConversation: true,
            search: searchQuery,
          })}
          onNew={startNewConversation}
          onSelect={selectConversation}
          headingRef={historyHeadingRef}
          searchQuery={searchQuery}
          selectedConversationId={selectedConversationId}
        />
      </aside>

      <section
        ref={detailPaneRef}
        aria-label="Selected conversation"
        data-focus-pane="detail"
        className={cn(
          "min-h-0 min-w-0 flex-col overflow-x-clip lg:flex",
          hasDetail ? "flex" : "hidden"
        )}
      >
        {isConversationNavigationPending ? (
          <ConversationOpeningStatus statusRef={detailStatusRef} />
        ) : isNewComposerResetPending ? (
          <ConversationStartingStatus statusRef={detailStatusRef} />
        ) : isNewComposer ? (
          <>
            <ConversationDetailHeader
              blocked={blocked}
              headingRef={detailHeadingRef}
              onBack={showConversationList}
              title="New conversation"
            />
            {conversationSurface}
          </>
        ) : selectedConversationId === null ? (
          <div className="flex min-h-0 flex-1 flex-col items-center justify-center p-8 text-center">
            <div className="bg-muted mb-4 grid size-12 place-items-center rounded-full">
              <MessagesSquare
                aria-hidden="true"
                className="text-muted-foreground size-5"
              />
            </div>
            <h2 className="font-semibold">Choose a conversation</h2>
            <p className="text-muted-foreground mt-1 max-w-sm text-sm leading-relaxed">
              Open earlier work or start a new conversation with Evry.
            </p>
          </div>
        ) : selectedConversation && canUseSelectedComposer ? (
          <>
            <ConversationDetailHeader
              blocked={blocked}
              headingRef={detailHeadingRef}
              onBack={showConversationList}
              state={selectedState}
              title={selectedConversation.title}
            />
            {checkpoint ? (
              <ConversationHistoryCheckpoint
                checkpoint={checkpoint}
                onRebuild={() => {
                  setDraft(
                    "Rebuild this plan with current records and permissions."
                  );
                  document.getElementById("evry-message")?.focus();
                }}
              />
            ) : null}
            {conversationSurface}
          </>
        ) : (
          <div
            ref={detailStatusRef}
            id="evry-conversation-status"
            tabIndex={-1}
            data-focus-pane="detail"
            className="flex min-h-0 flex-1 items-center justify-center p-8 text-center"
          >
            <div className="max-w-sm space-y-2">
              {isLoading ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="text-muted-foreground mx-auto size-5 animate-spin motion-reduce:animate-none"
                />
              ) : null}
              <p className="font-medium">
                {isLoading
                  ? "Opening conversation…"
                  : "Conversation unavailable"}
              </p>
              <p className="text-muted-foreground text-sm">
                {isLoading
                  ? "Your latest transcript and work state are loading."
                  : (error ??
                    "Return to the list and choose another conversation.")}
              </p>
              {!isLoading ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={showConversationList}
                  className="mt-2 cursor-pointer active:scale-[0.96]"
                >
                  <ArrowLeft aria-hidden="true" />
                  Back to conversations
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

function ConversationStartingStatus({
  statusRef,
}: {
  statusRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={statusRef}
      id="evry-conversation-status"
      tabIndex={-1}
      data-focus-pane="detail"
      className="flex min-h-0 flex-1 items-center justify-center p-8 text-center"
    >
      <div className="max-w-sm space-y-2">
        <p className="font-medium">Starting a new conversation…</p>
        <p className="text-muted-foreground text-sm">
          Preparing a clean composer.
        </p>
      </div>
    </div>
  );
}

function ConversationOpeningStatus({
  statusRef,
}: {
  statusRef: React.RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={statusRef}
      id="evry-conversation-status"
      tabIndex={-1}
      data-focus-pane="detail"
      className="flex min-h-0 flex-1 items-center justify-center p-8 text-center"
    >
      <div className="max-w-sm space-y-2">
        <LoaderCircle
          aria-hidden="true"
          className="text-muted-foreground mx-auto size-5 animate-spin motion-reduce:animate-none"
        />
        <p className="font-medium">Opening conversation…</p>
        <p className="text-muted-foreground text-sm">
          Your latest transcript and work state are loading.
        </p>
      </div>
    </div>
  );
}

function ConversationDetailHeader({
  blocked,
  headingRef,
  onBack,
  state,
  title,
}: {
  blocked: boolean;
  headingRef: React.RefObject<HTMLHeadingElement | null>;
  onBack: () => void;
  state?: EvryConversationHistoryItem["actionableState"];
  title: string;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-5">
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={blocked}
        onClick={onBack}
        aria-label="Back to conversations"
        className="cursor-pointer active:scale-[0.96] lg:hidden"
      >
        <ArrowLeft aria-hidden="true" />
      </Button>
      <div className="min-w-0 flex-1">
        <h2
          ref={headingRef}
          id="evry-conversation-heading"
          tabIndex={-1}
          data-focus-pane="detail"
          className="focus-visible:ring-ring truncate rounded-sm font-semibold outline-none focus-visible:ring-2"
        >
          {title}
        </h2>
        <p className="text-muted-foreground text-sm">
          Your private Evry conversation
        </p>
      </div>
      {state ? <HistoryStateBadge state={state} /> : null}
    </header>
  );
}
