import assert from "node:assert/strict";
import { test } from "node:test";
import type { MessageStreamEvent } from "eve/client";
import { latestEveTurnFailure, EVE_TURN_FAILURE_MESSAGE } from "./turn-failure";
import {
  EVE_PROCESSING_LIMIT_SENTINEL,
  EVE_PROCESSING_LIMIT_MESSAGE,
} from "@/lib/evry/eve/runtime/processing-budget-policy";

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
    message: EVE_TURN_FAILURE_MESSAGE,
  });
});

test("only the exact processing guard failure receives its specific safe explanation", () => {
  const limit = {
    ...failed,
    data: { ...failed.data, message: EVE_PROCESSING_LIMIT_SENTINEL },
  };
  assert.equal(
    latestEveTurnFailure([started, limit, waiting])?.message,
    EVE_PROCESSING_LIMIT_MESSAGE
  );
  assert.equal(
    latestEveTurnFailure([
      { ...limit, data: { ...limit.data, code: "EVENT_HANDLER_FAILED" } },
      waiting,
    ])?.message,
    EVE_PROCESSING_LIMIT_MESSAGE
  );
  for (const message of [
    "Provider " + EVE_PROCESSING_LIMIT_SENTINEL,
    "Sensitive provider detail",
  ])
    assert.equal(
      latestEveTurnFailure([{ ...failed, data: { ...failed.data, message } }])
        ?.message,
      EVE_TURN_FAILURE_MESSAGE
    );
  assert.equal(
    latestEveTurnFailure([
      { ...limit, data: { ...limit.data, code: "COMPACTION_FAILED" } },
      waiting,
    ])?.message,
    EVE_PROCESSING_LIMIT_MESSAGE
  );
  assert.equal(
    latestEveTurnFailure([
      { ...failed, data: { ...failed.data, code: "COMPACTION_FAILED" } },
      waiting,
    ])?.message,
    EVE_TURN_FAILURE_MESSAGE
  );
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
