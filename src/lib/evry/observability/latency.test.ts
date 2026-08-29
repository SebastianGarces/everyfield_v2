import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVRY_LATENCY_SEGMENTS,
  buildEvryLatencyReport,
  evryLatencyObservationsFromTrace,
  parseEvryLatencyObservation,
  renderEvryLatencyReportMarkdown,
} from "./latency";
import { parseEvryTraceDocument } from "./contract";
import { CONTROLLED_EVRY_LATENCY_FIXTURE } from "./latency-fixture";

test("latency observations are closed, content-free, and segment every responsible layer", () => {
  assert.deepEqual(EVRY_LATENCY_SEGMENTS, [
    "model",
    "application_read",
    "external_service",
    "execution",
    "render",
  ]);
  assert.throws(() =>
    parseEvryLatencyObservation({
      kind: "segment",
      requestId: "10000000-0000-4000-8000-000000000001",
      environment: "test",
      source: "controlled_fixture",
      capabilityIdentity: "meeting.read",
      recipeIdentity: null,
      segment: "model",
      durationMs: 12,
      rawMessage: "Invite Jordan at jordan@example.test",
    })
  );
  assert.throws(
    () =>
      parseEvryLatencyObservation({
        kind: "milestone",
        requestId: "10000000-0000-4000-8000-000000000001",
        environment: "preview",
        source: "client_performance",
        capabilityIdentity: "forged.from-browser",
        recipeIdentity: null,
        milestone: "acknowledgement",
        durationMs: 80,
      }),
    /cannot claim trusted capability/
  );
  assert.throws(() =>
    parseEvryLatencyObservation({
      kind: "segment",
      requestId: "10000000-0000-4000-8000-000000000001",
      environment: "test",
      source: "controlled_fixture",
      capabilityIdentity: "meeting.read",
      recipeIdentity: null,
      segment: "database",
      durationMs: 12,
    })
  );
});

test("trusted operation spans explicitly name the responsible latency segment", () => {
  const trace = parseEvryTraceDocument({
    schemaVersion: 1,
    traceId: "a".repeat(32),
    correlationId: "10000000-0000-4000-8000-000000000011",
    environment: "test",
    recipeIdentity: "meeting.invitation",
    startedAt: "2026-08-28T12:00:00.000Z",
    endedAt: "2026-08-28T12:00:00.100Z",
    durationMs: 100,
    auditRecordCount: 1,
    spans: [
      {
        spanId: "0000000000000001",
        parentSpanId: null,
        stage: "request",
        startedAt: "2026-08-28T12:00:00.000Z",
        endedAt: "2026-08-28T12:00:00.100Z",
        durationMs: 100,
        status: "succeeded",
        resultCode: "request_received",
        capabilityIdentity: null,
        details: { kind: "operation" },
      },
      {
        spanId: "0000000000000002",
        parentSpanId: "0000000000000001",
        stage: "read",
        startedAt: "2026-08-28T12:00:00.010Z",
        endedAt: "2026-08-28T12:00:00.045Z",
        durationMs: 35,
        status: "succeeded",
        resultCode: "read_completed",
        capabilityIdentity: "meeting.read",
        details: { kind: "operation", latencySegment: "application_read" },
      },
      {
        spanId: "0000000000000003",
        parentSpanId: "0000000000000001",
        stage: "reporting",
        startedAt: "2026-08-28T12:00:00.090Z",
        endedAt: "2026-08-28T12:00:00.099Z",
        durationMs: 9,
        status: "succeeded",
        resultCode: "reported",
        capabilityIdentity: null,
        details: { kind: "operation" },
      },
    ],
  });
  assert.deepEqual(evryLatencyObservationsFromTrace(trace), [
    {
      kind: "segment",
      requestId: trace.correlationId,
      environment: "test",
      source: "server_trace",
      capabilityIdentity: "meeting.read",
      recipeIdentity: "meeting.invitation",
      segment: "application_read",
      durationMs: 35,
    },
  ]);
});

