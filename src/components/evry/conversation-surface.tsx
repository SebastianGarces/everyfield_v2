"use client";

import { LoaderCircle, MapPin, Send, X } from "lucide-react";
import { useEffect, useRef } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

import { EvryArtifactRenderer } from "./artifacts/artifact-renderer";
import { EvryProductionArtifact } from "./artifacts/production-artifact";
import { useEvryShell } from "./evry-shell";
import type { VisibleEvryPageContext } from "./page-context";
import { EvrySuggestionList } from "./suggestions/suggestion-list";
import {
  populateComposerFromSuggestion,
  shouldOfferEvrySuggestions,
} from "./suggestions/interaction";
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
    canStopWatching,
    clearContext,
    conversation,
    draft,
    error,
    isComposerBlocked,
    isLoading,
    isSending,
    isWatchingDetached,
    resumeWatching,
    sendMessage,
    setDraft,
    stopWatching,
    suggestions,
    workRequestId,
    workState,
  } = useEvryShell();
  const endRef = useRef<HTMLDivElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLFormElement>(null);
  const latestMessage = conversation?.messages.at(-1);
  const showSuggestions =
    !isSending &&
    workState.phase !== "reading" &&
    workState.phase !== "planning" &&
    workState.phase !== "execution" &&
    shouldOfferEvrySuggestions(conversation);
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
    const transcript = transcriptRef.current;
    if (
      transcript &&
      shouldFollowEvryTranscript({
        distanceFromEnd:
          transcript.scrollHeight -
          transcript.clientHeight -
          transcript.scrollTop,
        focusInComposer:
          composerRef.current?.contains(document.activeElement) ?? false,
      })
    ) {
      endRef.current?.scrollIntoView({ block: "nearest" });
    }
  }, [conversation?.messages.length, latestMessage]);

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div
        ref={transcriptRef}
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
                    message.author === "user" ? "justify-end" : "justify-start"
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
            {showSuggestions ? (
              <EvrySuggestionList
                suggestions={suggestions}
                onSelect={(suggestion) =>
                  populateComposerFromSuggestion(suggestion, setDraft, () =>
                    document.getElementById("evry-message")?.focus()
                  )
                }
              />
            ) : null}
          </div>
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
            {showSuggestions ? (
              <div className="mt-6 w-full">
                <EvrySuggestionList
                  suggestions={suggestions}
                  onSelect={(suggestion) =>
                    populateComposerFromSuggestion(suggestion, setDraft, () =>
                      document.getElementById("evry-message")?.focus()
                    )
                  }
                />
              </div>
            ) : null}
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="bg-background shrink-0 border-t px-4 pt-4 sm:px-5 sm:pt-5">
        <EvryPeopleFileWorkflow />
      </div>

      <form
        ref={composerRef}
        className="bg-background shrink-0 space-y-3 p-4 sm:p-5"
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
            aria-busy={isSending}
            className="max-h-40 min-h-20 resize-y text-base sm:text-sm"
          />
        </div>

        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <EvryWorkStatus
              acknowledgement={acknowledgement}
              activeRequestId={workRequestId}
              state={
                error && workState.phase !== "failed"
                  ? { phase: "failed", message: error }
                  : workState
              }
            />
            {canStopWatching || isWatchingDetached ? (
              <Button
                type="button"
                variant="link"
                size="sm"
                className="h-auto min-h-6 cursor-pointer px-0 py-0.5"
                onClick={isWatchingDetached ? resumeWatching : stopWatching}
              >
                {isWatchingDetached ? "Reconnect to this run" : "Stop watching"}
              </Button>
            ) : null}
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
