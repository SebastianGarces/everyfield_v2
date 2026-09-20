"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { z } from "zod";
import { useEvryShell } from "../evry-shell";
import {
  evryPublicArtifactSchema,
  type EvryPublicArtifact,
} from "@/lib/evry/artifacts/public";
import { publicEvryActivePlanSchema } from "@/lib/evry/conversations/public-contract";
import type { EvryDetailedConfirmationArtifactDocument } from "@/lib/evry/artifacts/review";
import {
  EvryArtifactRenderer,
  renderableEvryArtifact,
} from "./artifact-renderer";

const envelope = z.object({
  status: z.literal("available"),
  plan: publicEvryActivePlanSchema,
  artifact: evryPublicArtifactSchema,
});

/** Approval travels through the app-owned exact-plan endpoint, never an LLM tool. */
export function EvryProductionArtifact({
  artifact,
  interactive,
  onEdit,
}: {
  artifact: EvryPublicArtifact;
  interactive: boolean;
  onEdit(confirmation: EvryDetailedConfirmationArtifactDocument): void;
}) {
  const { isWorking, updatePlan, setExecuting, sendMessageText } =
    useEvryShell();
  const router = useRouter();
  const [current, setCurrent] = useState<z.infer<typeof envelope> | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitting = useRef(false);
  const plan = "plan" in artifact ? artifact.plan : null;
  const planId = plan?.planId;
  const fingerprint = plan?.fingerprint;
  useEffect(() => {
    if (!planId || !fingerprint) return;
    const controller = new AbortController();
    void fetch(
      `/api/evry/eve/plans/${planId}?fingerprint=${encodeURIComponent(fingerprint)}`,
      { cache: "no-store", signal: controller.signal }
    )
      .then(async (response) => {
        if (!response.ok) throw new Error("review unavailable");
        const next = envelope.parse(await response.json());
        if (controller.signal.aborted) return;
        setCurrent(next);
        if (interactive) updatePlan(next.plan);
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Unable to load this review. Reopen the conversation to try again."
          );
      });
    return () => controller.abort();
  }, [planId, fingerprint, interactive, updatePlan]);

  const shown = current?.artifact ?? artifact;
  const confirmation =
    shown.kind === "confirmation" && "artifactVersion" in shown ? shown : null;
  const progress =
    shown.kind === "progress" && "artifactVersion" in shown ? shown : null;
  const receipt =
    shown.kind === "result" && "artifactVersion" in shown ? shown : null;
  const canControl =
    interactive && !busy && !isWorking && current?.plan.confirmable;

  async function act(action: "confirm" | "retry" | "cancel" | "edit") {
    if (!planId || !fingerprint || submitting.current) return;
    submitting.current = true;
    setBusy(true);
    setError(null);
    setExecuting(true);
    try {
      const response = await fetch(`/api/evry/eve/plans/${planId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fingerprint, action }),
      });
      if (!response.ok) throw new Error("review changed");
      const next = envelope.parse(await response.json());
      setCurrent(next);
      updatePlan(next.plan);
      if (action === "edit" && confirmation) onEdit(confirmation);
      if (action === "confirm" || action === "retry") router.refresh();
    } catch {
      setError(
        "Unable to confirm the outcome. Reopen this conversation to check the plan before trying again."
      );
    } finally {
      submitting.current = false;
      setBusy(false);
      setExecuting(false);
    }
  }
  return (
    <div className="space-y-2">
      <EvryArtifactRenderer
        model={renderableEvryArtifact(shown)}
        options={
          canControl && confirmation
            ? {
                confirmationControls: {
                  onCancel: () => void act("cancel"),
                  onEdit: () => void act("edit"),
                  onExecute: () => void act("confirm"),
                },
              }
            : interactive &&
                !busy &&
                !isWorking &&
                progress?.steps.some((step) => step.status === "safe_retry")
              ? {
                  progressControls: { onSafeRetry: () => void act("retry") },
                }
              : receipt?.reuse && interactive
                ? {
                    receiptControls: {
                      disabled: busy || isWorking,
                      label: receipt.reuse.label,
                      onReuse: () =>
                        void sendMessageText(
                          `Prepare this workflow again: ${receipt.title}. Refresh the current information and show me a new review before making changes.`
                        ),
                    },
                  }
                : undefined
        }
      />
      {busy ? (
        <p role="status" className="text-muted-foreground text-sm">
          Updating this plan…
        </p>
      ) : null}
      {current?.plan.status === "cancelled" ? (
        <p className="text-muted-foreground text-sm">
          This plan was cancelled. Nothing will be sent from this review.
        </p>
      ) : null}
      {error ? (
        <p role="alert" className="text-destructive text-sm">
          {error}
        </p>
      ) : null}
    </div>
  );
}
