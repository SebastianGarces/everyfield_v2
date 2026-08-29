"use client";

import { useEffect, useState } from "react";
import { z } from "zod";

import { useEvryShell } from "@/components/evry/evry-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import {
  parseEvryRunRecoveryPreviewResponse,
  type EvryRunRecoveryPreviewProof,
} from "@/lib/evry/runs/preview-fixture-contract";

import {
  writeEvryRunRecoveryMarker,
  type EvryRunRecoveryMarker,
} from "./run-recovery";
import { EvryWorkStatus } from "./work-status";

const FIXTURE_STORAGE_KEY = "evry.run-recovery-preview.v1";
const fixtureSessionSchema = z
  .object({
    version: z.literal(1),
    requestId: z.string().uuid(),
    phase: z.enum(["ready", "reload_requested", "complete"]),
  })
  .strict()
  .readonly();
type FixtureSession = z.infer<typeof fixtureSessionSchema>;

function readFixtureSession(): FixtureSession | null {
  if (typeof window === "undefined") return null;
  const raw = window.sessionStorage.getItem(FIXTURE_STORAGE_KEY);
  if (!raw) return null;
  try {
    return fixtureSessionSchema.parse(JSON.parse(raw));
  } catch {
    window.sessionStorage.removeItem(FIXTURE_STORAGE_KEY);
    return null;
  }
}

function writeFixtureSession(session: FixtureSession): void {
  window.sessionStorage.setItem(FIXTURE_STORAGE_KEY, JSON.stringify(session));
}

async function fixtureRequest(
  input:
    | Readonly<{ action: "start"; kind: "read" | "execution" }>
    | Readonly<{ action: "complete"; requestId: string }>
): Promise<EvryRunRecoveryPreviewProof> {
  const response = await fetch("/api/evry/runs/preview-fixture", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(input),
  });
  const parsed = parseEvryRunRecoveryPreviewResponse(await response.json());
  if (!response.ok || parsed.status !== "available") {
    throw new Error("The preview recovery fixture was unavailable");
  }
  return parsed.proof;
}

async function fixtureStatus(
  requestId: string
): Promise<EvryRunRecoveryPreviewProof> {
  const response = await fetch(
    `/api/evry/runs/preview-fixture?requestId=${encodeURIComponent(requestId)}`,
    { cache: "no-store" }
  );
  const parsed = parseEvryRunRecoveryPreviewResponse(await response.json());
  if (!response.ok || parsed.status !== "available") {
    throw new Error("The preview recovery fixture was unavailable");
  }
  return parsed.proof;
}

function markerFor(
  proof: EvryRunRecoveryPreviewProof
): Omit<EvryRunRecoveryMarker, "version"> {
  return {
    requestId: proof.requestId,
    kind: proof.kind === "execution" ? "execution" : "conversation",
    conversationId: proof.conversationId,
  };
}

function synchronizeFixtureLocation(proof: EvryRunRecoveryPreviewProof): void {
  const url = new URL(window.location.href);
  url.searchParams.delete("new");
  url.searchParams.set("conversation", proof.conversationId);
  window.History.prototype.replaceState.call(
    window.history,
    window.history.state,
    "",
    `${url.pathname}${url.search}${url.hash}`
  );
}

