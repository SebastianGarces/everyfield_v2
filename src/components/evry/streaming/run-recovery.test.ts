import assert from "node:assert/strict";
import { test } from "node:test";

import {
  bindEvryRunRecoveryConversation,
  clearEvryRunRecoveryMarker,
  markerMatchesEvryLocation,
  readEvryRunRecoveryMarker,
  reconnectEvryRun,
  writeEvryRunRecoveryMarker,
} from "./run-recovery";

const REQUEST_ID = "10000000-0000-4000-8000-000000000001";
const CONVERSATION_ID = "20000000-0000-4000-8000-000000000001";

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => void values.delete(key),
    setItem: (key, value) => void values.set(key, value),
  };
}

test("the session marker retains one closed run identity and binds create output", () => {
  const storage = memoryStorage();
  writeEvryRunRecoveryMarker(
    { requestId: REQUEST_ID, kind: "conversation", conversationId: null },
    storage
  );
  bindEvryRunRecoveryConversation(REQUEST_ID, CONVERSATION_ID, storage);
  assert.deepEqual(readEvryRunRecoveryMarker(storage), {
    version: 1,
    requestId: REQUEST_ID,
    kind: "conversation",
    conversationId: CONVERSATION_ID,
  });
  clearEvryRunRecoveryMarker(REQUEST_ID, storage);
  assert.equal(readEvryRunRecoveryMarker(storage), null);
});

test("a marker cannot replace a different selected conversation", () => {
  const marker = {
    version: 1 as const,
    requestId: REQUEST_ID,
    kind: "conversation" as const,
    conversationId: CONVERSATION_ID,
  };
  assert.equal(
    markerMatchesEvryLocation(marker, {
      pathname: "/evry",
      search: `?conversation=${CONVERSATION_ID}`,
    }),
    true
  );
  assert.equal(
    markerMatchesEvryLocation(marker, {
      pathname: "/evry",
      search: "?conversation=30000000-0000-4000-8000-000000000001",
    }),
    false
  );
  assert.equal(
    markerMatchesEvryLocation(marker, {
      pathname: "/evry",
      search: "?new=1",
    }),
    false
  );
});

test("reconnect adopts one run through active progress to durable completion", async () => {
  const events: string[] = [];
  const responses: unknown[] = [
    {
      status: "active",
      requestId: REQUEST_ID,
      kind: "execution",
      sequence: 1,
      stage: "executing",
      conversationId: CONVERSATION_ID,
      expiresAt: "2026-08-29T01:15:00.000Z",
    },
    {
      status: "durable",
      requestId: REQUEST_ID,
      kind: "execution",
      sequence: 2,
      conversation: {
        id: CONVERSATION_ID,
        title: "Exact plan",
        createdAt: "2026-08-29T01:00:00.000Z",
        lastActivityAt: "2026-08-29T01:00:01.000Z",
        activePlan: null,
        stateVersion: 0,
        state: {},
        messages: [],
      },
    },
  ];
  const result = await reconnectEvryRun({
    marker: {
      version: 1,
      requestId: REQUEST_ID,
      kind: "execution",
      conversationId: CONVERSATION_ID,
    },
    signal: new AbortController().signal,
    fetchRecovery: async () => responses.shift(),
    wait: async () => void events.push("wait"),
    onActive: ({ stage }) => events.push(stage),
  });
  assert.equal(result.status, "durable");
  assert.deepEqual(events, ["executing", "wait"]);
});

test("an expired execution issues one explicit resume command, then observes its durable result", async () => {
  const modes: string[] = [];
  const responses: unknown[] = [
    {
      status: "resumable",
      requestId: REQUEST_ID,
      kind: "execution",
    },
    {
      status: "active",
      requestId: REQUEST_ID,
      kind: "execution",
      sequence: 2,
      stage: "executing",
      conversationId: CONVERSATION_ID,
      expiresAt: "2026-08-29T01:15:00.000Z",
    },
    {
      status: "durable",
      requestId: REQUEST_ID,
      kind: "execution",
      sequence: 3,
      conversation: {
        id: CONVERSATION_ID,
        title: "Resumed exact plan",
        createdAt: "2026-08-29T01:00:00.000Z",
        lastActivityAt: "2026-08-29T01:00:01.000Z",
        activePlan: null,
        stateVersion: 0,
        state: {},
        messages: [],
      },
    },
  ];
  const result = await reconnectEvryRun({
    marker: {
      version: 1,
      requestId: REQUEST_ID,
      kind: "execution",
      conversationId: CONVERSATION_ID,
    },
    signal: new AbortController().signal,
    fetchRecovery: async (_requestId, mode) => {
      modes.push(mode);
      return responses.shift();
    },
    wait: async () => {},
    onActive: () => {},
  });
  assert.equal(result.status, "durable");
  assert.deepEqual(modes, ["read", "resume", "read"]);
});

test("reload before the server claim waits a bounded grace period and converges", async () => {
  let reads = 0;
  let waits = 0;
  const result = await reconnectEvryRun({
    marker: {
      version: 1,
      requestId: REQUEST_ID,
      kind: "conversation",
      conversationId: null,
    },
    signal: new AbortController().signal,
    fetchRecovery: async () => {
      reads += 1;
      return reads < 3
        ? { status: "unavailable", requestId: REQUEST_ID }
        : {
            status: "durable",
            requestId: REQUEST_ID,
            kind: "conversation",
            sequence: 3,
            conversation: {
              id: CONVERSATION_ID,
              title: "Claimed after reload",
              createdAt: "2026-08-29T01:00:00.000Z",
              lastActivityAt: "2026-08-29T01:00:01.000Z",
              activePlan: null,
              stateVersion: 0,
              state: {},
              messages: [],
            },
          };
    },
    wait: async () => {
      waits += 1;
    },
    onActive: () => {},
  });
  assert.equal(result.status, "durable");
  assert.equal(reads, 3);
  assert.equal(waits, 2);
});

test("a marker that never reached the server stops after six reads", async () => {
  let reads = 0;
  let waits = 0;
  const result = await reconnectEvryRun({
    marker: {
      version: 1,
      requestId: REQUEST_ID,
      kind: "conversation",
      conversationId: null,
    },
    signal: new AbortController().signal,
    fetchRecovery: async () => {
      reads += 1;
      return { status: "unavailable", requestId: REQUEST_ID };
    },
    wait: async () => {
      waits += 1;
    },
    onActive: () => {},
  });
  assert.deepEqual(result, { status: "unavailable", requestId: REQUEST_ID });
  assert.equal(reads, 6);
  assert.equal(waits, 5);
});

test("abort detaches observation without issuing another recovery request", async () => {
  const controller = new AbortController();
  let reads = 0;
  await assert.rejects(
    reconnectEvryRun({
      marker: {
        version: 1,
        requestId: REQUEST_ID,
        kind: "conversation",
        conversationId: null,
      },
      signal: controller.signal,
      fetchRecovery: async () => {
        reads += 1;
        return {
          status: "active",
          requestId: REQUEST_ID,
          kind: "conversation",
          sequence: 0,
          stage: "accepted",
          conversationId: null,
          expiresAt: "2026-08-29T01:15:00.000Z",
        };
      },
      wait: async () => controller.abort(),
      onActive: () => {},
    }),
    { name: "AbortError" }
  );
  assert.equal(reads, 1);
});
