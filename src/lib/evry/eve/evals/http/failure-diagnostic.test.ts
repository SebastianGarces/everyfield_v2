import assert from "node:assert/strict";
import { test } from "node:test";
import type { HostCapture } from "./host";
import {
  fixtureFailureDiagnostic,
  fixtureFailureDiagnosticSchema,
} from "./failure-diagnostic";

const capture: HostCapture = {
  calls: [
    {
      id: "private-identity",
      name: "people.query",
      input: { secret: "private-arguments" },
      output: "private-record",
    },
  ],
  presented: ["private-identity"],
  freshAuthorizations: 1,
  refusedAuthorizations: 0,
  outboundMessages: 0,
  costUsd: 0.2,
  costBasis: "reserved_upper_bound",
  modelCalls: [
    {
      startedMs: 2,
      durationMs: null,
      inputBytes: 100,
      inputTokens: null,
      outputTokens: null,
      costUsd: null,
      reservedUsd: 0.2,
      tools: ["people_query"],
      assistantTextHistory: [{ phase: "final_answer", hasItemId: true }],
    },
  ],
};

test("failed eval metadata keeps usage and unfinished generations without copying record payloads", () => {
  const result = fixtureFailureDiagnostic({
    signal: new AbortController().signal,
    elapsedMs: 200,
    capture,
  });
  assert.equal(fixtureFailureDiagnosticSchema.safeParse(result).success, true);
  assert.equal(result.stop, "runtime_error");
  assert.equal(result.costBasis, "reserved_upper_bound");
  assert.equal(result.costUsd, 0.2);
  assert.equal(result.generations, 1);
  assert.equal(result.lastGenerations[0]?.durationMs, null);
  assert.deepEqual(result.lastCalls, ["people.query"]);
  assert.doesNotMatch(
    JSON.stringify(result),
    /private|assistantTextHistory|presented|secret/
  );
});

test("failed eval metadata distinguishes timeout from user cancellation without exporting abort reasons", () => {
  for (const [reason, stop] of [
    [new DOMException("private-timeout-detail", "TimeoutError"), "timeout"],
    [new Error("private-user-cancellation"), "cancelled"],
  ] as const) {
    const result = fixtureFailureDiagnostic({
      signal: AbortSignal.abort(reason),
      elapsedMs: 50,
      capture,
    });
    assert.equal(result.stop, stop);
    assert.doesNotMatch(JSON.stringify(result), /private/);
  }
});

test("metadata transport refuses payload widening and diagnostic size is bounded", () => {
  const result = fixtureFailureDiagnostic({
    signal: new AbortController().signal,
    elapsedMs: 20,
    capture: {
      ...capture,
      calls: Array(20).fill(capture.calls[0]),
      modelCalls: Array(20).fill(capture.modelCalls[0]),
    },
  });
  assert.equal(result.lastCalls.length, 12);
  assert.equal(result.lastGenerations.length, 8);
  assert.equal(result.generations, 20);
  assert.equal(
    fixtureFailureDiagnosticSchema.safeParse({ ...result, prompt: "private" })
      .success,
    false
  );
});
