"use client";

import { AlertTriangle, CheckCircle2, Pencil, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  applyFreshEvryConfirmation,
  beginEvryArtifactEdit,
  beginEvryArtifactExecution,
  cancelEvryArtifactReview,
  finishEvryArtifactExecution,
  type EvryArtifactInteractionState,
} from "@/lib/evry/artifacts/interaction";
import {
  editedMeetingConfirmation,
  INITIAL_MEETING_CONFIRMATION,
  meetingProgressFixture,
  partialMeetingReceiptFixture,
} from "@/lib/evry/artifacts/fixtures";
import { evryPublicArtifactSchema } from "@/lib/evry/artifacts/public";

import {
  EvryArtifactRenderer,
  renderableEvryArtifact,
} from "./artifact-renderer";

const INITIAL_RECIPIENT = "Taylor Brooks · taylor@example.test";

/** Preview-only interaction proof. It never calls a model, route, or effect. */
export function EvryArtifactBrowserFixture() {
  const [state, setState] = useState<EvryArtifactInteractionState>({
    status: "review",
    confirmation: INITIAL_MEETING_CONFIRMATION,
  });
  const stateRef = useRef(state);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recipient, setRecipient] = useState(INITIAL_RECIPIENT);
  const [notice, setNotice] = useState(
    "Review the exact plan, then edit one recipient."
  );
  const [acceptedExecutions, setAcceptedExecutions] = useState(0);

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    []
  );

  function replaceState(next: EvryArtifactInteractionState) {
    stateRef.current = next;
    setState(next);
  }

  function editPlan() {
    replaceState(beginEvryArtifactEdit(stateRef.current));
    setNotice(
      "The prior confirmation is invalid. Prepare a fresh review before execution."
    );
  }

  async function prepareFreshReview() {
    const fresh = await editedMeetingConfirmation(recipient.trim());
    replaceState(applyFreshEvryConfirmation(stateRef.current, fresh));
    setNotice(`Fresh confirmation prepared for ${recipient.trim()}.`);
  }

  function executePlan() {
    const current = stateRef.current;
    if (current.status !== "review") return;
    const progress = meetingProgressFixture(current.confirmation.plan);
    const transition = beginEvryArtifactExecution(current, progress);
    replaceState(transition.state);
    if (!transition.shouldExecute) return;

    setAcceptedExecutions((count) => count + 1);
    setNotice("Execution started once. A second press cannot start it again.");
    timerRef.current = setTimeout(() => {
      const receipt = partialMeetingReceiptFixture(progress.plan);
      replaceState(finishEvryArtifactExecution(transition.state, receipt));
      setNotice(
        "The durable receipt preserves completed work and marks only the email step as safe to retry."
      );
    }, 2_500);
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <Badge variant="outline">Preview validation fixture</Badge>
            <h2 className="mt-2 text-lg font-semibold">
              Typed artifact safety flow
            </h2>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm text-pretty">
              This fixture exercises review, invalidation, fresh confirmation,
              one-shot execution, progress, and a partial-failure receipt. It
              performs no application work.
            </p>
          </div>
          <Badge variant="secondary" data-testid="accepted-executions">
            <ShieldCheck aria-hidden="true" />
            Executions accepted: {acceptedExecutions}
          </Badge>
        </div>

        <p
          role="status"
          aria-live="polite"
          className="bg-muted/40 rounded-lg border px-3 py-2 text-sm"
        >
          {notice}
        </p>

        {state.status === "review" ? (
          <EvryArtifactRenderer
            model={renderableEvryArtifact(
              evryPublicArtifactSchema.parse(state.confirmation)
            )}
            options={{
              confirmationControls: {
                onCancel() {
                  replaceState(cancelEvryArtifactReview(stateRef.current));
                  setNotice("Plan cancelled. Nothing was executed.");
                },
                onEdit: editPlan,
                onExecute: executePlan,
              },
            }}
          />
        ) : null}

        {state.status === "editing" ? (
          <Card className="gap-4 py-4 shadow-none" role="alert">
            <CardHeader className="px-4 sm:px-5">
              <div className="flex items-center gap-2">
                <AlertTriangle
                  aria-hidden="true"
                  className="text-destructive size-4"
                />
                <Badge variant="destructive">Confirmation invalidated</Badge>
              </div>
              <h3 className="text-base font-semibold">
                Edit the resolved recipient
              </h3>
              <p className="text-muted-foreground text-sm">
                The previous plan cannot execute. Saving this edit creates a
                fresh plan and review.
              </p>
            </CardHeader>
            <CardContent className="px-4 sm:px-5">
              <form
                className="space-y-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void prepareFreshReview();
                }}
              >
                <div className="space-y-2">
                  <Label htmlFor="fixture-recipient">Fourth recipient</Label>
                  <Input
                    id="fixture-recipient"
                    name="recipient"
                    value={recipient}
                    onChange={(event) => setRecipient(event.target.value)}
                    required
                    minLength={3}
                    className="text-base sm:text-sm"
                  />
                </div>
                <Button type="submit">
                  <Pencil aria-hidden="true" />
                  Prepare fresh review
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {state.status === "cancelled" ? (
          <Card className="gap-3 py-4 shadow-none" role="status">
            <CardHeader className="px-4 sm:px-5">
              <h3 className="flex items-center gap-2 font-semibold">
                <CheckCircle2 aria-hidden="true" className="size-4" />
                Plan cancelled
              </h3>
              <p className="text-muted-foreground text-sm">
                No meeting, guests, or email was created.
              </p>
            </CardHeader>
          </Card>
        ) : null}

        {state.status === "executing" ? (
          <EvryArtifactRenderer
            model={renderableEvryArtifact(
              evryPublicArtifactSchema.parse(state.progress)
            )}
          />
        ) : null}

        {state.status === "receipt" ? (
          <EvryArtifactRenderer
            model={renderableEvryArtifact(
              evryPublicArtifactSchema.parse(state.receipt)
            )}
          />
        ) : null}
      </div>
    </div>
  );
}
