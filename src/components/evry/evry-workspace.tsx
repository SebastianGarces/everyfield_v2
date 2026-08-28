"use client";

import { ArrowLeft } from "lucide-react";
import { useEffect } from "react";

import { ConversationSurface } from "@/components/evry/conversation-surface";
import { useEvryShell } from "@/components/evry/evry-shell";
import { PageCanvas, WorkspacePanel } from "@/components/layout/page-frame";
import { Button } from "@/components/ui/button";

export function EvryWorkspace({
  conversationId,
}: {
  conversationId: string | null;
}) {
  const { loadConversation, returnToPage } = useEvryShell();

  useEffect(() => {
    if (conversationId) void loadConversation(conversationId);
  }, [conversationId, loadConversation]);

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
              Continue this conversation whenever you need it.
            </p>
          </div>
        </header>
        <ConversationSurface />
      </WorkspacePanel>
    </PageCanvas>
  );
}
