"use client";

import { AlertCircle, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";

import type { PublicEvryConversation } from "@/components/evry/client-contract";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  buildEvryProgressArtifact,
  EVRY_UNEXPECTED_ERROR_COPY,
  type EvryArtifactError,
  type EvryDetailedConfirmationArtifactDocument,
  type EvryDetailedProgressArtifactDocument,
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

type ActivePlan = NonNullable<PublicEvryConversation["activePlan"]>;
type Action = EvryProductionArtifactAction;
type LocalError = EvryArtifactError | Readonly<{ kind: "uncertain" }>;

type LocalState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "submitting"; action: "cancel" | "edit" | "retry" }>
  | Readonly<{
      status: "progress";
      progress: EvryDetailedProgressArtifactDocument;
    }>
  | Readonly<{ status: "complete"; action: Action }>
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
      <Alert role="status" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
        <AlertTitle>
          {state.action === "retry"
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
    if (state.action === "execute" || state.action === "retry") return null;
    return (
      <Alert role="status" aria-live="polite">
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
      <Alert variant="destructive">
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
  conversationId,
  interactive,
  onConversation,
  onEdit,
}: {
  artifact: EvryPublicArtifact;
  activePlan: ActivePlan | null;
  conversationId: string;
  interactive: boolean;
  onConversation(conversation: PublicEvryConversation): void;
  onEdit(confirmation: EvryDetailedConfirmationArtifactDocument): void;
}) {
  const confirmation = detailedConfirmation(artifact);
  const progress = detailedProgress(artifact);
  const [state, setState] = useState<LocalState>({ status: "idle" });
  const actionStarted = useRef(false);
  const canControl =
    interactive &&
    state.status === "idle" &&
    ((confirmation !== null && sameActivePlan(confirmation, activePlan)) ||
      (progress !== null && sameActiveProgress(progress, activePlan)));

  async function run(action: Action) {
    const plan = confirmation?.plan ?? progress?.plan;
    if (
      !plan ||
      actionStarted.current ||
      !canControl ||
      (action === "retry" ? !progress : !confirmation)
    ) {
      return;
    }
    actionStarted.current = true;
    if (action === "execute" && confirmation) {
      setState({ status: "progress", progress: pendingProgress(confirmation) });
    } else if (action !== "execute") {
      setState({ status: "submitting", action });
    }

    const result = await coordinateEvryProductionArtifactRequest({
      conversationId,
      action,
      requestKey: crypto.randomUUID(),
      plan,
    });
    if (result.status === "conversation") {
      onConversation(result.conversation);
      setState({ status: "complete", action });
      if (action === "edit" && confirmation) onEdit(confirmation);
      return;
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
              : undefined
        }
      />
      <ActionNotice state={state} />
    </div>
  );
}
