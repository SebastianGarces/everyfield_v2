import assert from "node:assert/strict";
import test from "node:test";

import { mintEvryAuditRequest } from "@/lib/evry/audit/identity";
import type { EvryRedactedTelemetryRecord } from "@/lib/evry/audit/telemetry";

import { createEvryMemoryTraceSink } from "./capture";
import { parseEvryTraceDocument } from "./contract";
import { evryObservationName } from "./naming";
import { createEvryTraceRecorder } from "./recorder";
import { normalizeEvryModelUsage } from "./usage";

const HOSTILE = Object.freeze({
  body: "Pray for Jordan before launch",
  recipient: "jordan.private@example.com",
  secret: "sk-live-provider-secret",
  actorId: "11111111-1111-4111-8111-111111111111",
  plantId: "22222222-2222-4222-8222-222222222222",
  recordId: "33333333-3333-4333-8333-333333333333",
});

function instant(milliseconds: number): Date {
  return new Date(Date.UTC(2026, 7, 28, 12, 0, 0, milliseconds));
}

function stage(
  name:
    | "request"
    | "policy"
    | "eligibility"
    | "handoff"
    | "read"
    | "planning"
    | "confirmation_wait"
    | "execution_attempt"
    | "execution_outcome"
    | "reporting",
  start: number,
  end: number,
  resultCode:
    | "request_received"
    | "policy_allowed"
    | "eligibility_allowed"
    | "handoff_selected"
    | "read_completed"
    | "plan_proposed"
    | "confirmation_pending"
    | "execution_started"
    | "execution_completed"
    | "reported"
) {
  return {
    stage: name,
    startedAt: instant(start),
    endedAt: instant(end),
    status:
      name === "confirmation_wait"
        ? ("waiting" as const)
        : ("succeeded" as const),
    resultCode,
    capabilityIdentity:
      name === "read" || name === "planning" || name.startsWith("execution")
        ? "fixture:meeting.read"
        : null,
    details:
      name === "policy" || name === "planning"
        ? ({
            kind: "generation" as const,
            grouping:
              name === "policy"
                ? ({ kind: "request-policy" } as const)
                : ({
                    kind: "selected-capability",
                    capabilityIdentity: "fixture:meeting.read",
                  } as const),
            usage: normalizeEvryModelUsage({
              model: "gpt-5.4-mini",
              usage: {
                inputTokens: 100,
                inputTokenDetails: {
                  noCacheTokens: 60,
                  cacheReadTokens: 30,
                  cacheWriteTokens: 10,
                },
                outputTokens: 20,
                outputTokenDetails: {
                  textTokens: 15,
                  reasoningTokens: 5,
                },
                totalTokens: 120,
              },
              costUsd: 0.001,
              timeToFirstTokenMs: 25,
            }),
          } as const)
        : ({ kind: "operation" as const } as const),
  };
}

test("captures the complete Evry path against only redacted audit evidence", async () => {
  const request = mintEvryAuditRequest();
  const auditRecords: readonly EvryRedactedTelemetryRecord[] = [
    {
      correlationId: request.correlationId,
      recordKind: "audit_event",
      eventName: "plan_proposed",
      capabilityIdentity: null,
      status: null,
      resultCode: null,
      affectedCount: null,
      excludedCount: null,
      occurredAt: instant(50).toISOString(),
    },
    {
      correlationId: request.correlationId,
      recordKind: "execution_outcome",
      eventName: "attempt",
      capabilityIdentity: "fixture:meeting.read",
      status: "completed",
      resultCode: "effect_completed",
      affectedCount: 1,
      excludedCount: 0,
      occurredAt: instant(90).toISOString(),
    },
  ];
  const sink = createEvryMemoryTraceSink();
  const recorder = createEvryTraceRecorder({
    correlationId: request.correlationId,
    environment: "test",
    recipeIdentity: "fixture:meeting.invitation",
    sink,
    readTelemetry: async () => auditRecords,
    nextSpanId: (() => {
      let value = 0;
      return () => (++value).toString(16).padStart(16, "0");
    })(),
  });

  recorder.record(stage("request", 0, 100, "request_received"));
  recorder.record(stage("policy", 1, 10, "policy_allowed"));
  recorder.record(stage("eligibility", 11, 12, "eligibility_allowed"));
  recorder.record(stage("handoff", 13, 14, "handoff_selected"));
  recorder.record(stage("read", 15, 25, "read_completed"));
  recorder.record(stage("planning", 26, 45, "plan_proposed"));
  recorder.record(stage("confirmation_wait", 46, 70, "confirmation_pending"));
  recorder.record(stage("execution_attempt", 71, 72, "execution_started"));
  recorder.record(stage("execution_outcome", 73, 90, "execution_completed"));
  recorder.record(stage("reporting", 91, 99, "reported"));

  const result = await recorder.finish();
  assert.equal(result.status, "captured");
  if (result.status !== "captured") return;
  const { trace } = result;
  assert.equal(sink.traces.length, 1);
  assert.equal(trace.correlationId, request.correlationId);
  assert.equal(trace.auditRecordCount, 2);
  assert.equal(trace.spans.length, 10);
  assert.equal(trace.spans[0]?.parentSpanId, null);
  assert.ok(
    trace.spans
      .slice(1)
      .every((span) => span.parentSpanId === trace.spans[0]?.spanId)
  );
  assert.deepEqual(
    trace.spans.map(({ stage: stageName }) => stageName),
    [
      "request",
      "policy",
      "eligibility",
      "handoff",
      "read",
      "planning",
      "confirmation_wait",
      "execution_attempt",
      "execution_outcome",
      "reporting",
    ]
  );
  assert.equal(
    evryObservationName(
      trace.spans.find(({ stage: stageName }) => stageName === "policy")!
    ),
    "evry.policy.request-policy"
  );
  assert.equal(
    evryObservationName(
      trace.spans.find(({ stage: stageName }) => stageName === "planning")!
    ),
    "evry.planning.fixture:meeting.read"
  );
  assert.throws(() =>
    parseEvryTraceDocument({
      ...trace,
      spans: trace.spans.map((span) =>
        span.stage === "policy"
          ? { ...span, capabilityIdentity: "forged:capability" }
          : span
      ),
    })
  );

  const payload = JSON.stringify(trace);
  for (const value of Object.values(HOSTILE)) {
    assert.equal(payload.includes(value), false);
  }
});