test("the controlled fixture reports nearest-rank p50/p95 by capability and recipe", () => {
  const report = buildEvryLatencyReport(CONTROLLED_EVRY_LATENCY_FIXTURE);
  assert.equal(report.schemaVersion, 2);
  assert.equal(report.capabilities[0]?.environment, "controlled-fixture");
  assert.equal(report.capabilities[0]?.source, "controlled_fixture");
  assert.deepEqual(
    report.capabilities.map(({ identity }) => identity),
    ["meeting.create", "people.read"]
  );
  assert.deepEqual(
    report.recipes.map(({ identity }) => identity),
    ["meeting.invitation"]
  );

  const people = report.capabilities.find(
    ({ identity }) => identity === "people.read"
  );
  assert.ok(people);
  assert.deepEqual(people.milestones.acknowledgement, {
    samples: 4,
    p50Ms: 80,
    p95Ms: 110,
    budgetMs: 250,
    withinBudget: true,
  });
  assert.deepEqual(people.milestones.useful_output, {
    samples: 4,
    p50Ms: 900,
    p95Ms: 1_500,
    budgetMs: 2_000,
    withinBudget: true,
  });
  assert.deepEqual(people.segments.application_read, {
    samples: 4,
    p50Ms: 120,
    p95Ms: 180,
  });
  assert.deepEqual(people.segments.external_service, {
    samples: 0,
    p50Ms: null,
    p95Ms: null,
  });

  const recipe = report.recipes[0];
  assert.ok(recipe);
  assert.deepEqual(recipe.milestones.confirmation_artifact, {
    samples: 4,
    p50Ms: 4_800,
    p95Ms: 7_200,
    budgetMs: 8_000,
    withinBudget: true,
  });
  assert.deepEqual(recipe.segments.external_service, {
    samples: 4,
    p50Ms: 310,
    p95Ms: 380,
  });
  assert.match(
    renderEvryLatencyReportMarkdown(report),
    /\| controlled-fixture \| controlled_fixture \| Recipe \| meeting\.invitation \|/
  );
});

test("a missing or over-budget controlled milestone fails closed", () => {
  const withoutConfirmation = CONTROLLED_EVRY_LATENCY_FIXTURE.filter(
    (observation) =>
      observation.kind !== "milestone" ||
      observation.milestone !== "confirmation_artifact"
  );
  const missing = buildEvryLatencyReport(withoutConfirmation);
  assert.equal(
    missing.recipes[0]?.milestones.confirmation_artifact.withinBudget,
    false
  );

  const overBudget = buildEvryLatencyReport([
    ...CONTROLLED_EVRY_LATENCY_FIXTURE,
    {
      kind: "milestone",
      requestId: "10000000-0000-4000-8000-000000000009",
      environment: "controlled-fixture",
      source: "controlled_fixture",
      capabilityIdentity: "meeting.create",
      recipeIdentity: "meeting.invitation",
      milestone: "confirmation_artifact",
      durationMs: 8_001,
    },
  ]);
  assert.equal(
    overBudget.recipes[0]?.milestones.confirmation_artifact.withinBudget,
    false
  );
});

test("duplicate milestones and conflicting request identities are refused while subcalls aggregate per request", () => {
  const first = CONTROLLED_EVRY_LATENCY_FIXTURE[0];
  assert.ok(first);
  assert.throws(() => buildEvryLatencyReport([first, first]), /duplicated/);
  assert.throws(
    () =>
      buildEvryLatencyReport([
        first,
        { ...first, recipeIdentity: "forged.recipe" },
      ]),
    /changed identity/
  );
  assert.throws(
    () =>
      buildEvryLatencyReport([
        first,
        { ...first, environment: "forged-environment" },
      ]),
    /changed identity/
  );

  const base = {
    kind: "segment" as const,
    requestId: "10000000-0000-4000-8000-000000000010",
    environment: "test",
    source: "server_trace" as const,
    capabilityIdentity: "people.read",
    recipeIdentity: null,
    segment: "application_read" as const,
  };
  const report = buildEvryLatencyReport([
    { ...base, durationMs: 25 },
    { ...base, durationMs: 35 },
  ]);
  assert.deepEqual(report.capabilities[0]?.segments.application_read, {
    samples: 1,
    p50Ms: 60,
    p95Ms: 60,
  });
});

