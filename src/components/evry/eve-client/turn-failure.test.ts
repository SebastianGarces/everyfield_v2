import assert from "node:assert/strict";
import { test } from "node:test";
import type { MessageStreamEvent } from "eve/client";
import { latestEveTurnFailure } from "./turn-failure";

const at = "2026-09-20T12:00:00.000Z";
const started = {
  type: "turn.started",
  meta: { id: "1", at },
  data: { sequence: 1, turnId: "turn-1" },
} satisfies MessageStreamEvent;
const failed: MessageStreamEvent = {
  type: "turn.failed",
  meta: { id: "2", at },
  data: {
    sequence: 1,
    turnId: "turn-1",
    code: "MODEL_CALL_FAILED",
    message: "Sensitive provider detail",
  },
};
const waiting: MessageStreamEvent = {
  type: "session.waiting",
  meta: { id: "3", at },
  data: { continuationToken: "fixture", wait: "next-user-message" },
};

test("a recoverable failed turn survives parking and history replay without exposing provider details", () => {
  assert.deepEqual(latestEveTurnFailure([started, failed, waiting]), {
    turnId: "turn-1",
  });
});

test("a new turn, completion, or cancellation supersedes the previous failure", () => {
  const history = [started, failed, waiting];
  assert.equal(
    latestEveTurnFailure([
      ...history,
      { ...started, data: { sequence: 2, turnId: "turn-2" } },
    ]),
    null
  );
  assert.equal(
    latestEveTurnFailure([
      ...history,
      {
        type: "turn.completed",
        meta: { id: "4", at },
        data: { sequence: 2, turnId: "turn-2" },
      },
    ]),
    null
  );
  assert.equal(
    latestEveTurnFailure([
      ...history,
      {
        type: "turn.cancelled",
        meta: { id: "5", at },
        data: { sequence: 2, turnId: "turn-2" },
      },
    ]),
    null
  );
});

test("step failure alone and normal waiting do not declare the entire turn failed", () => {
  assert.equal(
    latestEveTurnFailure([
      started,
      {
        type: "step.failed",
        meta: { id: "4", at },
        data: {
          sequence: 1,
          stepIndex: 0,
          turnId: "turn-1",
          code: "MODEL_CALL_FAILED",
          message: "Retrying",
        },
      },
    ]),
    null
  );
  assert.equal(latestEveTurnFailure([started, waiting]), null);
  assert.equal(latestEveTurnFailure([]), null);
});
