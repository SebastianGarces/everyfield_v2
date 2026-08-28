import { readEvryRedactedTelemetry } from "@/lib/evry/audit/telemetry";

import { createEvryTraceRecorder, type EvryTraceSink } from "./recorder";

type EvryCorrelationId = Parameters<typeof readEvryRedactedTelemetry>[0];

/** Production adapter. Audit projection stays owned by #764. */
export function createAuditedEvryTraceRecorder(input: {
  correlationId: EvryCorrelationId;
  environment: string;
  recipeIdentity: string | null;
  sink: EvryTraceSink;
}) {
  return createEvryTraceRecorder({
    ...input,
    readTelemetry: readEvryRedactedTelemetry,
  });
}
