"use client";

import { ArrowUp, LoaderCircle, MapPin, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { EvryArtifactRenderer } from "./artifacts/artifact-renderer";
import { EvryProductionArtifact } from "./artifacts/production-artifact";
import { useEvryShell } from "./evry-shell";
import type { VisibleEvryPageContext } from "./page-context";
import { EvryWorkStatus } from "./streaming/work-status";
import { shouldFollowEvryTranscript } from "./interaction-state";
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
    acknowledgeConversationMounted,
    canStopWatching,
    clearContext,
    conversation,
    draft,
    pendingMessage,
    discardPendingMessage,
    error,
    isComposerBlocked,
    isLoading,
    isSending,
    isWatchingDetached,
    resumeWatching,
    sendMessage,
    sendMessageText,
    setDraft,
    stopWatching,
    workRequestId,
    workState,
  } = useEvryShell();
  const endRef = useRef<HTMLDivElement>(null);
  const surfaceRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const followTranscriptRef = useRef(true);
  const latestMessage = conversation?.messages.at(-1);
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
    conversation?.messages
      .flatMap((message) => message.artifacts)
      .findLast(
        ({ artifact }) =>
          (artifact.kind === "result" &&
            "artifactVersion" in artifact &&
            artifact.status === "completed" &&
            artifact.reuse !== undefined) ||
          ((artifact.kind === "confirmation" ||
            (artifact.kind === "progress" &&
              "artifactVersion" in artifact &&
              artifact.steps.some(({ status }) => status === "safe_retry"))) &&
            "artifactVersion" in artifact &&
            conversation.activePlan?.identity.planId === artifact.plan.planId &&
            conversation.activePlan.identity.fingerprint ===
              artifact.plan.fingerprint)
      )?.id ?? null;

  useEffect(() => {
    const conversationId = conversation?.id ?? null;
    followTranscriptRef.current = true;
    acknowledgeConversationMounted(conversationId);
    return () => acknowledgeConversationMounted(null);
  }, [acknowledgeConversationMounted, conversation?.id]);

  useEffect(() => {
    if (followTranscriptRef.current) {
      endRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [
    conversation?.messages.length,
    latestMessage,
    isLoading,
    isSending,
    pendingMessage,
    workState,
  ]);

  return (
    <div
      ref={surfaceRef}
      className={cn("relative isolate flex min-h-0 flex-1 flex-col", className)}
    >
      <div
        data-slot="evry-transcript"
        onScroll={(event) => {
          const transcript = event.currentTarget;
          // Capture the reader's position before a new reply changes its height.
          followTranscriptRef.current = shouldFollowEvryTranscript({
            distanceFromEnd:
              transcript.scrollHeight -
              transcript.clientHeight -
              transcript.scrollTop,
            focusInComposer: false,
          });
        }}
        className="min-h-0 flex-1 scroll-pb-[calc(var(--evry-composer-height,8rem)+2.5rem+env(safe-area-inset-bottom))] overflow-y-auto overscroll-contain px-4 pt-5 pb-[calc(var(--evry-composer-height,8rem)+2.5rem+env(safe-area-inset-bottom))] sm:px-5"
        aria-busy={isLoading}
      >
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col">
          {isLoading ? (
            <div className="text-muted-foreground flex min-h-32 items-center justify-center gap-2 text-sm">
              <LoaderCircle
                aria-hidden="true"
                className="size-4 animate-spin motion-reduce:animate-none"
              />
              Opening conversation…
            </div>
          ) : conversation?.messages.length ? (
            <div className="space-y-6">
              <ol
                role="log"
                aria-label="Conversation messages"
                aria-live="off"
                aria-relevant="additions text"
                className="space-y-4"
              >
                {conversation.messages.map((message) => (
                  <li
                    key={message.id}
                    className={cn(
                      "flex",
                      message.author === "user"
                        ? "justify-end"
                        : "justify-start"
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[92%] space-y-3 [overflow-wrap:anywhere] sm:max-w-[88%]",
                        message.author === "user" && "flex flex-col items-end"
                      )}
                    >
                      <div
                        className={cn(
                          "rounded-xl px-3.5 py-2.5 text-sm leading-relaxed",
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
                      </div>

                      {message.pageContext ? (
                        <EvryArtifactRenderer
                          model={{
                            variant: "context",
                            artifact: {
                              sourceKind: message.pageContext.kind,
                              recordId: message.pageContext.recordId,
                              label: message.pageContext.label,
                            },
                          }}
                        />
                      ) : null}

                      {message.artifacts.map(({ id, artifact }) => (
                        <EvryProductionArtifact
                          key={id}
                          artifact={artifact}
                          activePlan={conversation.activePlan}
                          artifactId={id}
                          conversationId={conversation.id}
                          conversationStateVersion={conversation.stateVersion}
                          interactive={id === activeArtifactId}
                          messageId={message.id}
                          onEdit={(confirmation) => {
                            setDraft("Revise this plan: " + confirmation.title);
                            requestAnimationFrame(() =>
                              document.getElementById("evry-message")?.focus()
                            );
                          }}
                        />
                      ))}
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
              className="mt-4 flex flex-col items-end gap-2"
              aria-label={
                pendingMessage.status === "failed"
                  ? "Unsent message"
                  : "Sending message"
              }
            >
              <p className="bg-primary text-primary-foreground max-w-[92%] rounded-xl px-3.5 py-2.5 text-sm leading-relaxed [overflow-wrap:anywhere] whitespace-pre-wrap sm:max-w-[88%]">
                <span className="sr-only">You: </span>
                {pendingMessage.body}
              </p>
              {pendingMessage.status === "failed" ? (
                <div className="flex items-center gap-2">
                  <span className="text-muted-foreground text-sm">
                    Not sent
                  </span>
                  <Button
                    type="button"
                    variant="outline"
                    className="min-h-11 cursor-pointer"
                    onClick={() => {
                      document.getElementById("evry-message")?.focus();
                      void sendMessageText(pendingMessage.body);
                    }}
                  >
                    Retry
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
                    Discard
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
                {isWatchingDetached ? "Reconnect to this run" : "Stop watching"}
              </Button>
            ) : null}
          </div>
          <div ref={endRef} />
        </div>
      </div>

      <form
        ref={composerRef}
        data-slot="evry-composer"
        className="bg-background focus-within:ring-ring absolute inset-x-3 bottom-[calc(0.75rem+env(safe-area-inset-bottom))] z-10 mx-auto max-w-3xl space-y-2 rounded-2xl border p-2 shadow-lg focus-within:ring-2 sm:inset-x-5"
        onSubmit={(event) => {
          event.preventDefault();
          followTranscriptRef.current = true;
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
