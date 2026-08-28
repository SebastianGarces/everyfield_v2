import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import type {
  readEvryRedactedTelemetry,
  EvryRedactedTelemetryRecord,
} from "@/lib/evry/audit/telemetry";

import {
  EVRY_TRACE_STAGES,
  evryTraceSpanFieldsSchema,
  parseEvryTraceDocument,
  type EvryTraceDocument,
  type EvryTraceSpan,
} from "./contract";

type EvryCorrelationId = Parameters<typeof readEvryRedactedTelemetry>[0];

export interface EvryTraceSink {
  capture(trace: EvryTraceDocument): Promise<void>;
}

export type EvryStageRecord = Readonly<
  Omit<
    EvryTraceSpan,
    "spanId" | "parentSpanId" | "durationMs" | "startedAt" | "endedAt"
  > & {
    startedAt: Date;
    endedAt: Date;
  }
>;

export type EvryRedactedTelemetryReader = (
  correlationId: EvryCorrelationId
) => Promise<readonly EvryRedactedTelemetryRecord[]>;

export const EVRY_TRACE_DROP_REASONS = [
  "invalid_trace",
  "audit_unavailable",
  "audit_empty",
  "audit_mismatch",
  "sink_failed",
  "already_finished",
] as const;

export type EvryTraceDropReason = (typeof EVRY_TRACE_DROP_REASONS)[number];
export type EvryTraceCaptureResult =
  | Readonly<{ status: "captured"; trace: EvryTraceDocument }>
  | Readonly<{ status: "dropped"; reason: EvryTraceDropReason }>;

const stageRecordSchema = evryTraceSpanFieldsSchema
  .omit({ spanId: true, parentSpanId: true, durationMs: true })
  .extend({ startedAt: z.date(), endedAt: z.date() });

const STAGE_INDEX = new Map(
  EVRY_TRACE_STAGES.map((stage, index) => [stage, index] as const)
);

function spanId(): string {
  return randomBytes(8).toString("hex");
}

export function evryTraceIdForCorrelation(correlationId: string): string {
  return createHash("sha256").update(correlationId).digest("hex").slice(0, 32);
}

function durationMs(startedAt: Date, endedAt: Date): number {
  const duration = endedAt.getTime() - startedAt.getTime();
  if (!Number.isFinite(duration) || duration < 0) {
    throw new Error("Evry trace span ends before it starts");
  }
  return duration;
}

function assertOrderedStages(stages: readonly EvryStageRecord[]): void {
  if (stages[0]?.stage !== "request") {
    throw new Error("Evry trace must start with its request span");
  }
  if (stages.at(-1)?.stage !== "reporting") {
    throw new Error("Evry trace must end with reporting");
  }

  let previous = -1;
  const seen = new Set<string>();
  for (const { stage } of stages) {
    const index = STAGE_INDEX.get(stage);
    if (index === undefined || index <= previous || seen.has(stage)) {
      throw new Error(
        `Evry trace stage is duplicated or out of order: ${stage}`
      );
    }
    seen.add(stage);
    previous = index;
  }
}

function assertAuditCorrelation(
  correlationId: string,
  records: readonly EvryRedactedTelemetryRecord[]
): void {
  for (const record of records) {
    if (record.correlationId !== correlationId) {
      throw new Error("Evry telemetry reader returned another correlation");
    }
  }
}

/**
 * Collect one closed trace document, then expose it to a sink only after the
 * authoritative redacted audit reader confirms the same correlation.
 */
export function createEvryTraceRecorder(input: {
  correlationId: EvryCorrelationId;
  environment: string;
  recipeIdentity: string | null;
  sink: EvryTraceSink;
  readTelemetry: EvryRedactedTelemetryReader;
  nextSpanId?: () => string;
  onDrop?: (reason: EvryTraceDropReason) => void;
}) {
  const records: EvryStageRecord[] = [];
  let finished = false;
  let invalid = false;

  const dropped = (reason: EvryTraceDropReason): EvryTraceCaptureResult => {
    try {
      input.onDrop?.(reason);
    } catch {
      // A diagnostic cannot make tracing observable to the product path.
    }
    return Object.freeze({ status: "dropped", reason });
  };

  return Object.freeze({
    record(record: EvryStageRecord): boolean {
      if (finished) return false;
      const parsed = stageRecordSchema.safeParse(record);
      if (!parsed.success) {
        invalid = true;
        return false;
      }
      try {
        durationMs(parsed.data.startedAt, parsed.data.endedAt);
        records.push(parsed.data);
        return true;
      } catch {
        invalid = true;
        return false;
      }
    },

    async finish(): Promise<EvryTraceCaptureResult> {
      if (finished) return dropped("already_finished");
      finished = true;
      if (invalid) return dropped("invalid_trace");
      try {
        assertOrderedStages(records);
      } catch {
        return dropped("invalid_trace");
      }

      let auditRecords: readonly EvryRedactedTelemetryRecord[];
      try {
        auditRecords = await input.readTelemetry(input.correlationId);
      } catch {
        return dropped("audit_unavailable");
      }
      if (auditRecords.length === 0) return dropped("audit_empty");
      try {
        assertAuditCorrelation(input.correlationId, auditRecords);
      } catch {
        return dropped("audit_mismatch");
      }

      const nextSpanId = input.nextSpanId ?? spanId;
      const root = records[0];
      if (!root) return dropped("invalid_trace");

      let trace: EvryTraceDocument;
      try {
        const rootSpanId = nextSpanId();
        const spans = records.map((record, index) => ({
          ...record,
          startedAt: record.startedAt.toISOString(),
          endedAt: record.endedAt.toISOString(),
          durationMs: durationMs(record.startedAt, record.endedAt),
          spanId: index === 0 ? rootSpanId : nextSpanId(),
          parentSpanId: index === 0 ? null : rootSpanId,
        }));
        trace = parseEvryTraceDocument({
          schemaVersion: 1,
          traceId: evryTraceIdForCorrelation(input.correlationId),
          correlationId: input.correlationId,
          environment: input.environment,
          recipeIdentity: input.recipeIdentity,
          startedAt: root.startedAt.toISOString(),
          endedAt: root.endedAt.toISOString(),
          durationMs: durationMs(root.startedAt, root.endedAt),
          auditRecordCount: auditRecords.length,
          spans,
        });
      } catch {
        return dropped("invalid_trace");
      }

      try {
        await input.sink.capture(trace);
      } catch {
        return dropped("sink_failed");
      }
      return Object.freeze({ status: "captured", trace });
    },
  });
}