test("the export boundary rejects extra raw fields", () => {
  const request = mintEvryAuditRequest();
  assert.throws(() =>
    parseEvryTraceDocument({
      schemaVersion: 1,
      traceId: "a".repeat(32),
      correlationId: request.correlationId,
      environment: "test",
      recipeIdentity: null,
      startedAt: instant(0).toISOString(),
      endedAt: instant(1).toISOString(),
      durationMs: 1,
      auditRecordCount: 0,
      spans: [],
      rawBody: HOSTILE.body,
      recipientAddress: HOSTILE.recipient,
      providerSecret: HOSTILE.secret,
    })
  );
});

test("another audit correlation prevents export", async () => {
  const request = mintEvryAuditRequest();
  const foreign = mintEvryAuditRequest();
  const sink = createEvryMemoryTraceSink();
  const recorder = createEvryTraceRecorder({
    correlationId: request.correlationId,
    environment: "test",
    recipeIdentity: null,
    sink,
    readTelemetry: async () => [
      {
        correlationId: foreign.correlationId,
        recordKind: "audit_event",
        eventName: "request_failed",
        capabilityIdentity: null,
        status: "request_failed",
        resultCode: "request_failed",
        affectedCount: null,
        excludedCount: null,
        occurredAt: instant(1).toISOString(),
      },
    ],
  });
  recorder.record(stage("request", 0, 3, "request_received"));
  recorder.record(stage("reporting", 1, 2, "reported"));

  assert.deepEqual(await recorder.finish(), {
    status: "dropped",
    reason: "audit_mismatch",
  });
  assert.equal(sink.traces.length, 0);
});

test("hostile runtime-shaped stage input is dropped before the sink", async () => {
  const request = mintEvryAuditRequest();
  const sink = createEvryMemoryTraceSink();
  const drops: string[] = [];
  const recorder = createEvryTraceRecorder({
    correlationId: request.correlationId,
    environment: "test",
    recipeIdentity: null,
    sink,
    readTelemetry: async () => [
      {
        correlationId: request.correlationId,
        recordKind: "audit_event",
        eventName: "request_failed",
        capabilityIdentity: null,
        status: "request_failed",
        resultCode: "request_failed",
        affectedCount: null,
        excludedCount: null,
        occurredAt: instant(1).toISOString(),
      },
    ],
    onDrop: (reason) => drops.push(reason),
  });
  const hostileStage = {
    ...stage("request", 0, 3, "request_received"),
    rawBody: HOSTILE.body,
    recipientAddress: HOSTILE.recipient,
    providerSecret: HOSTILE.secret,
    actorId: HOSTILE.actorId,
    plantId: HOSTILE.plantId,
    recordId: HOSTILE.recordId,
  };

  assert.equal(recorder.record(hostileStage), false);
  assert.equal(recorder.record(stage("reporting", 1, 2, "reported")), true);
  assert.deepEqual(await recorder.finish(), {
    status: "dropped",
    reason: "invalid_trace",
  });
  assert.deepEqual(drops, ["invalid_trace"]);
  assert.equal(sink.traces.length, 0);
});

test("audit and sink failures stay out of the product path", async () => {
  const request = mintEvryAuditRequest();
  const makeRecorder = (input: {
    readTelemetry: Parameters<
      typeof createEvryTraceRecorder
    >[0]["readTelemetry"];
    sink: Parameters<typeof createEvryTraceRecorder>[0]["sink"];
  }) => {
    const recorder = createEvryTraceRecorder({
      correlationId: request.correlationId,
      environment: "test",
      recipeIdentity: null,
      ...input,
    });
    recorder.record(stage("request", 0, 3, "request_received"));
    recorder.record(stage("reporting", 1, 2, "reported"));
    return recorder;
  };

  assert.deepEqual(
    await makeRecorder({
      readTelemetry: async () => {
        throw new Error(`${HOSTILE.secret}: ${HOSTILE.body}`);
      },
      sink: createEvryMemoryTraceSink(),
    }).finish(),
    { status: "dropped", reason: "audit_unavailable" }
  );
  assert.deepEqual(
    await makeRecorder({
      readTelemetry: async () => [],
      sink: createEvryMemoryTraceSink(),
    }).finish(),
    { status: "dropped", reason: "audit_empty" }
  );
  assert.deepEqual(
    await makeRecorder({
      readTelemetry: async () => [
        {
          correlationId: request.correlationId,
          recordKind: "audit_event",
          eventName: "request_failed",
          capabilityIdentity: null,
          status: "request_failed",
          resultCode: "request_failed",
          affectedCount: null,
          excludedCount: null,
          occurredAt: instant(1).toISOString(),
        },
      ],
      sink: {
        async capture() {
          throw new Error(`${HOSTILE.recipient}: ${HOSTILE.recordId}`);
        },
      },
    }).finish(),
    { status: "dropped", reason: "sink_failed" }
  );
});
