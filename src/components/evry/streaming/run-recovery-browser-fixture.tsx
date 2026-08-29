"use client";

import { useState } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import type { EvryWorkState } from "@/lib/evry/streaming/state";

import { EvryWorkStatus } from "./work-status";

type Proof = Readonly<{
  kind: "read" | "execution";
  runId: string;
  attemptId: string | null;
  starts: number;
  effects: number;
  subscriptions: number;
  phase: "watching" | "detached" | "durable";
}>;

const INITIAL: Proof = {
  kind: "read",
  runId: "not-started",
  attemptId: null,
  starts: 0,
  effects: 0,
  subscriptions: 0,
  phase: "durable",
};

function workState(proof: Proof): EvryWorkState {
  if (proof.runId === "not-started") return { phase: "idle" };
  if (proof.phase === "detached") {
    return {
      phase: "complete",
      message: "Stopped watching. The same durable run continues safely.",
    };
  }
  if (proof.phase === "durable") {
    return {
      phase: "complete",
      message:
        proof.kind === "execution"
          ? "Durable receipt recovered from the same plan attempt."
          : "Durable conversation completion recovered from the same run.",
    };
  }
  return proof.kind === "execution"
    ? {
        phase: "execution",
        message: "Watching the same confirmed plan attempt",
      }
    : { phase: "reading", message: "Watching the same model/read run" };
}

/** Preview-only manual proof. It calls no route, provider, model, or effect. */
export function EvryRunRecoveryBrowserFixture() {
  const [proof, setProof] = useState<Proof>(INITIAL);

  function start(kind: Proof["kind"]) {
    const runId = crypto.randomUUID();
    setProof({
      kind,
      runId,
      attemptId: kind === "execution" ? crypto.randomUUID() : null,
      starts: 1,
      effects: kind === "execution" ? 1 : 0,
      subscriptions: 1,
      phase: "watching",
    });
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-5">
      <div className="mx-auto max-w-3xl space-y-4">
        <div>
          <Badge variant="outline">Preview validation fixture</Badge>
          <h2 className="mt-2 text-lg font-semibold">
            Safe active-run reconnection
          </h2>
          <p className="text-muted-foreground mt-1 text-sm text-pretty">
            Manual deterministic proof of reload adoption and the Stop rule. It
            performs no application work.
          </p>
        </div>

        <Card className="gap-4 py-4 shadow-none">
          <CardHeader className="px-4 sm:px-5">
            <h3 className="font-semibold">
              {proof.kind === "execution" ? "Execution attempt" : "Read run"}
            </h3>
          </CardHeader>
          <CardContent className="space-y-4 px-4 sm:px-5">
            <EvryWorkStatus
              activeRequestId={proof.runId}
              state={workState(proof)}
            />
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Run identity</dt>
                <dd className="font-mono break-all">{proof.runId}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Plan attempt</dt>
                <dd className="font-mono break-all">
                  {proof.attemptId ?? "not applicable"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Work starts</dt>
                <dd data-testid="reconnect-work-starts">{proof.starts}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Durable effects</dt>
                <dd data-testid="reconnect-effect-count">{proof.effects}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Subscriptions</dt>
                <dd data-testid="reconnect-subscriptions">
                  {proof.subscriptions}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={() => start("read")}>
                Start read proof
              </Button>
              <Button type="button" onClick={() => start("execution")}>
                Start execution proof
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={proof.phase !== "watching"}
                onClick={() =>
                  setProof((current) => ({
                    ...current,
                    subscriptions: current.subscriptions + 1,
                  }))
                }
              >
                Simulate reload
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={
                  proof.runId === "not-started" || proof.phase === "durable"
                }
                onClick={() =>
                  setProof((current) => ({
                    ...current,
                    phase:
                      current.phase === "detached" ? "watching" : "detached",
                    subscriptions:
                      current.phase === "detached"
                        ? current.subscriptions + 1
                        : current.subscriptions,
                  }))
                }
              >
                {proof.phase === "detached" ? "Reconnect" : "Stop watching"}
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={proof.phase !== "watching"}
                onClick={() =>
                  setProof((current) => ({ ...current, phase: "durable" }))
                }
              >
                Persist completion
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
