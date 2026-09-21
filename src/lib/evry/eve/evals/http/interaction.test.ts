import assert from "node:assert/strict";
import { test } from "node:test";
import type { MessageStreamEvent, InputRequest } from "eve/client";
import { createFirstInteractionObserver } from "./runner";
import { observationSchema } from "../contract";

const meta = { at: "2026-09-20T16:00:00.000Z", id: "fixture-event" };
const data = { sequence: 0, turnId: "turn-0", stepIndex: 0 };
function text(messageDelta: string, stepIndex = 0): MessageStreamEvent {
  return {
    type: "message.appended",
    data: { ...data, stepIndex, messageDelta },
    meta,
  };
}
function completed(message: string | null): MessageStreamEvent {
  return {
    type: "message.completed",
    data: { ...data, message, finishReason: "stop" },
    meta,
  };
}
function question(
  kind: InputRequest["kind"],
  prompt = "How long should the orientation be?"
): MessageStreamEvent {
  return {
    type: "input.requested",
    data: {
      ...data,
      requests: [
        {
          kind,
          prompt,
          requestId: "fixture-question",
          allowFreeform: true,
          action: {
            kind: "tool-call",
            callId: "fixture-question",
            toolName: "ask_question",
            input: {},
          },
        },
      ],
    },
    meta,
  };
}

test("orientation native question starts interaction timing before final prose", () => {
  const clock = createFirstInteractionObserver();
  clock.receive(question("question"), 10_125);
  clock.receive(text("The orientation is ready for review."), 24_341);
  clock.receive(completed("The orientation is ready for review."), 24_900);
  assert.equal(clock.firstInteractionMs, 10_125);
});

test("earliest visible text wins over later questions and completed text", () => {
  const clock = createFirstInteractionObserver();
  clock.receive(text(" \n"), 50);
  clock.receive(text("Here are your tasks"), 80);
  clock.receive(question("question"), 120);
  clock.receive(completed("Here are your tasks"), 180);
  assert.equal(clock.firstInteractionMs, 80);
});

test("status, reasoning, tool placeholders and usage controls are not useful interaction", () => {
  const clock = createFirstInteractionObserver();
  const ignored: MessageStreamEvent[] = [
    { type: "turn.started", data, meta },
    {
      type: "reasoning.appended",
      data: { ...data, reasoningDelta: "Thinking" },
      meta,
    },
    {
      type: "action.input.appended",
      data: {
        ...data,
        callId: "call",
        toolName: "ask_question",
        inputTextDelta: '{"prompt":"How long?',
      },
      meta,
    },
    question("session-limit"),
    question("tool-approval"),
    question("question", "  "),
    text(" "),
    text("[[evry-"),
    text("result:call]]"),
    completed(" [[evry-result:call]]"),
  ];
  ignored.forEach((event, index) => clock.receive(event, index + 1));
  assert.equal(clock.firstInteractionMs, null);
  clock.receive(text("Actual explanation", 1), 100);
  assert.equal(clock.firstInteractionMs, 100);
});

test("completed-only content is timed at receipt, never event or model timestamps", () => {
  const clock = createFirstInteractionObserver();
  clock.receive(completed(null), 100);
  clock.receive(completed("  "), 200);
  clock.receive(completed("A complete answer"), 333);
  assert.equal(clock.firstInteractionMs, 333);
});

test("old captures omit the metric while no interaction and an observed interaction stay distinct", () => {
  const latency = observationSchema.shape.latency;
  const old = { acknowledgementMs: 10, firstTextMs: null, totalMs: 100 };
  assert.deepEqual(latency.parse(old), old);
  assert.equal(
    latency.parse({ ...old, firstInteractionMs: null }).firstInteractionMs,
    null
  );
  assert.equal(
    latency.parse({ ...old, firstInteractionMs: 42 }).firstInteractionMs,
    42
  );
  assert.equal(
    latency.safeParse({ ...old, firstInteractionMs: -1 }).success,
    false
  );
  assert.equal(createFirstInteractionObserver().firstInteractionMs, null);
});
