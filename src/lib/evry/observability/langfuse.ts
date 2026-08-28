import {
  LangfuseOtelSpanAttributes,
  startObservation,
  type ObservationLevel,
} from "@langfuse/tracing";
import { TraceFlags, type Span } from "@opentelemetry/api";

import {
  configuredLangfuseEnvironment,
  forceFlushLangfuse,
} from "@/lib/observability/langfuse";

import {
  parseEvryTraceDocument,
  type EvryNormalizedUsage,
  type EvryTraceDocument,
  type EvryTraceSpan,
} from "./contract";
import { evryObservationName } from "./naming";
import type { EvryTraceSink } from "./recorder";

function levelFor(span: EvryTraceSpan): ObservationLevel {
  if (span.status === "failed") return "ERROR";
  if (span.status === "refused") return "WARNING";
  return "DEFAULT";
}

export function langfuseUsageDetails(usage: EvryNormalizedUsage) {
  return Object.freeze({
    input: usage.inputUncachedTokens,
    input_cached_tokens: usage.inputCacheReadTokens,
    input_cache_creation: usage.inputCacheWriteTokens,
    output: usage.outputTextTokens,
    output_reasoning_tokens: usage.outputReasoningTokens,
    total: usage.totalTokens,
  });
}

function setTraceName(span: Span, traceName: string): void {
  span.setAttribute(LangfuseOtelSpanAttributes.TRACE_NAME, traceName);
}

function metadataFor(trace: EvryTraceDocument, span: EvryTraceSpan) {
  return Object.freeze({
    correlationId: trace.correlationId,
    contractSpanId: span.spanId,
    stage: span.stage,
    status: span.status,
    resultCode: span.resultCode,
    capabilityIdentity: span.capabilityIdentity,
    recipeIdentity: trace.recipeIdentity,
    auditRecordCount: trace.auditRecordCount,
  });
}

async function captureLangfuseTrace(
  expectedEnvironment: string,
  unsafeTrace: EvryTraceDocument
): Promise<void> {
  const trace = parseEvryTraceDocument(unsafeTrace);
  if (trace.environment !== expectedEnvironment) {
    throw new Error("Evry trace environment does not match Langfuse config");
  }

  const traceName = trace.recipeIdentity
    ? `evry.recipe.${trace.recipeIdentity}`
    : "evry.recipe.single";
  const wrapper = startObservation(
    traceName,
    {
      environment: trace.environment,
      metadata: {
        correlationId: trace.correlationId,
        recipeIdentity: trace.recipeIdentity,
        auditRecordCount: trace.auditRecordCount,
      },
    },
    {
      startTime: new Date(trace.startedAt),
      parentSpanContext: {
        traceId: trace.traceId,
        spanId: "0000000000000001",
        traceFlags: TraceFlags.SAMPLED,
        isRemote: true,
      },
    }
  );
  setTraceName(wrapper.otelSpan, traceName);

  try {
    const requestSpan = trace.spans[0];
    if (!requestSpan) throw new Error("Evry trace request span is absent");
    const request = startObservation(
      evryObservationName(requestSpan),
      {
        environment: trace.environment,
        level: levelFor(requestSpan),
        statusMessage: requestSpan.resultCode,
        metadata: metadataFor(trace, requestSpan),
      },
      {
        startTime: new Date(requestSpan.startedAt),
        parentSpanContext: wrapper.otelSpan.spanContext(),
      }
    );
    setTraceName(request.otelSpan, traceName);

    try {
      for (const span of trace.spans.slice(1)) {
        if (span.details.kind === "generation") {
          const generation = startObservation(
            evryObservationName(span),
            {
              environment: trace.environment,
              level: levelFor(span),
              statusMessage: span.resultCode,
              metadata: metadataFor(trace, span),
              model: span.details.usage.model,
              usageDetails: langfuseUsageDetails(span.details.usage),
              costDetails: { total: span.details.usage.costUsd },
              completionStartTime:
                span.details.usage.timeToFirstTokenMs === null
                  ? undefined
                  : new Date(
                      new Date(span.startedAt).getTime() +
                        span.details.usage.timeToFirstTokenMs
                    ),
            },
            {
              asType: "generation",
              startTime: new Date(span.startedAt),
              parentSpanContext: request.otelSpan.spanContext(),
            }
          );
          setTraceName(generation.otelSpan, traceName);
          generation.end(new Date(span.endedAt));
        } else {
          const operation = startObservation(
            evryObservationName(span),
            {
              environment: trace.environment,
              level: levelFor(span),
              statusMessage: span.resultCode,
              metadata: metadataFor(trace, span),
            },
            {
              startTime: new Date(span.startedAt),
              parentSpanContext: request.otelSpan.spanContext(),
            }
          );
          setTraceName(operation.otelSpan, traceName);
          operation.end(new Date(span.endedAt));
        }
      }
    } finally {
      request.end(new Date(requestSpan.endedAt));
    }
  } finally {
    wrapper.end(new Date(trace.endedAt));
  }
  await forceFlushLangfuse();
}

export type ConfiguredEvryLangfuseSink = Readonly<{
  environment: string;
  sink: EvryTraceSink;
}>;

/** Returns null with absent or refused config and performs no network work. */
export function createEvryLangfuseSink(): ConfiguredEvryLangfuseSink | null {
  const environment = configuredLangfuseEnvironment();
  if (!environment) return null;
  return Object.freeze({
    environment,
    sink: Object.freeze({
      capture: (trace: EvryTraceDocument) =>
        captureLangfuseTrace(environment, trace),
    }),
  });
}
