"use client";

import { ArrowDown, ArrowUp, LoaderCircle, MapPin, X } from "lucide-react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { projectEveMessage } from "./eve-message-projection";
import { EveQuestionOptions } from "./eve-client/question-options";
import { evryResponseMarkdown } from "./response-markdown";
import { RichText } from "@/components/shared/rich-text";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { EvryProductionArtifact } from "./artifacts/production-artifact";
import { useEvryShell } from "./evry-shell";
import type { VisibleEvryPageContext } from "./page-context";
import { EvryWorkStatus } from "./streaming/work-status";
import { evryResponseRevealOffset } from "./interaction-state";
import { EvryPeopleFileWorkflow } from "./people-file-workflow";

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
    acknowledgement,
    canStopWatching,
    clearContext,
    conversation,
    messages,
    draft,
    pendingMessage,
    discardPendingMessage,
    error,
    isComposerBlocked,
    isLoading,
    isRestoringHistory,
    isSending,
    isWatchingDetached,
    resumeWatching,
    recoveryLabel,
    sendMessage,
    setDraft,
    stopWatching,
    workRequestId,
    workState,
  } = useEvryShell();
  const transcriptRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const responseStartRef = useRef<HTMLElement | null>(null);
  const transcriptContentRef = useRef<HTMLDivElement>(null);
  const contentEndRef = useRef<HTMLDivElement>(null);
  const openedConversationRef = useRef<string | null | undefined>(undefined);
  const positionedResponseRef = useRef<string | null>(null);
  const positionedRequestRef = useRef<string | null>(null);
  const readerMovedRef = useRef(false);
  const conversationId = conversation?.id ?? null;
  const [scrollback, setScrollback] = useState({
    conversationId,
    visible: false,
  });
  if (scrollback.conversationId !== conversationId) {
    setScrollback({ conversationId, visible: false });
  }
  const showJumpToLatest =
    scrollback.conversationId === conversationId && scrollback.visible;
  const latestMessage = messages.at(-1);
  const hasMessages = messages.length > 0;
  const pendingRequestId = hasMessages ? workRequestId : null;
  const responseKey =
    latestMessage?.role === "assistant"
      ? (latestMessage.metadata?.turnId ?? latestMessage.id)
      : null;
  useEffect(() => {
    const composer = composerRef.current;
    if (!composer) return;
    const observer = new ResizeObserver(() => {
      surfaceRef.current?.style.setProperty(
        "--evry-composer-height",
        `${composer.offsetHeight}px`
      );
    });
    observer.observe(composer);
    return () => observer.disconnect();
  }, []);
  const activeArtifactId =
    messages
      .flatMap(projectEveMessage)
      .findLast((part) => part.kind === "artifact" && "plan" in part.artifact)
      ?.key ?? null;

  useLayoutEffect(() => {
    const transcript = transcriptRef.current;
    // Saved metadata arrives before Eve attaches its replayed transcript. Do
    // not consume initial positioning while that conversation is still empty.
    if (
      !transcript ||
      isLoading ||
      isRestoringHistory ||
      (conversationId && !hasMessages)
    )
      return;
    if (openedConversationRef.current !== conversationId) {
      const adoptingRequest =
        positionedRequestRef.current !== null &&
        positionedRequestRef.current === workRequestId;
      openedConversationRef.current = conversationId;
      if (!adoptingRequest) {
        transcript.scrollTop = transcript.scrollHeight;
        positionedRequestRef.current = null;
        positionedResponseRef.current = responseKey;
        readerMovedRef.current = false;
      }
    }
    if (pendingRequestId && positionedRequestRef.current !== pendingRequestId) {
      positionedRequestRef.current = pendingRequestId;
      readerMovedRef.current = false;
      transcript.scrollTop = transcript.scrollHeight;
    }
    const response = responseStartRef.current;
    if (
      responseKey &&
      response &&
      positionedResponseRef.current !== responseKey
    ) {
      positionedResponseRef.current = responseKey;
      // Reveal only an offscreen beginning, once. Streaming growth never follows.
      if (!readerMovedRef.current) {
        const viewport = transcript.getBoundingClientRect();
        const beginning = response.getBoundingClientRect();
        const offset = evryResponseRevealOffset({
          responseTop: beginning.top,
          responseHeight: beginning.height,
          viewportTop: viewport.top,
          viewportBottom: Math.min(
            viewport.bottom,
            composerRef.current?.getBoundingClientRect().top ?? viewport.bottom
          ),
        });
        if (offset !== 0) transcript.scrollTop += offset;
      }
    }
  }, [
    conversationId,
    hasMessages,
    isLoading,
    isRestoringHistory,
    pendingRequestId,
    responseKey,
    workRequestId,
  ]);

  const updateScrollback = useCallback(() => {
    const transcript = transcriptRef.current;
    const end = contentEndRef.current;
    if (!transcript || !end) return;
    const viewport = transcript.getBoundingClientRect();
    const visibleBottom = Math.min(
      viewport.bottom,
      composerRef.current?.getBoundingClientRect().top ?? viewport.bottom
    );
    // Ignore composer clearance and empty layout space, not actual content.
    const visible =
      transcript.scrollHeight > transcript.clientHeight + 1 &&
      end.getBoundingClientRect().bottom > visibleBottom + 16;
    setScrollback((current) =>
      current.conversationId === conversationId && current.visible === visible
        ? current
        : { conversationId, visible }
    );
  }, [conversationId]);

  useEffect(() => {
    const transcript = transcriptRef.current;
    const content = transcriptContentRef.current;
    if (!transcript || !content) return;
    const observer = new ResizeObserver(updateScrollback);
    observer.observe(transcript);
    observer.observe(content);
    if (composerRef.current) observer.observe(composerRef.current);
    return () => observer.disconnect();
  }, [updateScrollback]);

  return (
    <div
      ref={surfaceRef}
      className={cn(
        "relative isolate flex min-h-0 flex-1 flex-col overflow-hidden",
        className
      )}
    >
      <div
        ref={transcriptRef}
        data-slot="evry-transcript"
        onWheel={() => {
          readerMovedRef.current = true;
        }}
        onTouchMove={() => {
          readerMovedRef.current = true;
        }}
        onPointerDown={() => {
          readerMovedRef.current = true;
        }}
        onKeyDown={(event) => {
          if (
            [
              "ArrowUp",
              "ArrowDown",
              "PageUp",
              "PageDown",
              "Home",
              "End",
              " ",
            ].includes(event.key)
          ) {
            readerMovedRef.current = true;
          }
        }}
        onScroll={updateScrollback}
        className="relative min-h-0 flex-1 scroll-pb-[calc(var(--evry-composer-height,8rem)+2.5rem+env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain px-4 pt-5 pb-[calc(var(--evry-composer-height,8rem)+2.5rem+env(safe-area-inset-bottom))] [overflow-anchor:none] sm:px-5"
        aria-busy={isLoading}
      >
        <div
          ref={transcriptContentRef}
          className="mx-auto flex min-h-full w-full max-w-3xl flex-col"
        >
          {isLoading ? (
            <div className="text-muted-foreground flex min-h-32 items-center justify-center gap-2 text-sm">
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              Opening conversation…
            </div>
          ) : messages.length ? (
            <div className="space-y-6">
              <ol
                role="log"
                aria-label="Conversation messages"
                aria-live="off"
                aria-relevant="additions text"
                className="space-y-4"
              >
                {messages.map((message) => (
                  <li
                    key={message.id}
                    ref={
                      message === latestMessage && message.role === "assistant"
                        ? (node) => {
                            responseStartRef.current = node;
                          }
                        : undefined
                    }
                    data-response-start={
                      message === latestMessage && message.role === "assistant"
                        ? "saved"
                        : undefined
                    }
                    className={cn(
                      "flex",
                      message.role === "user" ? "justify-end" : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[92%] space-y-3 [overflow-wrap:anywhere] sm:max-w-[88%]",
                        message.role === "user" && "flex flex-col items-end"
                      )}
                    >
                      {projectEveMessage(message).map((part, index) =>
                        part.kind !== "artifact" ? (
                          <div
                            key={`text:${index}`}
                            className={cn(
                              "rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
                              message.role === "user"
                                ? "bg-primary text-primary-foreground"
                                : "bg-muted text-foreground"
                            )}
                          >
                            <span className="sr-only">
                              {message.role === "user" ? "You" : "Evry"}:{" "}
                            </span>
                            {message.role === "user" ? (
                              <p className="whitespace-pre-wrap">
                                {part.kind !== "text" ? part.prompt : part.text}
                              </p>
                            ) : (
                              <RichText
                                body={evryResponseMarkdown(
                                  part.kind !== "text" ? part.prompt : part.text
                                )}
                              />
                            )}
                            {part.kind !== "text" ? (
                              <EveQuestionOptions requestId={part.requestId} />
                            ) : null}
                          </div>
                        ) : (
                          <EvryProductionArtifact
                            key={part.key}
                            artifact={part.artifact}
                            interactive={part.key === activeArtifactId}
                            onEdit={(confirmation) => {
                              setDraft(
                                "Revise this plan: " + confirmation.title
                              );
                              requestAnimationFrame(() =>
                                document.getElementById("evry-message")?.focus()
                              );
                            }}
                          />
                        )
                      )}
                    </div>
                  </li>
                ))}
              </ol>
            </div>
          ) : !pendingMessage && !isSending ? (
            <div className="flex flex-1 items-center justify-center py-12 text-center">
              <h2 className="text-2xl font-medium text-balance sm:text-3xl">
                What can I help you with today?
              </h2>
            </div>
          ) : null}
          {pendingMessage ? (
            <div
              className={cn(
                "flex flex-col items-end gap-2",
                messages.length && "mt-4"
              )}
              aria-label={
                pendingMessage.status === "failed"
                  ? "Interrupted request"
                  : "Sending message"
              }
            >
              {!pendingMessage.savedMessageId ? (
                <p className="bg-primary text-primary-foreground max-w-[92%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap sm:max-w-[88%]">
                  <span className="sr-only">You: </span>
                  {pendingMessage.body}
                </p>
              ) : null}
              {pendingMessage.status === "failed" ? (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm">
                    Response interrupted
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 cursor-pointer"
                    onClick={() => {
                      document.getElementById("evry-message")?.focus();
                      resumeWatching();
                    }}
                  >
                    {recoveryLabel}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-11 cursor-pointer"
                    onClick={() => {
                      document.getElementById("evry-message")?.focus();
                      discardPendingMessage();
                    }}
                  >
                    Dismiss
                  </Button>
                </div>
              ) : null}
            </div>
          ) : null}
          <div className="mt-4 space-y-1">
            <div
              className={cn(
                !error &&
                  (workState.phase === "complete" ||
                    workState.phase === "confirmation") &&
                  "sr-only focus-within:not-sr-only"
              )}
            >
              <EvryWorkStatus
                acknowledgement={acknowledgement}
                activeRequestId={workRequestId}
                state={
                  error && workState.phase !== "failed"
                    ? { phase: "failed", message: error }
                    : workState
                }
              />
            </div>
            {canStopWatching || isWatchingDetached ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="min-h-11 px-0"
                onClick={isWatchingDetached ? resumeWatching : stopWatching}
              >
                {isWatchingDetached ? "Reconnect" : "Stop response"}
              </Button>
            ) : null}
          </div>
          <div
            ref={contentEndRef}
            data-slot="evry-content-end"
            aria-hidden="true"
          />
        </div>
      </div>

      {showJumpToLatest ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="absolute bottom-[calc(var(--evry-composer-height,7rem)+1.5rem)] left-1/2 z-10 -translate-x-1/2 rounded-full shadow-sm"
          onClick={() => {
            readerMovedRef.current = true;
            setScrollback({ conversationId, visible: false });
            const transcript = transcriptRef.current;
            if (transcript) transcript.scrollTop = transcript.scrollHeight;
          }}
        >
          <ArrowDown aria-hidden="true" className="size-4" />
          Jump to latest
        </Button>
      ) : null}
      <form
        ref={composerRef}
        data-slot="evry-composer"
        className="bg-background focus-within:ring-ring absolute inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 mx-auto max-w-3xl space-y-2 rounded-2xl border p-2 shadow-lg focus-within:ring-2 sm:inset-x-5"
        onSubmit={(event) => {
          event.preventDefault();
          readerMovedRef.current = false;
          void sendMessage();
        }}
      >
        {activeContext ? (
          <EvryContextChip context={activeContext} onRemove={clearContext} />
        ) : null}

        <div className="space-y-2">
          <label htmlFor="evry-message" className="sr-only">
            Message Evry
          </label>
          <Textarea
            id="evry-message"
            autoFocus={draft.length > 0}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Message Evry…"
            rows={1}
            onKeyDown={(event) => {
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                if (!isSending && !isComposerBlocked && draft.trim())
                  event.currentTarget.form?.requestSubmit();
              }
            }}
            required
            maxLength={8_000}
            aria-busy={isSending}
            className="field-sizing-content max-h-40 min-h-12 resize-none border-0 bg-transparent px-3 py-3 text-base shadow-none focus-visible:ring-0 sm:text-sm dark:bg-transparent"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <EvryPeopleFileWorkflow />
          <Button
            type="submit"
            disabled={
              draft.trim().length === 0 || isSending || isComposerBlocked
            }
            aria-label="Send message"
            size="icon"
            className="size-11 cursor-pointer rounded-full"
          >
            {isSending ? (
              <LoaderCircle
                aria-hidden="true"
                className="animate-spin motion-reduce:animate-none"
              />
            ) : (
              <ArrowUp aria-hidden="true" />
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
