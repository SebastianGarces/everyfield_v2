import assert from "node:assert/strict";
import { test } from "node:test";

import { INITIAL_MEETING_CONFIRMATION } from "@/lib/evry/artifacts/fixtures";
import { storedEvryClarificationArtifactDocument } from "@/lib/evry/conversations/artifacts";
import type { EvryStoredConversation } from "@/lib/evry/conversations/repository";

import {
  composeEvryCapabilityConversationContinuations,
  EvryCapabilityConversationAmbiguityError,
  evryCapabilityConversationResultIdentity,
  hasDurableEvryCapabilityConversationResult,
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

function durableResultMessage(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  const identity = evryCapabilityConversationResultIdentity({
    conversationId: "10000000-0000-4000-8000-000000000001",
    userRequestKey: "40000000-0000-4000-8000-000000000001",
  });
  return {
    id: identity.messageId,
    requestKey: identity.requestKey,
    sequence: 1,
    author: "assistant",
    body: "Which person?",
    pageContext: null,
    replayReference: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    createdAt: new Date("2026-08-29T12:00:00.000Z"),
    artifacts: [
      {
        id: "50000000-0000-4000-8000-000000000001",
        ordinal: 0,
        kind: clarification.kind,
        document: clarification,
        artifact: clarification,
      },
    ],
    ...overrides,
  };
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
    replayReference: null,
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
  const current = conversation([durableResultMessage()]);
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

test("interrupted, empty, and corrupt deterministic rows do not count as durable results", () => {
  const malformed = [
    durableResultMessage({ deliveryStatus: "interrupted" }),
    durableResultMessage({ artifacts: [] }),
    durableResultMessage({
      artifacts: [
        {
          id: "50000000-0000-4000-8000-000000000001",
          ordinal: 0,
          kind: "clarification",
          document: { kind: "clarification", prompt: "missing mode" },
          artifact: {},
        },
      ],
    }),
  ];
  for (const candidate of malformed) {
    assert.equal(
      hasDurableEvryCapabilityConversationResult({
        conversation: conversation([candidate]),
        userRequestKey: "40000000-0000-4000-8000-000000000001",
      }),
      false
    );
  }
});

test("an active plan is one-to-one with one exact trusted confirmation", async () => {
  const calls: string[] = [];
  const exactPlan = INITIAL_MEETING_CONFIRMATION.plan;
  const cases: readonly EvryCapabilityConversationResult[] = [
    {
      body: "Review",
      artifacts: [clarification],
      activePlan: { mode: "set", plan: exactPlan },
    },
    {
      body: "Review",
      artifacts: [INITIAL_MEETING_CONFIRMATION],
    },
    {
      body: "Review",
      artifacts: [INITIAL_MEETING_CONFIRMATION],
      activePlan: {
        mode: "set",
        plan: {
          planId: "90000000-0000-4000-8000-000000000001",
          fingerprint: "f".repeat(64),
        } as never,
      },
    },
    {
      body: "Review",
      artifacts: [INITIAL_MEETING_CONFIRMATION, INITIAL_MEETING_CONFIRMATION],
      activePlan: { mode: "set", plan: exactPlan },
    },
  ];

  for (const result of cases) {
    const appendCalls: unknown[] = [];
    const continuation = composeEvryCapabilityConversationContinuations([
      registration({ identity: "hostile", match: true, calls, result }),
    ]);
    await assert.rejects(
      continuation(selectionInput({ appendCalls })),
      /bind one exact active plan/
    );
    assert.deepEqual(appendCalls, []);
  }

  const appendCalls: unknown[] = [];
  const valid = composeEvryCapabilityConversationContinuations([
    registration({
      identity: "valid",
      match: true,
      calls,
      result: {
        body: "Review",
        artifacts: [INITIAL_MEETING_CONFIRMATION],
        activePlan: { mode: "set", plan: exactPlan },
      },
    }),
  ]);
  await valid(selectionInput({ appendCalls }));
  assert.equal(appendCalls.length, 1);
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
