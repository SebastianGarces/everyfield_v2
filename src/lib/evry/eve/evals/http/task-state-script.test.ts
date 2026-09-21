import assert from "node:assert/strict";
import { test } from "node:test";
import {
  assertObservedTask,
  isScriptedCompactionRequest,
  preparationFromObservedTask,
} from "./task-state-script";
import { compiledFixtureRequest } from "./process-contract";

const facts = {
  meetingType: "orientation",
  title: "Core team orientation",
  date: "2026-09-27",
  time: "10:00",
  durationMinutes: "120",
  locationId: "a4880ddb-cecc-4807-8c3f-086d5e0a5706",
  audience: "core_team",
  subject: "Meet your core team",
  body: "Hi {{first_name}}, see you at {{meeting_location}}.",
  timezone: "America/New_York",
};
const assertion = {
  callId: "prepare-edited",
  draftCallId: "read-after-compaction",
  expectedRevision: 3,
  expectedFacts: facts,
};
const read = () => ({
  id: assertion.draftCallId,
  name: "draft_get",
  isError: false,
  output: {
    revision: 3,
    goal: "Prepare orientation",
    facts: Object.entries(facts).map(([key, value]) => ({
      key,
      value,
      source: "user" as const,
    })),
    selectedRecords: [],
    pendingQuestion: null,
  },
});

test("scripted preparation derives all retained values from actual draft_get output", () => {
  const result = preparationFromObservedTask(assertion, [read()]);
  assert.deepEqual(result.toolCall.input.request.arguments, {
    meetingType: "orientation",
    title: facts.title,
    dateTime: { date: facts.date, time: facts.time },
    durationMinutes: 120,
    locationId: facts.locationId,
    audience: "core_team",
    subject: facts.subject,
    body: facts.body,
  });
  assert.deepEqual(result.observed, {
    draftCallId: assertion.draftCallId,
    revision: 3,
    factKeys: Object.keys(facts).sort(),
  });
});

test("pre-edit assertions check the actual saved body and revision without emitting a preparation", () => {
  const result = assertObservedTask(assertion, [read()]);
  assert.deepEqual(result.values, facts);
  assert.equal("toolCall" in result, false);
});

test("task assertions and compaction summaries stay isolated to strict scripted fixture inputs", () => {
  const request = {
    compiledEntry: "/private/tmp/fixture/index.mjs",
    databaseUrl: "postgres://localhost/fixture",
    proxyUrl: "http://localhost:1234",
    sessionToken: "fixture",
    actor: { userId: "fixture", plantId: "fixture" },
    turns: ["Original turn"],
    now: "2026-09-20T16:00:00Z",
    maxCostUsd: 1,
    prices: {
      inputUsdPerMillion: 1,
      outputUsdPerMillion: 1,
      maxInputBytes: 10000,
      maxOutputTokens: 1000,
    },
  };
  const { callId: _callId, ...check } = assertion;
  assert.equal(
    compiledFixtureRequest.safeParse({
      ...request,
      model: {
        mode: "scripted",
        compactionSummary: "Neutral summary",
        responses: [
          { taskPreparation: assertion },
          {
            assertTaskState: check,
            toolCalls: [{ name: "draft_update", input: {} }],
          },
        ],
      },
    }).success,
    true
  );
  for (const model of [
    {
      mode: "scripted",
      responses: [{ taskPreparation: assertion, toolCalls: [] }],
    },
    {
      mode: "live",
      spendingApproved: true,
      compactionSummary: "Not permitted",
    },
    {
      mode: "scripted",
      responses: [
        {
          taskPreparation: assertion,
          toolCalls: [{ name: "actions_prepare", input: {} }],
        },
      ],
    },
    {
      mode: "scripted",
      responses: [{ taskPreparation: assertion, assertTaskState: check }],
    },
  ])
    assert.equal(
      compiledFixtureRequest.safeParse({ ...request, model }).success,
      false
    );
});

test("expected values cannot replace missing, stale, failed or contradictory observed state", () => {
  for (const key of Object.keys(facts)) {
    const missing = read();
    missing.output.facts = missing.output.facts.filter(
      (fact) => fact.key !== key
    );
    assert.throws(() => preparationFromObservedTask(assertion, [missing]));
    const wrong = read();
    wrong.output.facts.find((fact) => fact.key === key)!.value = "wrong";
    assert.throws(() => preparationFromObservedTask(assertion, [wrong]));
  }
  const duplicate = read();
  duplicate.output.facts.push(duplicate.output.facts[0]!);
  for (const results of [
    [],
    [{ ...read(), isError: true }],
    [{ ...read(), id: "old-read" }],
    [{ ...read(), name: "model_answer" }],
    [{ ...read(), output: { ...read().output, revision: 2 } }],
    [duplicate],
    [read(), { ...read(), id: "latest-failed", isError: true }],
  ])
    assert.throws(() => preparationFromObservedTask(assertion, results));
});

test("a scripted summary is only selected for the actual framework system request", () => {
  const text =
    "You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary.";
  assert.equal(
    isScriptedCompactionRequest({
      tools: [],
      messages: [{ role: "system", text }],
    }),
    true
  );
  assert.equal(
    isScriptedCompactionRequest({
      tools: [],
      messages: [{ role: "user", text }],
    }),
    false
  );
  assert.equal(
    isScriptedCompactionRequest({
      tools: ["draft_get"],
      messages: [{ role: "system", text }],
    }),
    false
  );
});
