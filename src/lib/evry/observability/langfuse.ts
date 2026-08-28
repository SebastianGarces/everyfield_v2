import {
  LangfuseOtelSpanAttributes,
  startObservation,
  type ObservationLevel,
} from "@langfuse/tracing";
import { TraceFlags, type Span } from "@opentelemetry/api";
import { z } from "zod";

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

const localEvalDecisionSchema = z
  .object({
    classification: z.enum([
      "application_read",
      "application_action",
      "settings",
      "theology_or_spiritual_guidance",
      "unrelated",
      "mixed",
      "ambiguous",
    ]),
    settingsSectionId: z.string().min(1).max(160).optional(),
  })
  .strict();
const localEvalPlanOutputSchema = z
  .object({
    recipeIdentity: z.string().min(1).max(160),
    meetingId: z.uuid(),
    startsAt: z.iso.datetime({ offset: true }),
    audience: z.string().min(1).max(500),
    recipientId: z.uuid(),
    subject: z.string().min(1).max(500),
    body: z.string().min(1).max(2_000),
  })
  .strict();

export const evryLocalEvalPayloadSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("policy-benchmark"),
      fixtureId: z.string().min(1).max(160),
      systemPrompt: z.string().min(1).max(10_000),
      request: z.string().min(1).max(2_000),
      expected: localEvalDecisionSchema,
      actual: localEvalDecisionSchema.nullable(),
      structuredOutput: z.boolean(),
      passed: z.boolean(),
      errorCode: z.literal("provider_or_shape_failure").nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("plan-benchmark"),
      probeId: z.string().min(1).max(160),
      systemPrompt: z.string().min(1).max(10_000),
      request: z.string().min(1).max(10_000),
      expectedRecipeIdentity: z.string().min(1).max(160),
      actual: localEvalPlanOutputSchema.nullable(),
      structuredOutput: z.boolean(),
      passed: z.boolean(),
      planSteps: z.number().int().min(0).max(100),
      confirmationArtifactLatencyMs: z
        .number()
        .nonnegative()
        .finite()
        .nullable(),
      errorCode: z.literal("provider_shape_or_compile_failure").nullable(),
    })
    .strict(),
]);

export type EvryLocalEvalPayload = z.infer<typeof evryLocalEvalPayloadSchema>;

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

export function evryLocalEvalObservationForSpan(
  unsafePayload: EvryLocalEvalPayload,
  span: EvryTraceSpan
): Readonly<{ input?: unknown; output?: unknown }> {
  const payload = evryLocalEvalPayloadSchema.parse(unsafePayload);
  if (payload.kind === "policy-benchmark") {
    if (span.stage === "request") {
      return {
        input: {
          fixtureId: payload.fixtureId,
          systemPrompt: payload.systemPrompt,
          request: payload.request,
        },
      };
    }
    if (span.stage === "policy") {
      return {
        input: { fixtureId: payload.fixtureId, request: payload.request },
        output: {
          actual: payload.actual,
          structuredOutput: payload.structuredOutput,
          errorCode: payload.errorCode,
        },
      };
    }
    if (span.stage === "reporting") {
      return {
        output: {
          expected: payload.expected,
          actual: payload.actual,
          passed: payload.passed,
          errorCode: payload.errorCode,
        },
      };
    }
    return {};
  }

  if (span.stage === "request") {
    return {
      input: {
        probeId: payload.probeId,
        systemPrompt: payload.systemPrompt,
        request: payload.request,
      },
    };
  }
  if (span.stage === "planning") {
    return {
      input: { probeId: payload.probeId, request: payload.request },
      output: {
        actual: payload.actual,
        structuredOutput: payload.structuredOutput,
        compiledPlan: {
          passed: payload.passed,
          steps: payload.planSteps,
          confirmationArtifactLatencyMs: payload.confirmationArtifactLatencyMs,
        },
        errorCode: payload.errorCode,
      },
    };
  }
  if (span.stage === "reporting") {
    return {
      output: {
        probeId: payload.probeId,
        expectedRecipeIdentity: payload.expectedRecipeIdentity,
        actual: payload.actual,
        passed: payload.passed,
        planSteps: payload.planSteps,
        confirmationArtifactLatencyMs: payload.confirmationArtifactLatencyMs,
        errorCode: payload.errorCode,
      },
    };
  }
  return {};
}

async function captureLangfuseTrace(
  expectedEnvironment: string,
  unsafeTrace: EvryTraceDocument,
  localEvalPayload?: EvryLocalEvalPayload
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
        ...(localEvalPayload
          ? evryLocalEvalObservationForSpan(localEvalPayload, requestSpan)
          : {}),
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
              ...(localEvalPayload
                ? evryLocalEvalObservationForSpan(localEvalPayload, span)
                : {}),
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
              ...(localEvalPayload
                ? evryLocalEvalObservationForSpan(localEvalPayload, span)
                : {}),
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

export type ConfiguredEvryLocalEvalLangfuseSink = Readonly<{
  environment: "local-eval";
  capture(
    trace: EvryTraceDocument,
    payload: EvryLocalEvalPayload
  ): Promise<void>;
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

/** Eval payloads are accepted only by the closed local-eval export boundary. */
export function createEvryLocalEvalLangfuseSink(): ConfiguredEvryLocalEvalLangfuseSink | null {
  const environment = configuredLangfuseEnvironment();
  if (!environment) return null;
  if (environment !== "local-eval") {
    throw new Error("Evry benchmark observations require local-eval Langfuse");
  }
  return Object.freeze({
    environment,
    capture(trace: EvryTraceDocument, unsafePayload: EvryLocalEvalPayload) {
      const payload = evryLocalEvalPayloadSchema.parse(unsafePayload);
      return captureLangfuseTrace(environment, trace, payload);
    },
  });
}