/** Preview-only UI over a real actor-scoped run, recovery API, and durable DB. */
export function EvryRunRecoveryBrowserFixture() {
  const {
    canStopWatching,
    isWatchingDetached,
    resumeWatching,
    stopWatching,
    workRequestId,
    workState,
  } = useEvryShell();
  const [proof, setProof] = useState<EvryRunRecoveryPreviewProof | null>(null);
  const [session, setSession] = useState<FixtureSession | null>(() =>
    readFixtureSession()
  );
  const [error, setError] = useState<string | null>(null);
  const [isStarting, setStarting] = useState(false);

  useEffect(() => {
    if (!session) return;
    let cancelled = false;
    void fixtureStatus(session.requestId)
      .then((nextProof) => {
        if (!cancelled) setProof(nextProof);
      })
      .catch(() => {
        if (!cancelled) setError("Unable to read the durable preview run.");
      });
    if (session.phase !== "reload_requested") {
      return () => {
        cancelled = true;
      };
    }
    const timer = window.setTimeout(() => {
      void fixtureRequest({ action: "complete", requestId: session.requestId })
        .then((nextProof) => {
          if (cancelled) return;
          const completedSession: FixtureSession = {
            ...session,
            phase: "complete",
          };
          writeFixtureSession(completedSession);
          setSession(completedSession);
          setProof(nextProof);
        })
        .catch(() => {
          if (!cancelled) {
            setError(
              "Unable to complete the durable proof. Reload to reconcile it again."
            );
          }
        });
    }, 750);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [session]);

  async function start(kind: "read" | "execution"): Promise<void> {
    if (isStarting || proof?.result === "active") return;
    setStarting(true);
    setError(null);
    try {
      const nextProof = await fixtureRequest({ action: "start", kind });
      const nextSession: FixtureSession = {
        version: 1,
        requestId: nextProof.requestId,
        phase: "ready",
      };
      writeEvryRunRecoveryMarker(markerFor(nextProof));
      writeFixtureSession(nextSession);
      synchronizeFixtureLocation(nextProof);
      setSession(nextSession);
      setProof(nextProof);
    } catch {
      setError("Unable to start the durable preview run.");
    } finally {
      setStarting(false);
    }
  }

  function reloadPage(): void {
    if (!session || proof?.result !== "active") return;
    writeFixtureSession({ ...session, phase: "reload_requested" });
    window.location.reload();
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
            Start a deterministic server run, then reload this page. The same
            durable identity is recovered through Evry&apos;s production
            reconnect path without a provider or model call.
          </p>
        </div>

        <Card className="gap-4 py-4 shadow-none">
          <CardHeader className="px-4 sm:px-5">
            <h3 className="font-semibold">
              {proof?.kind === "execution" ? "Execution attempt" : "Read run"}
            </h3>
          </CardHeader>
          <CardContent className="space-y-4 px-4 sm:px-5">
            <EvryWorkStatus activeRequestId={workRequestId} state={workState} />
            {error ? (
              <p role="alert" className="text-destructive text-sm">
                {error}
              </p>
            ) : null}
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <div>
                <dt className="text-muted-foreground">Run identity</dt>
                <dd
                  className="font-mono break-all"
                  data-testid="reconnect-run-id"
                >
                  {proof?.runId ?? "not started"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Plan attempt</dt>
                <dd
                  className="font-mono break-all"
                  data-testid="reconnect-attempt-id"
                >
                  {proof?.attemptId ?? "not started"}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Work starts</dt>
                <dd data-testid="reconnect-work-starts">
                  {proof?.starts ?? 0}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Durable effects</dt>
                <dd data-testid="reconnect-effect-count">
                  {proof?.effectCount ?? 0}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Server stage</dt>
                <dd data-testid="reconnect-stage">{proof?.stage ?? "idle"}</dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Durable result</dt>
                <dd data-testid="reconnect-result">
                  {proof?.result ?? "not started"}
                </dd>
              </div>
            </dl>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                disabled={isStarting || proof?.result === "active"}
                onClick={() => void start("read")}
              >
                Start read proof
              </Button>
              <Button
                type="button"
                disabled={isStarting || proof?.result === "active"}
                onClick={() => void start("execution")}
              >
                Start execution proof
              </Button>
              <Button
                type="button"
                variant="secondary"
                disabled={
                  proof?.result !== "active" || session?.phase !== "ready"
                }
                onClick={reloadPage}
              >
                Reload page during run
              </Button>
              {canStopWatching || isWatchingDetached ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={isWatchingDetached ? resumeWatching : stopWatching}
                >
                  {isWatchingDetached
                    ? "Reconnect to this run"
                    : "Stop watching"}
                </Button>
              ) : null}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
