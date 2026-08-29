"use client";

import { LoaderCircle, MessageSquarePlus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition, type RefObject } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { EvryConversationHistoryItem } from "@/lib/evry/conversations/history";
import { cn } from "@/lib/utils";

import {
  EVRY_HISTORY_STATE_PRESENTATION,
  evryHistoryHref,
} from "./history-presentation";

function HistoryStateBadge({
  state,
}: {
  state: EvryConversationHistoryItem["actionableState"];
}) {
  const presentation = EVRY_HISTORY_STATE_PRESENTATION[state];
  return (
    <Badge
      variant={presentation.tone === "danger" ? "destructive" : "outline"}
      data-state={state}
      className={cn(
        "shrink-0",
        presentation.tone === "progress" && "bg-muted text-foreground",
        presentation.tone === "success" && "bg-muted text-foreground",
        presentation.tone === "attention" && "bg-background text-foreground"
      )}
    >
      {presentation.label}
    </Badge>
  );
}

export function ConversationHistoryList({
  blocked,
  conversations,
  headingRef,
  onSelect,
  newConversationHref,
  searchQuery,
  selectedConversationId,
}: {
  blocked: boolean;
  conversations: readonly EvryConversationHistoryItem[];
  headingRef: RefObject<HTMLHeadingElement | null>;
  newConversationHref: string;
  onSelect: (conversationId: string) => void;
  searchQuery: string | null;
  selectedConversationId: string | null;
}) {
  const router = useRouter();
  const [isSearchPending, startSearchTransition] = useTransition();

  return (
    <div
      data-testid="evry-history-pane-content"
      className="flex min-h-0 max-w-full min-w-0 flex-1 flex-col overflow-x-clip"
    >
      <div className="shrink-0 space-y-4 p-4 sm:p-5">
        <div className="flex min-w-0 flex-wrap items-start gap-3">
          <div className="min-w-0 flex-[1_1_10rem]">
            <h2
              ref={headingRef}
              id="evry-history-heading"
              tabIndex={-1}
              data-focus-pane="history"
              className="focus-visible:ring-ring rounded-sm text-xl font-semibold tracking-tight outline-none focus-visible:ring-2"
            >
              Conversations
            </h2>
            <p className="text-muted-foreground mt-1 text-sm">
              Return to work that needs your attention.
            </p>
          </div>
          <Button asChild variant="outline" size="sm">
            <a
              href={newConversationHref}
              aria-disabled={blocked || undefined}
              onClick={(event) => {
                if (blocked) {
                  event.preventDefault();
                  return;
                }
                if (
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey
                ) {
                  return;
                }
              }}
              data-testid="evry-history-new"
              className={cn(
                "ml-auto max-w-full shrink-0 cursor-pointer active:scale-[0.96]",
                blocked && "cursor-default opacity-60"
              )}
            >
              <MessageSquarePlus aria-hidden="true" />
              New
            </a>
          </Button>
        </div>

        <form
          role="search"
          className="min-w-0 space-y-2"
          onSubmit={(event) => {
            event.preventDefault();
            if (blocked) return;
            const form = new FormData(event.currentTarget);
            const value = form.get("q");
            const search =
              typeof value === "string" && value.trim().length > 0
                ? value.trim()
                : null;
            startSearchTransition(() => {
              router.push(
                evryHistoryHref({
                  conversationId: selectedConversationId,
                  search,
                })
              );
            });
          }}
        >
          <label htmlFor="evry-history-search" className="text-sm font-medium">
            Search conversations
          </label>
          <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] gap-2">
            <div className="relative min-w-0 flex-1">
              <Search
                aria-hidden="true"
                className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2"
              />
              <Input
                key={searchQuery ?? ""}
                id="evry-history-search"
                name="q"
                type="search"
                defaultValue={searchQuery ?? ""}
                maxLength={120}
                disabled={blocked}
                placeholder="Meeting invitation"
                className="pl-9 text-base sm:text-sm"
              />
            </div>
            <Button
              type="submit"
              variant="secondary"
              disabled={blocked || isSearchPending}
              className="cursor-pointer active:scale-[0.96]"
            >
              {isSearchPending ? (
                <LoaderCircle
                  aria-hidden="true"
                  className="animate-spin motion-reduce:animate-none"
                />
              ) : (
                <Search aria-hidden="true" />
              )}
              Search
            </Button>
          </div>
        </form>

        <p role="status" aria-live="polite" className="sr-only">
          {searchQuery
            ? `${conversations.length} conversation${conversations.length === 1 ? "" : "s"} found for ${searchQuery}.`
            : `${conversations.length} conversation${conversations.length === 1 ? "" : "s"}.`}
        </p>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3 sm:px-3">
        {conversations.length > 0 ? (
          <nav aria-label="Conversation history">
            <ol className="space-y-1">
              {conversations.map((conversation) => {
                const selected = conversation.id === selectedConversationId;
                return (
                  <li
                    key={conversation.id}
                    className="[contain-intrinsic-size:auto_5rem] [content-visibility:auto]"
                  >
                    <Link
                      href={evryHistoryHref({
                        conversationId: conversation.id,
                        search: searchQuery,
                      })}
                      aria-current={selected ? "page" : undefined}
                      aria-disabled={blocked || undefined}
                      onClick={(event) => {
                        if (blocked) {
                          event.preventDefault();
                          return;
                        }
                        if (
                          event.metaKey ||
                          event.ctrlKey ||
                          event.shiftKey ||
                          event.altKey
                        ) {
                          return;
                        }
                        event.preventDefault();
                        onSelect(conversation.id);
                      }}
                      data-testid={`evry-history-row-${conversation.id}`}
                      className={cn(
                        "focus-visible:ring-ring block cursor-pointer rounded-lg px-3 py-3 transition-colors focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none",
                        selected
                          ? "bg-muted text-foreground"
                          : "hover:bg-muted/60",
                        blocked && "cursor-default opacity-60"
                      )}
                    >
                      <span className="block truncate text-sm font-medium">
                        {conversation.title}
                      </span>
                      <span className="mt-2 flex flex-wrap items-center justify-between gap-2">
                        <time
                          dateTime={conversation.lastActivityAt}
                          title={conversation.lastActivityTitle}
                          className="text-muted-foreground text-xs"
                        >
                          {conversation.lastActivityLabel}
                        </time>
                        <HistoryStateBadge
                          state={conversation.actionableState}
                        />
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ol>
          </nav>
        ) : (
          <div className="flex min-h-48 flex-col items-center justify-center px-5 text-center">
            <p className="font-medium">
              {searchQuery
                ? `No conversations match "${searchQuery}"`
                : "No conversations yet"}
            </p>
            <p className="text-muted-foreground mt-1 max-w-xs text-sm">
              {searchQuery
                ? "Try another title or a phrase from the visible transcript."
                : "Start a conversation and it will stay here when you return."}
            </p>
            {searchQuery ? (
              <Button asChild variant="ghost" size="sm" className="mt-3">
                <Link
                  href={evryHistoryHref({
                    conversationId: selectedConversationId,
                  })}
                  aria-disabled={blocked || undefined}
                  onClick={(event) => {
                    if (blocked) event.preventDefault();
                  }}
                  className={cn(
                    "cursor-pointer",
                    blocked && "cursor-default opacity-60"
                  )}
                >
                  <X aria-hidden="true" />
                  Clear search
                </Link>
              </Button>
            ) : (
              <Button asChild size="sm">
                <a
                  href={newConversationHref}
                  aria-disabled={blocked || undefined}
                  onClick={(event) => {
                    if (blocked) {
                      event.preventDefault();
                      return;
                    }
                    if (
                      event.metaKey ||
                      event.ctrlKey ||
                      event.shiftKey ||
                      event.altKey
                    ) {
                      return;
                    }
                  }}
                  className={cn(
                    "mt-3 cursor-pointer active:scale-[0.96]",
                    blocked && "cursor-default opacity-60"
                  )}
                >
                  <MessageSquarePlus aria-hidden="true" />
                  Start a conversation
                </a>
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

export { HistoryStateBadge };
