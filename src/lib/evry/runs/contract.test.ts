import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVRY_ACTIVE_RUN_TTL_MS,
  fingerprintEvryActiveRunRequest,
  parseEvryActiveRunRecord,
  sameEvryActiveRunIdentity,
} from "./contract";

const START = new Date("2026-08-29T01:00:00.000Z");
const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

function createRow(
  overrides: Partial<Parameters<typeof parseEvryActiveRunRecord>[0]> = {}
) {
  return parseEvryActiveRunRecord({
    id: "30000000-0000-4000-8000-000000000001",
    churchId: "40000000-0000-4000-8000-000000000001",
    actorUserId: "50000000-0000-4000-8000-000000000001",
    requestKey: REQUEST_ID,
    requestFingerprint: "a".repeat(64),
    kind: "conversation",
    operation: "create",
    status: "active",
    stage: "accepted",
    version: 0,
    conversationId: null,
    planId: null,
    planFingerprint: null,
    startedAt: START,
    changedAt: START,
    expiresAt: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS),
    completedAt: null,
    ...overrides,
  });
}

test("run fingerprints use canonical object ordering", () => {
  assert.equal(
    fingerprintEvryActiveRunRequest({
      operation: "create",
      request: { message: "Keep bytes", pageContext: null },
    }),
    fingerprintEvryActiveRunRequest({
      request: { pageContext: null, message: "Keep bytes" },
      operation: "create",
    })
  );
  assert.notEqual(
    fingerprintEvryActiveRunRequest({ values: ["one", "two"] }),
    fingerprintEvryActiveRunRequest({ values: ["two", "one"] })
  );
});

test("completed create replays still match the immutable null conversation claim", () => {
  const completed = createRow({
    status: "completed",
    conversationId: CONVERSATION_ID,
    version: 2,
    changedAt: new Date(START.valueOf() + 1_000),
    completedAt: new Date(START.valueOf() + 1_000),
  });
  assert.equal(
    sameEvryActiveRunIdentity(
      completed,
      {
        kind: "conversation",
        operation: "create",
        conversationId: null,
        planId: null,
        planFingerprint: null,
      },
      "a".repeat(64)
    ),
    true
  );
});

test("completed reuse preserves its immutable source claim while binding only the destination", () => {
  const completed = createRow({
    operation: "reuse",
    status: "completed",
    conversationId: CONVERSATION_ID,
    version: 2,
    changedAt: new Date(START.valueOf() + 1_000),
    completedAt: new Date(START.valueOf() + 1_000),
  });
  assert.equal(
    sameEvryActiveRunIdentity(
      completed,
      {
        kind: "conversation",
        operation: "reuse",
        conversationId: null,
        planId: null,
        planFingerprint: null,
      },
      "a".repeat(64)
    ),
    true
  );
});

test("run rows reject malformed terminal and cross-domain shapes", () => {
  assert.throws(() =>
    createRow({
      status: "completed",
      completedAt: new Date(START.valueOf() + 1_000),
    })
  );
  assert.throws(() => createRow({ kind: "execution", stage: "accepted" }));
  assert.throws(() =>
    createRow({
      conversationId: CONVERSATION_ID,
      status: "active",
    })
  );
  assert.throws(() =>
    createRow({
      changedAt: new Date(START.valueOf() + 1_000),
      expiresAt: new Date(START.valueOf() + EVRY_ACTIVE_RUN_TTL_MS + 1_000),
    })
  );
  assert.doesNotThrow(() =>
    createRow({
      kind: "execution",
      operation: "execute",
      stage: "executing",
      conversationId: CONVERSATION_ID,
      planId: "60000000-0000-4000-8000-000000000001",
      planFingerprint: "b".repeat(64),
      changedAt: new Date(START.valueOf() + 1_000),
      expiresAt: new Date(START.valueOf() + 1_000),
    })
  );
});