test("multi-capability recipes aggregate once per request and never blend sources", () => {
  const requestId = "10000000-0000-4000-8000-000000000012";
  const base = {
    kind: "segment" as const,
    requestId,
    environment: "preview",
    source: "server_trace" as const,
    recipeIdentity: "meeting.invitation",
    segment: "application_read" as const,
  };
  const report = buildEvryLatencyReport([
    { ...base, capabilityIdentity: "people.read", durationMs: 30 },
    { ...base, capabilityIdentity: "meeting.create", durationMs: 70 },
    {
      kind: "milestone",
      requestId,
      environment: "preview",
      source: "client_performance",
      capabilityIdentity: null,
      recipeIdentity: null,
      milestone: "acknowledgement",
      durationMs: 40,
    },
    {
      ...base,
      requestId: "10000000-0000-4000-8000-000000000013",
      source: "controlled_fixture",
      capabilityIdentity: "people.read",
      durationMs: 999,
    },
  ]);

  assert.deepEqual(
    report.recipes.map(({ source, identity, segments, milestones }) => ({
      source,
      identity,
      applicationRead: segments.application_read,
      acknowledgement: milestones.acknowledgement,
    })),
    [
      {
        source: "client_performance",
        identity: "meeting.invitation",
        applicationRead: { samples: 0, p50Ms: null, p95Ms: null },
        acknowledgement: {
          samples: 1,
          p50Ms: 40,
          p95Ms: 40,
          budgetMs: 250,
          withinBudget: true,
        },
      },
      {
        source: "controlled_fixture",
        identity: "meeting.invitation",
        applicationRead: { samples: 1, p50Ms: 999, p95Ms: 999 },
        acknowledgement: {
          samples: 0,
          p50Ms: null,
          p95Ms: null,
          budgetMs: 250,
          withinBudget: false,
        },
      },
      {
        source: "server_trace",
        identity: "meeting.invitation",
        applicationRead: { samples: 1, p50Ms: 100, p95Ms: 100 },
        acknowledgement: {
          samples: 0,
          p50Ms: null,
          p95Ms: null,
          budgetMs: 250,
          withinBudget: false,
        },
      },
    ]
  );
  assert.equal(report.capabilities.length, 3);
  assert.equal(
    report.capabilities.some(({ source }) => source === "client_performance"),
    false
  );
  assert.deepEqual(report.unattributedRequests, []);
  assert.equal(report.observations, 4);
  assert.match(renderEvryLatencyReportMarkdown(report), /server_trace/);
  assert.match(renderEvryLatencyReportMarkdown(report), /controlled_fixture/);
});

test("single-capability client acknowledgement inherits only trusted server attribution", () => {
  const requestId = "10000000-0000-4000-8000-000000000014";
  const report = buildEvryLatencyReport([
    {
      kind: "milestone",
      requestId,
      environment: "preview",
      source: "client_performance",
      capabilityIdentity: null,
      recipeIdentity: null,
      milestone: "acknowledgement",
      durationMs: 72,
    },
    {
      kind: "segment",
      requestId,
      environment: "preview",
      source: "server_trace",
      capabilityIdentity: "people.read",
      recipeIdentity: "meeting.invitation",
      segment: "application_read",
      durationMs: 31,
    },
  ]);

  for (const row of [report.capabilities[0], report.recipes[0]]) {
    assert.ok(row);
    assert.equal(row.source, "client_performance");
    assert.deepEqual(row.milestones.acknowledgement, {
      samples: 1,
      p50Ms: 72,
      p95Ms: 72,
      budgetMs: 250,
      withinBudget: true,
    });
  }
  assert.equal(report.capabilities[0]?.identity, "people.read");
  assert.equal(report.recipes[0]?.identity, "meeting.invitation");
  assert.deepEqual(report.unattributedRequests, []);
});

test("identity-free client samples without one trusted attribution stay visibly unattributed", () => {
  const clientObservation = (requestId: string, durationMs: number) => ({
    kind: "milestone" as const,
    requestId,
    environment: "preview",
    source: "client_performance" as const,
    capabilityIdentity: null,
    recipeIdentity: null,
    milestone: "acknowledgement" as const,
    durationMs,
  });
  const ambiguousRequest = "10000000-0000-4000-8000-000000000015";
  const report = buildEvryLatencyReport([
    clientObservation("10000000-0000-4000-8000-000000000016", 91),
    clientObservation(ambiguousRequest, 109),
    ...["people.read", "meeting.create"].map((capabilityIdentity) => ({
      kind: "segment" as const,
      requestId: ambiguousRequest,
      environment: "preview",
      source: "server_trace" as const,
      capabilityIdentity,
      recipeIdentity: null,
      segment: "application_read" as const,
      durationMs: 10,
    })),
  ]);

  assert.deepEqual(report.unattributedRequests[0]?.milestones.acknowledgement, {
    samples: 2,
    p50Ms: 91,
    p95Ms: 109,
    budgetMs: 250,
    withinBudget: true,
  });
  assert.match(
    renderEvryLatencyReportMarkdown(report),
    /Unattributed request \| unattributed \| 91 ms \/ 109 ms/
  );
});
