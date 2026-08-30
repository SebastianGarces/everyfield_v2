"use client";

import { AlertCircle, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  parseEvryConversationEnvelope,
  type PublicEvryConversation,
} from "@/components/evry/client-contract";
import { useEvryShell } from "@/components/evry/evry-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  buildEvryProgressArtifact,
  EVRY_UNEXPECTED_ERROR_COPY,
  type EvryArtifactError,
  type EvryDetailedConfirmationArtifactDocument,
  type EvryDetailedProgressArtifactDocument,
  type EvryDetailedReceiptArtifactDocument,
} from "@/lib/evry/artifacts/review";
import type { EvryPublicArtifact } from "@/lib/evry/artifacts/public";

import {
  EvryArtifactRenderer,
  renderableEvryArtifact,
} from "./artifact-renderer";
import {
  coordinateEvryProductionArtifactRequest,
  type EvryProductionArtifactAction,
} from "./production-request";
import {
  clearEvryRunRecoveryMarker,
  writeEvryRunRecoveryMarker,
} from "../streaming/run-recovery";

type ActivePlan = NonNullable<PublicEvryConversation["activePlan"]>;
type Action = EvryProductionArtifactAction;
type LocalError = EvryArtifactError | Readonly<{ kind: "uncertain" }>;

type LocalState =
  | Readonly<{ status: "idle" }>
  | Readonly<{
      status: "submitting";
      action: "cancel" | "edit" | "retry" | "reuse";
    }>
  | Readonly<{
      status: "progress";
      progress: EvryDetailedProgressArtifactDocument;
    }>
  | Readonly<{ status: "complete"; action: Action | "reuse" }>
  | Readonly<{ status: "error"; error: LocalError }>;

function detailedConfirmation(
  artifact: EvryPublicArtifact
): EvryDetailedConfirmationArtifactDocument | null {
  return artifact.kind === "confirmation" && "artifactVersion" in artifact
    ? artifact
    : null;
}

function detailedProgress(
  artifact: EvryPublicArtifact
): EvryDetailedProgressArtifactDocument | null {
  return artifact.kind === "progress" && "artifactVersion" in artifact
    ? artifact
    : null;
}

function detailedReceipt(
  artifact: EvryPublicArtifact
): EvryDetailedReceiptArtifactDocument | null {
  return artifact.kind === "result" && "artifactVersion" in artifact
    ? artifact
    : null;
}

function pendingProgress(
  confirmation: EvryDetailedConfirmationArtifactDocument
): EvryDetailedProgressArtifactDocument {
  return buildEvryProgressArtifact({
    kind: "progress",
    artifactVersion: 1,
    plan: confirmation.plan,
    title: "Running: " + confirmation.title,
    error: null,
    steps: confirmation.steps.map((step, index) => ({
      stepId: step.stepId,
      label: step.title,
      status: index === 0 ? "active" : "pending",
      affectedCount: 0,
      excludedCount: 0,
    })),
  });
}

function sameActivePlan(
  confirmation: EvryDetailedConfirmationArtifactDocument,
  activePlan: ActivePlan | null
): boolean {
  return (
    activePlan?.confirmable === true &&
    activePlan.status === "awaiting_confirmation" &&
    activePlan.identity.planId === confirmation.plan.planId &&
    activePlan.identity.fingerprint === confirmation.plan.fingerprint
  );
}

function sameActiveProgress(
  progress: EvryDetailedProgressArtifactDocument,
  activePlan: ActivePlan | null
): boolean {
  return (
    (activePlan?.status === "approved" || activePlan?.status === "executing") &&
    activePlan.identity.planId === progress.plan.planId &&
    activePlan.identity.fingerprint === progress.plan.fingerprint &&
    progress.steps.some(({ status }) => status === "safe_retry")
  );
}

