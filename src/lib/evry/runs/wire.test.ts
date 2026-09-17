import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEvryRunRecoveryResponse } from "./wire";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";

test("interrupted recovery binds Retry to one saved user message", () => {
  const now = "2026-09-17T12:00:00.000Z";
  const message = {
    id: "50000000-0000-4000-8000-000000000001",
    sequence: 0,
    author: "user",
    body: "Saved request",
    pageContext: null,
    deliveryStatus: "complete",
    createdAt: now,
    artifacts: [],
  };
  const snapshot = {
    status: "interrupted",
    requestId: REQUEST_ID,
    sequence: 2,
    kind: "conversation",
    conversation: {
      id: "40000000-0000-4000-8000-000000000001",
      title: "Saved request",
      createdAt: now,
      lastActivityAt: now,
      stateVersion: 0,
      state: {},
      activePlan: null,
      messages: [message],
    },
    retry: {
      operation: "create",
      message: message.body,
      pageContext: null,
      savedMessageId: message.id,
    },
  };
  assert.equal(parseEvryRunRecoveryResponse(snapshot).status, "interrupted");
  assert.equal(
    parseEvryRunRecoveryResponse({ ...snapshot, retry: null }).status,
    "interrupted"
  );
  assert.throws(() =>
    parseEvryRunRecoveryResponse({
      ...snapshot,
      retry: { ...snapshot.retry, message: "Different request" },
    })
  );
  assert.throws(() =>
    parseEvryRunRecoveryResponse({
      ...snapshot,
      retry: { ...snapshot.retry, savedMessageId: REQUEST_ID },
    })
  );
  assert.throws(() =>
    parseEvryRunRecoveryResponse({
      ...snapshot,
      retry: { ...snapshot.retry, operation: "reuse" },
    })
  );
});

test("recovery wire rejects cross-kind stages and missing execution identity", () => {
  assert.throws(() =>
    parseEvryRunRecoveryResponse({
      status: "active",
      requestId: REQUEST_ID,
      kind: "execution",
      operation: "execute",
      sequence: 2,
      stage: "accepted",
      conversationId: null,
      expiresAt: "2026-08-29T01:15:00.000Z",
    })
  );
  assert.throws(() =>
    parseEvryRunRecoveryResponse({
      status: "active",
      requestId: REQUEST_ID,
      kind: "conversation",
      operation: "create",
      sequence: 2,
      stage: "executing",
      conversationId: null,
      expiresAt: "2026-08-29T01:15:00.000Z",
    })
  );
});

test("recovery wire binds create, continuation, and execution conversation shapes", () => {
  assert.equal(
    parseEvryRunRecoveryResponse({
      status: "active",
      requestId: REQUEST_ID,
      kind: "conversation",
      operation: "create",
      sequence: 0,
      stage: "accepted",
      conversationId: null,
      expiresAt: "2026-08-29T01:15:00.000Z",
    }).status,
    "active"
  );
  assert.throws(() =>
    parseEvryRunRecoveryResponse({
      status: "active",
      requestId: REQUEST_ID,
      kind: "conversation",
      operation: "continue",
      sequence: 0,
      stage: "accepted",
      conversationId: null,
      expiresAt: "2026-08-29T01:15:00.000Z",
    })
  );
});
