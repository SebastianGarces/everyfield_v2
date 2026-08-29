import assert from "node:assert/strict";
import { test } from "node:test";

import { storedEvryClarificationArtifactDocument } from "@/lib/evry/conversations/artifacts";
import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";

import {
  composeEvryCapabilityConversationContinuations,
  EvryCapabilityConversationAmbiguityError,
  evryCapabilityConversationResultIdentity,
  type EvryCapabilityConversationContinuation,
  type EvryCapabilityConversationResult,
} from "./conversation";

const clarification = storedEvryClarificationArtifactDocument({
  kind: "clarification",
  mode: "missing",
  entityType: "person",
  prompt: "Which person?",
});

function conversation(
  messages: readonly Record<string, unknown>[] = []
): EvryStoredConversation {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    actorUserId: "20000000-0000-4000-8000-000000000001",
    plantId: "30000000-0000-4000-8000-000000000001",
    stateVersion: 4,
    state: {},
    messages,
  } as unknown as EvryStoredConversation;
}

function selectionInput(input: {
  current?: EvryStoredConversation;
  appendCalls: unknown[];
}) {
  return {
    actor: {
      userId: "20000000-0000-4000-8000-000000000001",
      plantId: "30000000-0000-4000-8000-000000000001",
      seat: "owner",
    },
    conversation: input.current ?? conversation(),
    userRequestKey: "40000000-0000-4000-8000-000000000001",
    literalUserText: "List people",
    pageContext: null,
    requestPageContext: null,
    now: new Date("2026-08-29T12:00:00.000Z"),
    store: {
      async append(request: unknown) {
        input.appendCalls.push(request);
        return conversation();
      },
    },
  } as never;
}

function registration(input: {
  identity: string;
  match: boolean;
  calls: string[];
  result?: EvryCapabilityConversationResult | null;
}): EvryCapabilityConversationContinuation {
  return {
    identity: input.identity,
    matches() {
      input.calls.push(`match:${input.identity}`);
      return input.match;
    },
    async continue() {
      input.calls.push(`continue:${input.identity}`);
      return input.result ?? null;
    },
  };
}

test("composition evaluates every pure matcher then shared code appends one result", async () => {
  const calls: string[] = [];
  const appendCalls: unknown[] = [];
  const continuation = composeEvryCapabilityConversationContinuations([
    registration({ identity: "first", match: false, calls }),
    registration({
      identity: "second",
      match: true,
      calls,
      result: { body: "Which person?", artifacts: [clarification] },
    }),
    registration({ identity: "third", match: false, calls }),
  ]);

  await continuation(selectionInput({ appendCalls }));
  const resultIdentity = evryCapabilityConversationResultIdentity({
    conversationId: "10000000-0000-4000-8000-000000000001",
    userRequestKey: "40000000-0000-4000-8000-000000000001",
  });
  assert.deepEqual(calls, [
    "match:first",
    "match:second",
    "match:third",
    "continue:second",
  ]);
  assert.equal(appendCalls.length, 1);
  assert.deepEqual(appendCalls[0], {
    messageId: resultIdentity.messageId,
    conversationId: "10000000-0000-4000-8000-000000000001",
    actorUserId: "20000000-0000-4000-8000-000000000001",
    plantId: "30000000-0000-4000-8000-000000000001",
    requestKey: resultIdentity.requestKey,
    expectedStateVersion: 4,
    state: {},
    author: "assistant",
    body: "Which person?",
    pageContext: null,
    requestPageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: [clarification],
    idempotencyContext: { status: "none" },
    activePlan: { mode: "preserve" },
    createdAt: new Date("2026-08-29T12:00:00.000Z"),
  });
});

test("ambiguous packs fail before any continuation or append can mutate", async () => {
  const calls: string[] = [];
  const appendCalls: unknown[] = [];
  const continuation = composeEvryCapabilityConversationContinuations([
    registration({ identity: "first", match: true, calls }),
    registration({ identity: "second", match: true, calls }),
  ]);

  await assert.rejects(
    continuation(selectionInput({ appendCalls })),
    EvryCapabilityConversationAmbiguityError
  );
  assert.deepEqual(calls, ["match:first", "match:second"]);
  assert.deepEqual(appendCalls, []);
});

test("a durable request result is recovered before match or append work", async () => {
  const calls: string[] = [];
  const appendCalls: unknown[] = [];
  const identity = evryCapabilityConversationResultIdentity({
    conversationId: "10000000-0000-4000-8000-000000000001",
    userRequestKey: "40000000-0000-4000-8000-000000000001",
  });
  const current = conversation([
    {
      id: identity.messageId,
      requestKey: identity.requestKey,
      author: "assistant",
    },
  ]);
  const continuation = composeEvryCapabilityConversationContinuations([
    registration({ identity: "people", match: true, calls }),
  ]);

  assert.equal(
    await continuation(selectionInput({ current, appendCalls })),
    current
  );
  assert.deepEqual(calls, []);
  assert.deepEqual(appendCalls, []);
});

test("a pack cannot choose result identity or conversation state", async () => {
  const calls: string[] = [];
  const appendCalls: unknown[] = [];
  const continuation = composeEvryCapabilityConversationContinuations([
    registration({
      identity: "people",
      match: true,
      calls,
      result: {
        body: "Which person?",
        artifacts: [clarification],
        messageId: "attacker-chosen",
        state: { version: 999 },
      } as unknown as EvryCapabilityConversationResult,
    }),
  ]);

  await assert.rejects(
    continuation(selectionInput({ appendCalls })),
    /unrecognized key/i
  );
  assert.deepEqual(appendCalls, []);
});

test("empty composition has no production continuation", async () => {
  const continuation = composeEvryCapabilityConversationContinuations([]);
  assert.equal(await continuation(selectionInput({ appendCalls: [] })), null);
});