function ActionNotice({ state }: { state: LocalState }) {
  if (state.status === "submitting") {
    return (
      <Alert role="group">
        <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
        <AlertTitle>
          {state.action === "reuse"
            ? "Refreshing this recipe…"
            : state.action === "retry"
              ? "Retrying this exact plan…"
              : state.action === "edit"
                ? "Invalidating this confirmation…"
                : "Cancelling this plan…"}
        </AlertTitle>
        <AlertDescription>
          No execution control is available while this request is being saved.
        </AlertDescription>
      </Alert>
    );
  }
  if (state.status === "complete") {
    if (
      state.action === "execute" ||
      state.action === "retry" ||
      state.action === "reuse"
    )
      return null;
    return (
      <Alert role="group">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>
          {state.action === "edit"
            ? "Confirmation invalidated"
            : "Plan cancelled"}
        </AlertTitle>
        <AlertDescription>
          {state.action === "edit"
            ? "Update the request below. Evry must show a fresh confirmation before it can act."
            : "No disclosed effect was started."}
        </AlertDescription>
      </Alert>
    );
  }
  if (state.status === "error") {
    return (
      <Alert role="group" variant="destructive">
        <AlertCircle aria-hidden="true" />
        <AlertTitle>
          {state.error.kind === "expected"
            ? "This plan needs attention"
            : "Evry couldn't complete this request"}
        </AlertTitle>
        <AlertDescription>
          <p>
            {state.error.kind === "expected"
              ? state.error.message
              : state.error.kind === "unexpected"
                ? EVRY_UNEXPECTED_ERROR_COPY
                : "Evry couldn't confirm the outcome. Reopen this conversation before trying anything else."}
          </p>
          {state.error.kind === "unexpected" ? (
            <p>
              Support reference:{" "}
              <span className="font-mono">{state.error.correlationId}</span>
            </p>
          ) : null}
        </AlertDescription>
      </Alert>
    );
  }
  return null;
}

