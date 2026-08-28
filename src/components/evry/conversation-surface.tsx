"use client";

import { LoaderCircle, MapPin, Send, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { useEvryShell } from "./evry-shell";
import type { VisibleEvryPageContext } from "./page-context";

export function EvryContextChip({
  context,
  onRemove,
}: {
  context: VisibleEvryPageContext;
  onRemove: () => void;
}) {
  return (
    <div
      aria-label="Page context"
      className="flex flex-wrap items-center gap-2"
    >
      <Badge
        variant="secondary"
        className="max-w-full gap-1.5 py-1 pr-1 pl-2 text-sm font-normal"
      >
        <MapPin aria-hidden="true" className="size-3.5 shrink-0" />
        <span className="truncate">{context.label}</span>
        <button
          type="button"
          onClick={onRemove}
          aria-label={`Remove ${context.label} context`}
          className="hover:bg-foreground/10 focus-visible:ring-ring grid size-6 shrink-0 cursor-pointer place-items-center rounded-sm focus-visible:ring-2 focus-visible:outline-none"
        >
          <X aria-hidden="true" className="size-3.5" />
        </button>
      </Badge>
    </div>
  );
}

export function ConversationSurface({ className }: { className?: string }) {
  const {
    activeContext,
    clearContext,
    conversation,
    draft,
    error,
    isComposerBlocked,
    isLoading,
    isSending,
    sendMessage,
    setDraft,
    statusMessage,
  } = useEvryShell();
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "nearest" });
  }, [conversation?.messages.length]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div
        data-slot="evry-transcript"
        className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5"
        aria-busy={isLoading}
      >
        {isLoading ? (
          <div className="text-muted-foreground flex min-h-32 items-center justify-center gap-2 text-sm">
            <LoaderCircle
              aria-hidden="true"
              className="size-4 animate-spin motion-reduce:animate-none"
            />
            Opening conversation…
          </div>
        ) : conversation?.messages.length ? (
          <ol
            role="log"
            aria-label="Conversation messages"
            aria-live="polite"
            aria-relevant="additions text"
            className="space-y-4"
          >
            {conversation.messages.map((message) => (
              <li
                key={message.id}
                className={cn(
                  "flex",
                  message.author === "user" ? "justify-end" : "justify-start"
                )}
              >
                <div
                  className={cn(
                    "max-w-[88%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere]",
                    message.author === "user"
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-foreground"
                  )}
                >
                  <p className="whitespace-pre-wrap">
                    <span className="sr-only">
                      {message.author === "user" ? "You" : "Evry"}:{" "}
                    </span>
                    {message.body}
                  </p>
                  {message.pageContext ? (
                    <p className="mt-2 flex items-center gap-1 text-xs opacity-75">
                      <MapPin aria-hidden="true" className="size-3" />
                      <span>{message.pageContext.label}</span>
                    </p>
                  ) : null}
                </div>
              </li>
            ))}
          </ol>
        ) : (
          <div className="mx-auto flex min-h-48 max-w-sm flex-col items-center justify-center text-center">
            <div className="bg-muted mb-4 grid size-10 place-items-center rounded-full">
              <Send
                aria-hidden="true"
                className="text-muted-foreground size-4"
              />
            </div>
            <h2 className="font-semibold">Start with an EveryField task</h2>
            <p className="text-muted-foreground mt-1 text-sm leading-relaxed text-pretty">
              Ask Evry to help with people, meetings, teams, tasks, or your
              launch.
            </p>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form
        className="bg-background shrink-0 space-y-3 border-t p-4 sm:p-5"
        onSubmit={(event) => {
          event.preventDefault();
          void sendMessage();
        }}
      >
        {activeContext ? (
          <EvryContextChip context={activeContext} onRemove={clearContext} />
        ) : null}

        <div className="space-y-2">
          <label htmlFor="evry-message" className="text-sm font-medium">
            Message Evry
          </label>
          <Textarea
            id="evry-message"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Create a follow-up task for Friday"
            rows={3}
            required
            maxLength={8_000}
            className="max-h-40 min-h-20 resize-y text-base sm:text-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : (
              <p
                role="status"
                aria-live="polite"
                className="text-muted-foreground text-sm"
              >
                {statusMessage}
              </p>
            )}
          </div>
          <Button
            type="submit"
            disabled={
              draft.trim().length === 0 || isSending || isComposerBlocked
            }
            className="cursor-pointer active:scale-[0.96]"
          >
            {isSending ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <Send aria-hidden="true" />
            )}
            {isSending ? "Sending…" : "Send"}
          </Button>
        </div>
      </form>
    </div>
  );
}
