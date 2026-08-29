"use client";

import { CheckCircle2, RotateCcw } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
  EvryArtifactRenderer,
  renderableEvryArtifact,
} from "@/components/evry/artifacts/artifact-renderer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  editedMeetingConfirmation,
  EVRY_CONFIRMATION_FIXTURES,
  meetingProgressFixture,
  partialMeetingReceiptFixture,
} from "@/lib/evry/artifacts/fixtures";
import { evryPublicArtifactSchema } from "@/lib/evry/artifacts/public";
import type { EvryDetailedConfirmationArtifactDocument } from "@/lib/evry/artifacts/review";
import type {
  EvryAcknowledgementMeasurement,
  EvryWorkState,
} from "@/lib/evry/streaming/state";

import { EvryWorkStatus, type EvryAcknowledgementTarget } from "./work-status";

const READING_DURATION_MS = 400;
const PLANNING_DURATION_MS = 400;
const EXECUTION_DURATION_MS = 1_500;
const CLARIFICATION = evryPublicArtifactSchema.parse({
  kind: "clarification",
  mode: "choice",
  entityType: "person",
  prompt: "Which Taylor should join the meeting?",
  choices: [
    {
      entityType: "person",
      id: "person-taylor-adams",
      label: "Taylor Adams",
      distinguishingFacts: [
        { label: "Team", value: "Launch" },
        { label: "Email", value: "taylor.adams@example.test" },
      ],
      sourceLink: { label: "Taylor Adams", href: "/people/taylor-adams" },
    },
    {
      entityType: "person",
      id: "person-taylor-brooks",
      label: "Taylor Brooks",
      distinguishingFacts: [
        { label: "Team", value: "Core group" },
        { label: "Email", value: "taylor.brooks@example.test" },
      ],
      sourceLink: { label: "Taylor Brooks", href: "/people/taylor-brooks" },
    },
  ],
  defaultChoiceId: null,
});

type FixtureStage =
  | "compose"
  | "reading"
  | "clarification"
  | "planning"
  | "confirmation"
  | "editing"
  | "execution"
  | "receipt";

