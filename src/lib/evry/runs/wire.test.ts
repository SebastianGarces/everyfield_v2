import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEvryRunRecoveryResponse } from "./wire";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";

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
