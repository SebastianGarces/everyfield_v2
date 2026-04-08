"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, History, MoreHorizontal, RotateCcw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import type {
  AssistantMessageRecord,
  AssistantThreadDetail,
  AssistantThreadSummary,
} from "@/lib/assistant/types";
import { AssistantChatComposer } from "./chat-composer";
import { AssistantHistorySheet } from "./history-sheet";
import { AssistantTranscript } from "./transcript";
import { AssistantWorkspacePane } from "./workspace-pane";

export function AssistantShell({
  initialHistory,
  initialDetail,
}: {
  initialHistory: AssistantThreadSummary[];
  initialDetail: AssistantThreadDetail;
}) {
  const router = useRouter();
  const [input, setInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSending, setIsSending] = useState(false);
  const [isCreatingConversation, setIsCreatingConversation] = useState(false);
  const [isClearingHistory, setIsClearingHistory] = useState(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [isClearDialogOpen, setIsClearDialogOpen] = useState(false);
  const [isClearHistoryDialogOpen, setIsClearHistoryDialogOpen] =
    useState(false);
  const [history, setHistory] = useState(initialHistory);
  const [messages, setMessages] = useState(initialDetail.messages);
  const [artifacts, setArtifacts] = useState(initialDetail.artifacts);

  const hasArtifacts = artifacts.length > 0;
  const isCurrentConversationEmpty =
    messages.length === 0 && artifacts.length === 0;

  async function createFreshConversation() {
    setError(null);
    setIsCreatingConversation(true);

    try {
      const response = await fetch("/api/v1/assistant/threads", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({}),
      });

      const data = (await response.json()) as {
        thread?: AssistantThreadSummary;
        error?: string;
      };

      if (!response.ok || !data.thread) {
        setError(data.error ?? "Failed to start a fresh conversation");
        return;
      }

      router.push(`/assistant/${data.thread.id}`);
    } catch {
      setError("Failed to start a fresh conversation");
    } finally {
      setIsCreatingConversation(false);
      setIsClearDialogOpen(false);
    }
  }

  async function handleSendMessage() {
    const trimmedInput = input.trim();

    if (!trimmedInput || isSending) {
      return;
    }

    setError(null);
    setInput("");
    setIsSending(true);

    const optimisticUserMessage: AssistantMessageRecord = {
      id: `temp-${crypto.randomUUID()}`,
      role: "user",
      content: trimmedInput,
      metadata: null,
      createdAt: new Date().toISOString(),
    };
    const previousMessages = messages;
    setMessages([...previousMessages, optimisticUserMessage]);

    try {
      const response = await fetch(
        `/api/v1/assistant/threads/${initialDetail.thread.id}/messages`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            content: trimmedInput,
          }),
        }
      );

      const data = (await response.json()) as
        | AssistantThreadDetail
        | { error?: string };

      if (!response.ok || !("thread" in data)) {
        setMessages(previousMessages);
        setInput(trimmedInput);
        setError(
          "error" in data
            ? (data.error ?? "Failed to send message")
            : "Failed to send message"
        );
        return;
      }

      setMessages(data.messages);
      setArtifacts(data.artifacts);
    } catch {
      setMessages(previousMessages);
      setInput(trimmedInput);
      setError("Failed to send message");
    } finally {
      setIsSending(false);
    }
  }

  async function handleClearHistory() {
    setError(null);
    setIsClearingHistory(true);

    try {
      const response = await fetch("/api/v1/assistant/history/clear", {
        method: "POST",
      });

      const data = (await response.json()) as {
        deletedCount?: number;
        error?: string;
      };

      if (!response.ok) {
        setError(data.error ?? "Failed to clear history");
        return;
      }

      setHistory([]);
    } catch {
      setError("Failed to clear history");
    } finally {
      setIsClearingHistory(false);
    }
  }

  return (
    <>
      <div className="flex min-h-[calc(100vh-10rem)] flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <h1 className="text-xl font-semibold tracking-tight">
              AI Assistant
            </h1>
            <p className="text-muted-foreground text-sm">
              One conversation. Real work.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="cursor-pointer rounded-full"
              onClick={() => setIsHistoryOpen(true)}
            >
              <History className="mr-2 h-4 w-4" />
              History
              {history.length > 0 ? (
                <span className="bg-muted text-muted-foreground ml-2 rounded-full px-2 py-0.5 text-[11px]">
                  {history.length}
                </span>
              ) : null}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="cursor-pointer rounded-full"
                  aria-label="Conversation options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-52">
                <DropdownMenuItem
                  className="cursor-pointer"
                  disabled={
                    isCurrentConversationEmpty || isCreatingConversation
                  }
                  onClick={() => setIsClearDialogOpen(true)}
                >
                  <RotateCcw className="h-4 w-4" />
                  Clear conversation
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        <div
          className={cn(
            "grid min-h-0 flex-1 gap-8",
            hasArtifacts && "xl:grid-cols-[minmax(0,1fr)_22rem]"
          )}
        >
          <section className="flex min-h-[calc(100vh-13rem)] min-w-0 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto px-2 py-2">
              {isCurrentConversationEmpty ? (
                <div className="h-full" />
              ) : (
                <AssistantTranscript messages={messages} />
              )}
            </div>

            <div className="mt-auto px-0 pb-0">
              {error ? (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{error}</AlertDescription>
                </Alert>
              ) : null}

              <div className="rounded-[28px] border bg-white p-3 shadow-[0_12px_40px_rgba(15,23,42,0.08)]">
                <AssistantChatComposer
                  value={input}
                  onChange={setInput}
                  onSend={handleSendMessage}
                  isSending={isSending}
                />
              </div>
            </div>
          </section>

          {hasArtifacts ? (
            <aside className="min-h-[calc(100vh-15rem)]">
              <AssistantWorkspacePane artifacts={artifacts} />
            </aside>
          ) : null}
        </div>
      </div>

      <AssistantHistorySheet
        open={isHistoryOpen}
        onOpenChange={setIsHistoryOpen}
        history={history}
        onRequestClearHistory={() => setIsClearHistoryDialogOpen(true)}
        isClearingHistory={isClearingHistory}
      />

      <AlertDialog open={isClearDialogOpen} onOpenChange={setIsClearDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear this conversation?</AlertDialogTitle>
            <AlertDialogDescription>
              We’ll move it to History and open a blank one here.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Nevermind
            </AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer"
              onClick={createFreshConversation}
            >
              Clear conversation
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={isClearHistoryDialogOpen}
        onOpenChange={setIsClearHistoryDialogOpen}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Clear archived history?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes archived assistant conversations permanently. Your
              current active conversation will stay in place.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="cursor-pointer">
              Keep history
            </AlertDialogCancel>
            <AlertDialogAction
              className="cursor-pointer"
              onClick={async () => {
                await handleClearHistory();
                setIsClearHistoryDialogOpen(false);
              }}
            >
              Clear history
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
