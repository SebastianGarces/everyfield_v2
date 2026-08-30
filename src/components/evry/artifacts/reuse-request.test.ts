import assert from "node:assert/strict";
import { test } from "node:test";

import {
  readEvryRunRecoveryMarker,
  writeEvryRunRecoveryMarker,
  type EvryRecipeReuseRecoveryMarker,
} from "../streaming/run-recovery";
import { requestEvryRecipeReuse } from "./reuse-request";

const marker: EvryRecipeReuseRecoveryMarker = {
  version: 2,
  requestId: "10000000-0000-4000-8000-000000000001",
  kind: "conversation",
  operation: "reuse",
  conversationId: null,
  sourceConversationId: "20000000-0000-4000-8000-000000000001",
  resultArtifactId: "30000000-0000-4000-8000-000000000001",
  recipeIdentity: "meeting.invitation.reference",
  sourceLocation: { pathname: "/evry", search: "?conversation=source" },
};
const durable = {
  id: "40000000-0000-4000-8000-000000000001",
  title: "Recovered reuse",
  createdAt: "2026-08-30T12:00:00.000Z",
  lastActivityAt: "2026-08-30T12:00:01.000Z",
  activePlan: null,
  stateVersion: 0,
  state: {},
  messages: [],
};

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

test("commit then response loss and full reload recover the exact durable reuse identity", async () => {
  const storage = memoryStorage();
  writeEvryRunRecoveryMarker(marker, storage);
  const recoveredMarker = readEvryRunRecoveryMarker(storage);
  assert.ok(recoveredMarker && recoveredMarker.version === 2);
  let body = "";
  const result = await requestEvryRecipeReuse({
    marker: recoveredMarker,
    signal: new AbortController().signal,
    fetchRequest: async (url, init) => {
      assert.equal(
        String(url),
        `/api/evry/conversations/${marker.sourceConversationId}/reuse`
      );
      body = String(init?.body);
      return new Response("truncated", { status: 201 });
    },
    reconnect: async (input) => {
      assert.equal(input.marker, recoveredMarker);
      return {
        status: "durable",
        requestId: marker.requestId,
        kind: "conversation",
        sequence: 4,
        conversation: durable,
      };
    },
  });
  assert.deepEqual(JSON.parse(body), {
    requestKey: marker.requestId,
    resultArtifactId: marker.resultArtifactId,
    recipeIdentity: marker.recipeIdentity,
  });
  assert.deepEqual(result, { status: "conversation", conversation: durable });
});