export function EvryProductionArtifact({
  artifact,
  activePlan,
  artifactId,
  conversationId,
  conversationStateVersion,
  interactive,
  messageId,
  onEdit,
}: {
  artifact: EvryPublicArtifact;
  activePlan: ActivePlan | null;
  artifactId: string;
  conversationId: string;
  conversationStateVersion: number;
  interactive: boolean;
  messageId: string;
  onEdit(confirmation: EvryDetailedConfirmationArtifactDocument): void;
}) {
  const confirmation = detailedConfirmation(artifact);
  const progress = detailedProgress(artifact);
  const receipt = detailedReceipt(artifact);
  const {
    applyWorkConversation,
    beginWork,
    finishWork,
    isWorking,
    navigateToConversation,
    observeWork,
    updateWork,
  } = useEvryShell();
  const [state, setState] = useState<LocalState>({ status: "idle" });
  const actionStarted = useRef<Readonly<{
    action: Action;
    stateVersion: number;
  }> | null>(null);
  useEffect(() => {
    const started = actionStarted.current;
    if (!started || conversationStateVersion <= started.stateVersion) return;
    actionStarted.current = null;
    setState({ status: "complete", action: started.action });
  }, [conversationStateVersion]);
  const canControl =
    !isWorking &&
    interactive &&
    state.status === "idle" &&
    ((confirmation !== null && sameActivePlan(confirmation, activePlan)) ||
      (progress !== null && sameActiveProgress(progress, activePlan)));
  const canReuse =
    !isWorking &&
    interactive &&
    state.status === "idle" &&
    receipt?.status === "completed" &&
    receipt.reuse !== undefined;

  async function reuseRecipe() {
    if (!canReuse || !receipt?.reuse) return;
    const requestKey = crypto.randomUUID();
    beginWork(requestKey, {
      phase: "reading",
      message: "Refreshing this recipe from current application data",
    });
    setState({ status: "submitting", action: "reuse" });
    requestAnimationFrame(() =>
      document.getElementById("evry-work-status")?.focus()
    );
    try {
      const response = await fetch(
        `/api/evry/conversations/${encodeURIComponent(conversationId)}/reuse`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ requestKey, resultArtifactId: artifactId }),
        }
      );
      if (!response.ok) throw new Error("reuse unavailable");
      const nextConversation = parseEvryConversationEnvelope(
        await response.json()
      );
      if (!applyWorkConversation(requestKey, 1, nextConversation)) {
        throw new Error("stale reuse response");
      }
      navigateToConversation(nextConversation.id);
      finishWork(requestKey, 2);
      setState({ status: "complete", action: "reuse" });
    } catch {
      updateWork(requestKey, 1, {
        phase: "failed",
        message:
          "Unable to reuse this recipe. Reopen the receipt and try again.",
      });
      finishWork(requestKey, 2);
      setState({
        status: "error",
        error: {
          kind: "expected",
          message:
            "Unable to reuse this recipe. Reopen the receipt and try again.",
        },
      });
    }
  }

  async function run(action: Action) {
    const plan = confirmation?.plan ?? progress?.plan;
    if (
      !plan ||
      actionStarted.current !== null ||
      !canControl ||
      (action === "retry" ? !progress : !confirmation)
    ) {
      return;
    }
    actionStarted.current = {
      action,
      stateVersion: conversationStateVersion,
    };
    const requestKey = crypto.randomUUID();
    const recoverable = action === "execute" || action === "retry";
    const controller = new AbortController();
    if (recoverable) {
      writeEvryRunRecoveryMarker({
        requestId: requestKey,
        kind: "execution",
        conversationId,
      });
      observeWork(requestKey, controller);
    }
    if (action === "execute" && confirmation) {
      beginWork(requestKey, {
        phase: "execution",
        message: confirmation.steps[0]?.title ?? "Starting the confirmed plan",
      });
      setState({ status: "progress", progress: pendingProgress(confirmation) });
    } else if (action !== "execute") {
      beginWork(requestKey, {
        phase: action === "retry" ? "execution" : "reading",
        message:
          action === "retry"
            ? "Retrying this exact plan"
            : action === "edit"
              ? "Invalidating this confirmation"
              : "Cancelling this plan",
      });
      setState({ status: "submitting", action });
    }
    requestAnimationFrame(() =>
      document.getElementById("evry-work-status")?.focus()
    );

    const result = await coordinateEvryProductionArtifactRequest({
      conversationId,
      action,
      requestKey,
      plan,
      baseline: {
        stateVersion: conversationStateVersion,
        messageId,
        artifactId,
      },
      signal: recoverable ? controller.signal : undefined,
    });
    if (controller.signal.aborted) return;
    if (result.status === "conversation") {
      if (recoverable) clearEvryRunRecoveryMarker(requestKey);
      if (!applyWorkConversation(requestKey, 1, result.conversation)) return;
      if (action === "cancel" || action === "edit") {
        updateWork(requestKey, 2, {
          phase: "complete",
          message:
            action === "edit"
              ? "Confirmation invalidated. Update the request for a fresh review."
              : "Plan cancelled. Nothing was executed.",
        });
        finishWork(requestKey, 3);
      } else {
        finishWork(requestKey, 2);
      }
      setState({ status: "complete", action });
      if (action === "edit" && confirmation) onEdit(confirmation);
      return;
    }
    updateWork(requestKey, 1, {
      phase: result.error.kind === "expected" ? "blocked" : "failed",
      message:
        result.error.kind === "expected"
          ? result.error.message
          : result.error.kind === "unexpected"
            ? EVRY_UNEXPECTED_ERROR_COPY
            : "Evry could not confirm the outcome. Reopen this conversation before trying anything else.",
    });
    finishWork(requestKey, 2);
    if (recoverable && result.error.kind !== "uncertain") {
      clearEvryRunRecoveryMarker(requestKey);
    }
    setState({ status: "error", error: result.error });
  }

  if (state.status === "progress") {
    return (
      <EvryArtifactRenderer
        model={{ variant: "progress", artifact: state.progress }}
      />
    );
  }
  return (
    <div className="space-y-2">
      <EvryArtifactRenderer
        model={renderableEvryArtifact(artifact)}
        options={
          canControl && confirmation
            ? {
                confirmationControls: {
                  onCancel: () => void run("cancel"),
                  onEdit: () => void run("edit"),
                  onExecute: () => void run("execute"),
                },
              }
            : canControl && progress
              ? {
                  progressControls: {
                    onSafeRetry: () => void run("retry"),
                  },
                }
              : receipt?.reuse && interactive
                ? {
                    receiptControls: {
                      disabled: !canReuse,
                      label: receipt.reuse.label,
                      onReuse: () => void reuseRecipe(),
                    },
                  }
                : undefined
        }
      />
      <ActionNotice state={state} />
    </div>
  );
}
