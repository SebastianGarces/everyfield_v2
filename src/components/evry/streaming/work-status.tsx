"use client";

import { LoaderCircle } from "lucide-react";
import { useLayoutEffect, useRef } from "react";

import {
  evryWorkPresentation,
  measureEvryAcknowledgement,
  type EvryAcknowledgementMeasurement,
  type EvryWorkState,
} from "@/lib/evry/streaming/state";

export type EvryAcknowledgementTarget = Readonly<{
  requestId: string;
  submittedAt: number;
}>;

export function EvryWorkStatus({
  acknowledgement,
  activeRequestId,
  onAcknowledgement,
  state,
}: {
  acknowledgement?: EvryAcknowledgementTarget | null;
  activeRequestId?: string | null;
  onAcknowledgement?: (measurement: EvryAcknowledgementMeasurement) => void;
  state: EvryWorkState;
}) {
  const presentation = evryWorkPresentation(state);
  const recordedRequestId = useRef<string | null>(null);

  useLayoutEffect(() => {
    if (
      state.phase !== "reading" ||
      !acknowledgement ||
      acknowledgement.requestId !== activeRequestId ||
      recordedRequestId.current === acknowledgement.requestId
    ) {
      return;
    }
    recordedRequestId.current = acknowledgement.requestId;
    const committedAt = performance.now();
    const measurement = measureEvryAcknowledgement(
      acknowledgement.submittedAt,
      committedAt
    );
    try {
      performance.measure("evry.acknowledgement", {
        start: acknowledgement.submittedAt,
        end: committedAt,
        detail: { requestId: acknowledgement.requestId },
      });
    } catch {
      // Optional telemetry never changes the product interaction.
    }
    onAcknowledgement?.(measurement);
  }, [acknowledgement, activeRequestId, onAcknowledgement, state.phase]);

  return (
    <div
      id="evry-work-status"
      tabIndex={-1}
      data-busy={presentation.busy}
      className="focus-visible:ring-ring min-w-0 flex-1 rounded-sm text-sm outline-none focus-visible:ring-2"
    >
      <div className="text-muted-foreground flex min-h-5 items-center gap-2">
        {presentation.busy ? (
          <LoaderCircle
            aria-hidden="true"
            className="size-4 shrink-0 motion-safe:animate-spin"
          />
        ) : null}
        <p role="status" aria-live="polite" aria-atomic="true">
          {presentation.announcement}
        </p>
      </div>
      <p
        role="alert"
        aria-live="assertive"
        aria-atomic="true"
        className="text-destructive"
      >
        {presentation.assertive}
      </p>
    </div>
  );
}
