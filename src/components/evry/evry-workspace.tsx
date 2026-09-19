"use client";

import dynamic from "next/dynamic";
import { useState } from "react";
import { useEvryShell } from "./evry-shell";

import { EvryArtifactBrowserFixture } from "@/components/evry/artifacts/browser-fixture";
import { ConversationHistoryWorkspace } from "@/components/evry/conversation-history/conversation-history-workspace";
import { ConversationSurface } from "@/components/evry/conversation-surface";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import type { EvryConversationHistoryItem } from "@/lib/evry/conversations/history";

const EvryStreamingBrowserFixture = dynamic(() =>
  import("@/components/evry/streaming/browser-fixture").then(
    (module) => module.EvryStreamingBrowserFixture
  )
);
const EvryRunRecoveryBrowserFixture = dynamic(() =>
  import("@/components/evry/streaming/run-recovery-browser-fixture").then(
    (module) => module.EvryRunRecoveryBrowserFixture
  )
);

export function EvryWorkspace({
  conversations,
  conversationId,
  newConversation,
  searchQuery,
  showArtifactFixture = false,
  showStreamingFixture = false,
  showRunRecoveryFixture = false,
}: {
  conversations: readonly EvryConversationHistoryItem[];
  conversationId: string | null;
  newConversation: boolean;
  searchQuery: string | null;
  showArtifactFixture?: boolean;
  showStreamingFixture?: boolean;
  showRunRecoveryFixture?: boolean;
}) {
  const { conversation } = useEvryShell();
  const routeIdentity = `${newConversation ? "new" : "history"}:${conversationId ?? ""}:${searchQuery ?? ""}`;
  const [workspace, setWorkspace] = useState({
    routeIdentity,
    key: routeIdentity,
    newConversation,
    searchQuery,
  });
  if (workspace.routeIdentity !== routeIdentity) {
    // Saving a new chat changes its URL, not the reader's conversation.
    // Keep its mounted transcript through the authoritative history refresh.
    const adoptedCreation =
      workspace.newConversation &&
      !newConversation &&
      conversationId !== null &&
      conversation?.id === conversationId &&
      workspace.searchQuery === searchQuery;
    setWorkspace({
      routeIdentity,
      key: adoptedCreation ? workspace.key : routeIdentity,
      newConversation,
      searchQuery,
    });
  }
  return (
    <PageCanvas
      context="none"
      contentFocusTarget
      className="p-0 sm:p-0"
      contentClassName="flex"
    >
      <WorkspacePanel className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-none border-0 shadow-none">
        <h1 className="sr-only">Evry</h1>
        {showRunRecoveryFixture ? (
          <EvryRunRecoveryBrowserFixture />
        ) : showStreamingFixture ? (
          <EvryStreamingBrowserFixture />
        ) : showArtifactFixture ? (
          <EvryArtifactBrowserFixture />
        ) : (
          <ConversationHistoryWorkspace
            key={workspace.key}
            conversations={conversations}
            conversationId={conversationId}
            conversationSurface={<ConversationSurface />}
            newConversation={newConversation}
            searchQuery={searchQuery}
          />
        )}
      </WorkspacePanel>
    </PageCanvas>
  );
}
