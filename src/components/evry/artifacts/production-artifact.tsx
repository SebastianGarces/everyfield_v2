"use client";

import { AlertCircle, LoaderCircle } from "lucide-react";
import { useRef, useState } from "react";

import {
  parseEvryArtifactLifecycleResponse,
  type PublicEvryConversation,
} from "@/components/evry/client-contract";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  buildEvryProgressArtifact,
  buildEvryReceiptArtifact,
  EVRY_UNEXPECTED_ERROR_COPY,
  type EvryArtifactError,
  type EvryDetailedConfirmationArtifactDocument,
  type EvryDetailedProgressArtifactDocument,
  type EvryDetailedReceiptArtifactDocument,
} from "@/lib/evry/artifacts/review";
import type { EvryPublicArtifact } from "@/lib/evry/artifacts/public";
import { evryConversationResultCodeFor } from "@/lib/evry/conversations/contract";

import {
  EvryArtifactRenderer,
  renderableEvryArtifact,
} from "./artifact-renderer";

type ActivePlan = NonNullable<PublicEvryConversation["activePlan"]>;

type LocalState =
  | Readonly<{ status: "idle" }>
  | Readonly<{ status: "submitting"; action: "cancel" | "edit" }>
  | Readonly<{
      status: "progress";
      progress: EvryDetailedProgressArtifactDocument;
    }>
  | Readonly<{
      status: "receipt";
      receipt: EvryDetailedReceiptArtifactDocument;
    }>
  | Readonly<{ status: "complete"; action: "cancel" | "edit" | "execute" }>
  | Readonly<{ status: "error"; error: EvryArtifactError }>;

function detailedConfirmation(
  artifact: EvryPublicArtifact
): EvryDetailedConfirmationArtifactDocument | null {
  return artifact.kind === "confirmation" && "artifactVersion" in artifact
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
    steps: confirmation.steps.map((step, index) => ({
      stepId: step.stepId,
      label: step.title,
      status: index === 0 ? "active" : "pending",
      affectedCount: 0,
      excludedCount: 0,
    })),
  });
}

function failedReceipt(
  confirmation: EvryDetailedConfirmationArtifactDocument,
  error: EvryArtifactError
): EvryDetailedReceiptArtifactDocument {
  return buildEvryReceiptArtifact({
    kind: "result",
    artifactVersion: 1,
    plan: confirmation.plan,
    title: "Receipt: " + confirmation.title,
    status: "failed",
    steps: confirmation.steps.map((step) => ({
      stepId: step.stepId,
      label: step.title,
      status: "failed",
      resultCode: evryConversationResultCodeFor("failed"),
      affectedCount: 0,
      excludedCount: 0,
      sourceLinks: step.resolvedTargets.flatMap(({ sourceLink }) =>
        sourceLink ? [sourceLink] : []
      ),
      retry: { status: "unavailable" },
      error,
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

function ActionNotice({ state }: { state: LocalState }) {
  if (state.status === "submitting") {
    return (
      <Alert role="status" aria-live="polite">
        <LoaderCircle aria-hidden="true" className="motion-safe:animate-spin" />
        <AlertTitle>
          {state.action === "edit"
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
    if (state.action === "execute") return null;
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
              : EVRY_UNEXPECTED_ERROR_COPY}
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
  const [state, setState] = useState<LocalState>({ status: "idle" });
  const actionStarted = useRef(false);
  const canControl =
    interactive &&
    state.status === "idle" &&
    confirmation !== null &&
    sameActivePlan(confirmation, activePlan);

  async function run(action: "cancel" | "edit" | "execute") {
    if (!confirmation || actionStarted.current || !canControl) return;
    actionStarted.current = true;
    setState(
      action === "execute"
        ? { status: "progress", progress: pendingProgress(confirmation) }
        : { status: "submitting", action }
    );
    try {
      const response = await fetch(
        "/api/evry/conversations/" +
          encodeURIComponent(conversationId) +
          "/artifacts",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            action,
            requestKey: crypto.randomUUID(),
            plan: confirmation.plan,
          }),
        }
      );
      const body: unknown = await response.json();
      const result = parseEvryArtifactLifecycleResponse(body);
      if ("conversation" in result) {
        onConversation(result.conversation);
        setState({ status: "complete", action });
        if (action === "edit") onEdit(confirmation);
        return;
      }
      if (action === "execute") {
        setState({
          status: "receipt",
          receipt: failedReceipt(confirmation, result.error),
        });
      } else {
        setState({ status: "error", error: result.error });
      }
    } catch {
      const error = {
        kind: "unexpected" as const,
        correlationId: crypto.randomUUID(),
      };
      if (action === "execute") {
        setState({
          status: "receipt",
          receipt: failedReceipt(confirmation, error),
        });
      } else {
        setState({ status: "error", error });
      }
    }
  }

  if (state.status === "progress") {
    return (
      <EvryArtifactRenderer
        model={{ variant: "progress", artifact: state.progress }}
      />
    );
  }
  if (state.status === "receipt") {
    return (
      <EvryArtifactRenderer
        model={{ variant: "receipt", artifact: state.receipt }}
      />
    );
  }

  return (
    <div className="space-y-2">
      <EvryArtifactRenderer
        model={renderableEvryArtifact(artifact)}
        options={
          canControl
            ? {
                confirmationControls: {
                  onCancel: () => void run("cancel"),
                  onEdit: () => void run("edit"),
                  onExecute: () => void run("execute"),
                },
              }
            : undefined
        }
      />
      <ActionNotice state={state} />
    </div>
  );
}
