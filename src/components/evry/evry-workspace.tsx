"use client";

import { ArrowLeft } from "lucide-react";
import dynamic from "next/dynamic";

import { EvryArtifactBrowserFixture } from "@/components/evry/artifacts/browser-fixture";
import { ConversationHistoryWorkspace } from "@/components/evry/conversation-history/conversation-history-workspace";
import { ConversationSurface } from "@/components/evry/conversation-surface";
import { useEvryShell } from "@/components/evry/evry-shell";
import { Button } from "@/components/ui/button";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import type { EvryConversationHistoryItem } from "@/lib/evry/conversations/history";

const EvryStreamingBrowserFixture = dynamic(() =>
  import("@/components/evry/streaming/browser-fixture").then(
    (module) => module.EvryStreamingBrowserFixture
  )
);

export function EvryWorkspace({
  conversations,
  conversationId,
  newConversation,
  searchQuery,
  showArtifactFixture = false,
  showStreamingFixture = false,
}: {
  conversations: readonly EvryConversationHistoryItem[];
  conversationId: string | null;
  newConversation: boolean;
  searchQuery: string | null;
  showArtifactFixture?: boolean;
  showStreamingFixture?: boolean;
}) {
  const { returnToPage } = useEvryShell();

  return (
    <PageCanvas
      contextItems={[{ label: "Evry" }]}
      contextAttachment="attached"
      contentClassName="flex"
    >
      <WorkspacePanel className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <header className="flex shrink-0 items-center gap-3 border-b px-4 py-3 sm:px-5">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={returnToPage}
            aria-label="Return to previous page"
            className="cursor-pointer active:scale-[0.96]"
          >
            <ArrowLeft aria-hidden="true" />
          </Button>
          <div className="min-w-0">
            <h1 className="font-semibold">Evry workspace</h1>
            <p className="text-muted-foreground text-sm">
              Your private conversation history
            </p>
          </div>
        </header>
        {showStreamingFixture ? (
          <EvryStreamingBrowserFixture />
        ) : showArtifactFixture ? (
          <EvryArtifactBrowserFixture />
        ) : (
          <ConversationHistoryWorkspace
            key={newConversation ? "new" : "history"}
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
