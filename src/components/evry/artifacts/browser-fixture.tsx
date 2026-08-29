"use client";

import { AlertTriangle, CheckCircle2, Pencil, ShieldCheck } from "lucide-react";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createEvryArtifactBrowserFixtureStore,
  parseEvryArtifactBrowserFixtureSnapshot,
  type EvryArtifactBrowserFixtureSnapshot,
  type EvryArtifactBrowserFixtureStorage,
} from "@/lib/evry/artifacts/browser-fixture-state";
import {
  applyFreshEvryConfirmation,
  beginEvryArtifactEdit,
  beginEvryArtifactExecution,
  cancelEvryArtifactReview,
  finishEvryArtifactExecution,
} from "@/lib/evry/artifacts/interaction";
import {
  editedMeetingConfirmation,
  meetingProgressFixture,
  partialMeetingReceiptFixture,
} from "@/lib/evry/artifacts/fixtures";
import { evryPublicArtifactSchema } from "@/lib/evry/artifacts/public";

import {
  EvryArtifactRenderer,
  renderableEvryArtifact,
} from "./artifact-renderer";

const EXECUTION_DURATION_MS = 2_500;
const browserSessionStorage: EvryArtifactBrowserFixtureStorage = {
  getItem: (key) => window.sessionStorage.getItem(key),
  setItem: (key, value) => window.sessionStorage.setItem(key, value),
  removeItem: (key) => window.sessionStorage.removeItem(key),
};

/** Preview-only interaction proof. It never calls a model, route, or effect. */
export function EvryArtifactBrowserFixture() {
  const [store] = useState(() =>
    createEvryArtifactBrowserFixtureStore(browserSessionStorage)
  );
  const snapshot = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot
  );
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const replaceSnapshot = useCallback(
    (next: EvryArtifactBrowserFixtureSnapshot) => store.replace(next),
    [store]
  );

  useEffect(() => {
    if (
      snapshot === null ||
      snapshot.state.status !== "executing" ||
      snapshot.completionDueAt === null
    ) {
      return;
    }
    const finishExecution = () => {
      const current = store.getSnapshot();
      if (current.state.status !== "executing") return;
      const receipt = partialMeetingReceiptFixture(current.state.progress.plan);
      replaceSnapshot(
        parseEvryArtifactBrowserFixtureSnapshot({
          ...current,
          state: finishEvryArtifactExecution(current.state, receipt),
          notice:
            "The durable receipt preserves completed work and marks only the email step as safe to retry.",
          completionDueAt: null,
        })
      );
    };
    timerRef.current = setTimeout(
      finishExecution,
      Math.max(0, snapshot.completionDueAt - Date.now())
    );
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [replaceSnapshot, snapshot, store]);

  if (snapshot === null) {
    return (
      <div className="text-muted-foreground p-5 text-sm" role="status">
        Restoring typed artifact fixture…
      </div>
    );
  }

  const { acceptedExecutions, notice, recipient, state } = snapshot;

  function editPlan() {
    const current = store.getSnapshot();
    replaceSnapshot(
      parseEvryArtifactBrowserFixtureSnapshot({
        ...current,
        state: beginEvryArtifactEdit(current.state),
        notice:
          "The prior confirmation is invalid. Prepare a fresh review before execution.",
        completionDueAt: null,
      })
    );
  }

  async function prepareFreshReview() {
    const editedRecipient = store.getSnapshot().recipient.trim();
    const fresh = await editedMeetingConfirmation(editedRecipient);
    const current = store.getSnapshot();
    const nextState = applyFreshEvryConfirmation(current.state, fresh);
    if (nextState === current.state) return;
    replaceSnapshot(
      parseEvryArtifactBrowserFixtureSnapshot({
        ...current,
        state: nextState,
        notice: `Fresh confirmation prepared for ${editedRecipient}.`,
      })
    );
  }

  function executePlan() {
    const current = store.getSnapshot();
    if (current.state.status !== "review") return;
    const progress = meetingProgressFixture(current.state.confirmation.plan);
    const transition = beginEvryArtifactExecution(current.state, progress);
    if (!transition.shouldExecute) return;
    replaceSnapshot(
      parseEvryArtifactBrowserFixtureSnapshot({
        ...current,
        state: transition.state,
        notice: "Execution started once. A second press cannot start it again.",
        acceptedExecutions: current.acceptedExecutions + 1,
        completionDueAt: Date.now() + EXECUTION_DURATION_MS,
      })
    );
  }

  function resetFixture() {
    store.reset();
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
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Badge variant="secondary" data-testid="accepted-executions">
              <ShieldCheck aria-hidden="true" />
              Executions accepted: {acceptedExecutions}
            </Badge>
            <Button type="button" variant="ghost" onClick={resetFixture}>
              Reset fixture
            </Button>
          </div>
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
                  const current = store.getSnapshot();
                  replaceSnapshot(
                    parseEvryArtifactBrowserFixtureSnapshot({
                      ...current,
                      state: cancelEvryArtifactReview(current.state),
                      notice: "Plan cancelled. Nothing was executed.",
                      completionDueAt: null,
                    })
                  );
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
                    onChange={(event) => {
                      const current = store.getSnapshot();
                      replaceSnapshot(
                        parseEvryArtifactBrowserFixtureSnapshot({
                          ...current,
                          recipient: event.target.value,
                        })
                      );
                    }}
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