/** Preview-only synthetic timing proof. It never calls a route, model, or effect. */
export function EvryStreamingBrowserFixture() {
  const [stage, setStage] = useState<FixtureStage>("compose");
  const [request, setRequest] = useState(
    "Schedule a Vision Meeting with Taylor next Wednesday"
  );
  const [recipient, setRecipient] = useState("Taylor Adams");
  const [confirmation, setConfirmation] =
    useState<EvryDetailedConfirmationArtifactDocument>(
      EVRY_CONFIRMATION_FIXTURES.meeting
    );
  const [workState, setWorkState] = useState<EvryWorkState>({ phase: "idle" });
  const [acknowledgement, setAcknowledgement] =
    useState<EvryAcknowledgementTarget | null>(null);
  const [acknowledgementMeasurement, setAcknowledgementMeasurement] =
    useState<EvryAcknowledgementMeasurement | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  function after(delay: number, callback: () => void) {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(callback, delay);
  }

  function focus(id: string) {
    requestAnimationFrame(() => document.getElementById(id)?.focus());
  }

  function beginRequest() {
    const requestId = crypto.randomUUID();
    setAcknowledgement({ requestId, submittedAt: performance.now() });
    setAcknowledgementMeasurement(null);
    setWorkState({
      phase: "reading",
      message: "Reading people and meeting details",
    });
    setStage("reading");
    after(READING_DURATION_MS, () => {
      setStage("clarification");
      setWorkState({
        phase: "complete",
        message: "One detail is needed before planning can continue.",
      });
    });
  }

  function chooseRecipient(choiceId: string) {
    setRecipient(
      choiceId === "person-taylor-brooks" ? "Taylor Brooks" : "Taylor Adams"
    );
    setStage("planning");
    setWorkState({
      phase: "planning",
      message: "Building a three-step meeting plan",
    });
    focus("evry-work-status");
    after(PLANNING_DURATION_MS, () => {
      setStage("confirmation");
      setWorkState({
        phase: "confirmation",
        message: "Review is ready. Nothing happens until you confirm.",
      });
    });
  }

  async function prepareFreshReview() {
    setStage("planning");
    setWorkState({
      phase: "planning",
      message: "Rebuilding the edited plan for a fresh review",
    });
    focus("evry-work-status");
    const freshConfirmation = await editedMeetingConfirmation(recipient.trim());
    after(PLANNING_DURATION_MS, () => {
      setConfirmation(freshConfirmation);
      setStage("confirmation");
      setWorkState({
        phase: "confirmation",
        message: "Fresh review is ready. The previous confirmation is invalid.",
      });
    });
  }

  function execute() {
    setStage("execution");
    setWorkState({
      phase: "execution",
      message: "Creating the meeting and sending invitations",
    });
    focus("evry-work-status");
    after(EXECUTION_DURATION_MS, () => {
      setStage("receipt");
      setWorkState({
        phase: "blocked",
        message:
          "Meeting completed, but invitation delivery needs attention. Review the receipt before retrying.",
      });
    });
  }

  function reset() {
    if (timer.current) clearTimeout(timer.current);
    setStage("compose");
    setConfirmation(EVRY_CONFIRMATION_FIXTURES.meeting);
    setAcknowledgement(null);
    setAcknowledgementMeasurement(null);
    setWorkState({ phase: "idle" });
    focus("streaming-fixture-request");
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-5">
      <div className="mx-auto max-w-3xl space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <Badge variant="outline">Preview validation fixture</Badge>
            <h2 className="mt-2 text-lg font-semibold">
              Accessible request lifecycle
            </h2>
            <p className="text-muted-foreground mt-1 max-w-2xl text-sm text-pretty">
              Controlled synthetic timing exercises acknowledgment,
              clarification, planning, review, editing, execution, and a
              partial-failure receipt. It performs no application work.
            </p>
          </div>
          <Button type="button" variant="ghost" onClick={reset}>
            <RotateCcw aria-hidden="true" />
            Reset fixture
          </Button>
        </div>

        <div className="rounded-lg border px-3 py-2">
          <EvryWorkStatus
            acknowledgement={acknowledgement}
            activeRequestId={acknowledgement?.requestId ?? null}
            onAcknowledgement={setAcknowledgementMeasurement}
            state={workState}
          />
          {acknowledgementMeasurement ? (
            <p
              className="text-muted-foreground mt-1 text-xs"
              data-testid="acknowledgement-duration"
            >
              Visible acknowledgment:{" "}
              {Math.round(acknowledgementMeasurement.durationMs)} ms · budget{" "}
              {acknowledgementMeasurement.withinBudget ? "met" : "missed"}
            </p>
          ) : null}
        </div>

        <Card className="gap-4 py-4 shadow-none">
          <CardHeader className="px-4 sm:px-5">
            <h3 className="font-semibold">Controlled request</h3>
            <p className="text-muted-foreground text-sm">
              The request remains mounted so streamed updates never remove the
              focused field.
            </p>
          </CardHeader>
          <CardContent className="px-4 sm:px-5">
            <form
              aria-busy={
                stage === "reading" ||
                stage === "planning" ||
                stage === "execution"
              }
              className="space-y-3"
              onSubmit={(event) => {
                event.preventDefault();
                if (stage === "compose") beginRequest();
              }}
            >
              <Label htmlFor="streaming-fixture-request">Request</Label>
              <Input
                id="streaming-fixture-request"
                value={request}
                onChange={(event) => setRequest(event.target.value)}
                readOnly={stage !== "compose"}
                required
                className="text-base sm:text-sm"
              />
              {stage === "compose" ? (
                <Button type="submit">Send controlled request</Button>
              ) : null}
            </form>
          </CardContent>
        </Card>

        {stage === "clarification" ? (
          <EvryArtifactRenderer
            model={renderableEvryArtifact(CLARIFICATION)}
            options={{ onChoice: chooseRecipient }}
          />
        ) : null}

        {stage === "confirmation" ? (
          <EvryArtifactRenderer
            model={renderableEvryArtifact(
              evryPublicArtifactSchema.parse(confirmation)
            )}
            options={{
              confirmationControls: {
                onCancel: reset,
                onEdit() {
                  setStage("editing");
                  setWorkState({
                    phase: "confirmation",
                    message:
                      "Confirmation invalidated. Edit the recipient before a fresh review.",
                  });
                  focus("streaming-fixture-recipient");
                },
                onExecute: execute,
              },
            }}
          />
        ) : null}

        {stage === "editing" ? (
          <Card className="gap-4 py-4 shadow-none">
            <CardHeader className="px-4 sm:px-5">
              <h3 className="font-semibold">Edit the resolved recipient</h3>
              <p className="text-muted-foreground text-sm">
                Saving creates a fresh confirmation before any action is
                available.
              </p>
            </CardHeader>
            <CardContent className="px-4 sm:px-5">
              <form
                className="space-y-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void prepareFreshReview();
                }}
              >
                <Label htmlFor="streaming-fixture-recipient">Recipient</Label>
                <Input
                  id="streaming-fixture-recipient"
                  value={recipient}
                  onChange={(event) => setRecipient(event.target.value)}
                  required
                  minLength={3}
                  className="text-base sm:text-sm"
                />
                <Button type="submit">Prepare fresh review</Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        {stage === "execution" ? (
          <EvryArtifactRenderer
            model={renderableEvryArtifact(
              evryPublicArtifactSchema.parse(
                meetingProgressFixture(confirmation.plan)
              )
            )}
          />
        ) : null}

        {stage === "receipt" ? (
          <>
            <EvryArtifactRenderer
              model={renderableEvryArtifact(
                evryPublicArtifactSchema.parse(
                  partialMeetingReceiptFixture(confirmation.plan)
                )
              )}
            />
            <Button type="button" variant="outline" onClick={reset}>
              <CheckCircle2 aria-hidden="true" />
              Finish and reset
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
