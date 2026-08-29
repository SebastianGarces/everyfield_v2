import assert from "node:assert/strict";
import { test } from "node:test";

import { initialEvryConversationState } from "./contract";
import type {
  EvryStoredConversation,
  EvryStoredConversationMessage,
} from "./repository";
import {
  createEvryConversation,
  continueEvryConversation,
  type EvryConversationStore,
} from "./service";
import { composeEvryCapabilityConversationContinuations } from "../capabilities/conversation";
import type { EvryPlantActor } from "../eligibility/viewer";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "Owner",
} as unknown as EvryPlantActor;
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001" as never;
const CREATE_REQUEST = "40000000-0000-4000-8000-000000000001" as never;
const CONTINUE_REQUEST = "50000000-0000-4000-8000-000000000001" as never;
const NOW = new Date("2026-08-29T12:00:00.000Z");

function message(input: {
  id: string;
  requestKey: string;
  sequence: number;
  author: "user" | "assistant";
  body: string;
  createdAt: Date;
  artifacts?: EvryStoredConversationMessage["artifacts"];
}): EvryStoredConversationMessage {
  return {
    ...input,
    id: input.id as never,
    requestKey: input.requestKey as never,
    pageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: input.artifacts ?? [],
  };
}

function memoryStore(): EvryConversationStore & {
  current(): EvryStoredConversation | null;
} {
  let current: EvryStoredConversation | null = null;
  let generated = 0;
  const store = {
    async create(input: Parameters<EvryConversationStore["create"]>[0]) {
      if (current) return current;
      current = {
        id: CONVERSATION_ID,
        actorUserId: input.actorUserId,
        plantId: input.plantId,
        title: input.body,
        createdAt: input.createdAt,
        lastActivityAt: input.createdAt,
        activePlan: null,
        stateVersion: 0,
        state: initialEvryConversationState(),
        messages: [
          message({
            id: "60000000-0000-4000-8000-000000000001",
            requestKey: input.requestKey,
            sequence: 0,
            author: "user",
            body: input.body,
            createdAt: input.createdAt,
          }),
        ],
      };
      return current;
    },
    async find() {
      return current;
    },
    async append(input: Parameters<EvryConversationStore["append"]>[0]) {
      if (!current) throw new Error("missing conversation");
      const existing = current.messages.find(
        ({ requestKey }) => requestKey === input.requestKey
      );
      if (existing) return current;
      generated += 1;
      const next = message({
        id: input.messageId,
        requestKey: input.requestKey,
        sequence: current.messages.length,
        author: input.author,
        body: input.body,
        createdAt: input.createdAt,
        artifacts: input.artifacts.map((document, ordinal) => ({
          id: `70000000-0000-4000-8000-${String(generated).padStart(12, "0")}`,
          ordinal,
          kind: document.kind,
          document,
          artifact: document as never,
        })),
      });
      current = {
        ...current,
        lastActivityAt: input.createdAt,
        stateVersion: current.stateVersion + 1,
        state: input.state,
        messages: [...current.messages, next],
      };
      return current;
    },
    current() {
      return current;
    },
  };
  return store;
}

function lostResponseContinuation(calls: {
  matches: number;
  reads: number;
  throwAfterFirstCommit: boolean;
  source: string;
}) {
  return composeEvryCapabilityConversationContinuations([
    {
      identity: "people",
      matches() {
        calls.matches += 1;
        return true;
      },
      async continue(input) {
        calls.reads += 1;
        const stored = await input.store.append({
          messageId: input.resultIdentity.messageId,
          conversationId: input.conversation.id,
          actorUserId: input.actor.userId,
          plantId: input.actor.plantId,
          requestKey: input.resultIdentity.requestKey,
          expectedStateVersion: input.conversation.stateVersion,
          state: input.conversation.state,
          author: "assistant",
          body: calls.source,
          pageContext: null,
          requestPageContext: null,
          relevanceKeys: [],
          deliveryStatus: "complete",
          artifacts: [],
          idempotencyContext: { status: "none" },
          activePlan: { mode: "preserve" },
          createdAt: input.now,
        });
        if (calls.throwAfterFirstCommit) {
          calls.throwAfterFirstCommit = false;
          throw new Error("response lost after durable continuation commit");
        }
        return stored;
      },
    },
  ]);
}

test("create replay recovers the committed capability result before source work", async () => {
  const store = memoryStore();
  const calls = {
    matches: 0,
    reads: 0,
    throwAfterFirstCommit: true,
    source: "Original People result",
  };
  const continueCapabilityConversation = lostResponseContinuation(calls);
  const input = {
    actor: ACTOR,
    requestKey: CREATE_REQUEST,
    message: "List people",
    pageContext: null,
    requestPageContext: null,
    now: NOW,
    store,
    continueCapabilityConversation,
  };

  await assert.rejects(
    createEvryConversation(input),
    /response lost after durable continuation commit/
  );
  calls.source = "Changed People result";
  const replay = await createEvryConversation(input);

  assert.equal(
    replay.conversation.messages.at(-1)?.body,
    "Original People result"
  );
  assert.deepEqual(
    { matches: calls.matches, reads: calls.reads },
    { matches: 1, reads: 1 }
  );
});

test("continue replay recovers the committed capability result before source work", async () => {
  const store = memoryStore();
  await store.create({
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    requestKey: CREATE_REQUEST,
    body: "Start",
    pageContext: null,
    requestPageContext: null,
    createdAt: NOW,
  });
  const calls = {
    matches: 0,
    reads: 0,
    throwAfterFirstCommit: true,
    source: "Original People result",
  };
  const continueCapabilityConversation = lostResponseContinuation(calls);
  const input = {
    actor: ACTOR,
    conversationId: CONVERSATION_ID,
    requestKey: CONTINUE_REQUEST,
    message: "List people",
    pageContext: null,
    requestPageContext: null,
    now: NOW,
    store,
    continueCapabilityConversation,
  };

  await assert.rejects(
    continueEvryConversation(input),
    /response lost after durable continuation commit/
  );
  calls.source = "Changed People result";
  const replay = await continueEvryConversation(input);

  assert.ok(replay);
  assert.equal(
    replay.resumed.conversation.messages.at(-1)?.body,
    "Original People result"
  );
  assert.deepEqual(
    { matches: calls.matches, reads: calls.reads },
    { matches: 1, reads: 1 }
  );
  assert.equal(store.current()?.messages.length, 3);
});
