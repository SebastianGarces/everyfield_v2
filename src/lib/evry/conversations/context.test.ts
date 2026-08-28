import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  hydrateStoredEvryConversationArtifact,
  parseEvryConversationArtifactDocument,
  type StoredEvryConversationArtifactDocument,
} from "./artifacts";
import {
  compileEvryConversationContext,
  EVRY_CONVERSATION_CONTEXT_LIMITS,
  EVRY_CONVERSATION_STABLE_PREFIX,
  type EvryRevalidatedActivePlan,
} from "./context";
import {
  evryConversationIdSchema,
  evryConversationMessageIdSchema,
  evryConversationPlanIdentitySchema,
  evryConversationRelevanceKeysSchema,
  evryConversationRequestKeySchema,
  evryConversationStateDocumentSchema,
} from "./contract";
import type {
  EvryStoredConversation,
  EvryStoredConversationMessage,
} from "./repository";

const CREATED = new Date("2026-08-20T12:00:00.000Z");
const PLAN = evryConversationPlanIdentitySchema.parse({
  planId: "40000000-0000-4000-8000-000000000001",
  fingerprint: "a".repeat(64),
});
const CONFIRMATION = parseEvryConversationArtifactDocument({
  kind: "confirmation",
  plan: PLAN,
  title: "Create the meeting",
  actionLabel: "Create meeting",
  items: [{ label: "When", value: "August 30 at 10:00 AM EDT" }],
  consequences: ["One meeting will be created."],
});

function uuid(prefix: number, sequence: number): string {
  return `${prefix}0000000-0000-4000-8000-${sequence
    .toString()
    .padStart(12, "0")}`;
}

function message(
  sequence: number,
  relevanceKeys: readonly string[] = [],
  artifact?: StoredEvryConversationArtifactDocument
): EvryStoredConversationMessage {
  return Object.freeze({
    id: evryConversationMessageIdSchema.parse(uuid(1, sequence + 1)),
    requestKey: evryConversationRequestKeySchema.parse(uuid(2, sequence + 1)),
    sequence,
    author: sequence % 2 === 0 ? ("user" as const) : ("assistant" as const),
    body: `Turn ${sequence}: ${"decision context ".repeat(180)}`,
    pageContext: null,
    relevanceKeys: evryConversationRelevanceKeysSchema.parse(relevanceKeys),
    deliveryStatus: "complete",
    createdAt: new Date(CREATED.valueOf() + sequence * 1_000),
    artifacts: Object.freeze(
      artifact
        ? [
            Object.freeze({
              id: uuid(3, sequence + 1),
              ordinal: 0,
              kind: artifact.kind,
              document: artifact,
              artifact: hydrateStoredEvryConversationArtifact(artifact),
            }),
          ]
        : []
    ),
  });
}

function conversation(messageCount: number): EvryStoredConversation {
  const state = evryConversationStateDocumentSchema.parse({
    version: 1,
    resolvedReferences: [],
    explicitChoices: [],
    activeRecipe: null,
    pendingClarification: null,
    completedSteps: [],
    summary: { text: "Alex was selected for the meeting.", throughSequence: 3 },
  });
  const messages = Array.from({ length: messageCount }, (_, sequence) => {
    const relevance = [1, 3, messageCount - 1].includes(sequence)
      ? ["person.alex"]
      : ["topic.unrelated"];
    return message(
      sequence,
      relevance,
      sequence === 3 ? CONFIRMATION : undefined
    );
  });
  return Object.freeze({
    id: evryConversationIdSchema.parse("50000000-0000-4000-8000-000000000001"),
    actorUserId: "60000000-0000-4000-8000-000000000001",
    plantId: "70000000-0000-4000-8000-000000000001",
    title: "Create the meeting",
    createdAt: CREATED,
    lastActivityAt: messages.at(-1)?.createdAt ?? CREATED,
    activePlan: PLAN,
    stateVersion: messageCount,
    state,
    messages: Object.freeze(messages),
  });
}

const ACTIVE_PLAN: EvryRevalidatedActivePlan = Object.freeze({
  identity: PLAN,
  status: "awaiting_confirmation",
  expiresAt: "2026-08-28T12:15:00.000Z",
  confirmable: true,
});

function goldenView() {
  const compiled = compileEvryConversationContext({
    conversation: conversation(12),
    activePlan: ACTIVE_PLAN,
    focusRelevanceKeys: evryConversationRelevanceKeysSchema.parse([
      "person.alex",
    ]),
  });
  return {
    version: compiled.version,
    stablePrefixSha256: createHash("sha256")
      .update(compiled.stablePrefix)
      .digest("hex"),
    summaryAuthority: compiled.structuredState.summaryAuthority,
    summary: compiled.structuredState.document.summary,
    pendingPlan: compiled.pendingPlan,
    relevantOlderSequences: compiled.relevantOlderTurns.map(
      ({ sequence }) => sequence
    ),
    recentSequences: compiled.recentTurns.map(({ sequence }) => sequence),
    maxBodyCharacters: Math.max(
      ...compiled.recentTurns.map(({ body }) => [...body].length)
    ),
  };
}

test("the context fixture matches its deterministic golden", () => {
  const expected = JSON.parse(
    readFileSync(
      path.join(
        path.dirname(fileURLToPath(import.meta.url)),
        "context.golden.json"
      ),
      "utf8"
    )
  );
  assert.deepEqual(goldenView(), expected);
  assert.equal(
    EVRY_CONVERSATION_STABLE_PREFIX.includes("summary is context"),
    true
  );
});

test("context stays bounded as the visible transcript grows", () => {
  for (const count of [12, 40, 400]) {
    const compiled = compileEvryConversationContext({
      conversation: conversation(count),
      activePlan: ACTIVE_PLAN,
      focusRelevanceKeys: evryConversationRelevanceKeysSchema.parse([
        "person.alex",
      ]),
    });
    assert.equal(
      compiled.recentTurns.length,
      EVRY_CONVERSATION_CONTEXT_LIMITS.recentTurns
    );
    assert.equal(
      compiled.relevantOlderTurns.length <=
        EVRY_CONVERSATION_CONTEXT_LIMITS.relevantOlderTurns,
      true
    );
    assert.equal(
      JSON.stringify(compiled).length <=
        EVRY_CONVERSATION_CONTEXT_LIMITS.serializedCharacters,
      true
    );
    assert.equal(
      compiled.recentTurns.every(
        ({ body }) =>
          [...body].length <=
          EVRY_CONVERSATION_CONTEXT_LIMITS.bodyCharactersPerTurn
      ),
      true
    );
  }
});

test("only key-intersecting older turns survive and the active tuple selects its artifact", () => {
  const compiled = compileEvryConversationContext({
    conversation: conversation(20),
    activePlan: ACTIVE_PLAN,
    focusRelevanceKeys: evryConversationRelevanceKeysSchema.parse([
      "person.alex",
    ]),
  });
  assert.deepEqual(
    compiled.relevantOlderTurns.map(({ sequence }) => sequence),
    [1, 3]
  );
  assert.equal(compiled.pendingPlan?.confirmation?.kind, "confirmation");
  assert.equal(
    compiled.pendingPlan?.confirmation?.plan.fingerprint,
    PLAN.fingerprint
  );

  const otherPlan = {
    ...ACTIVE_PLAN,
    identity: evryConversationPlanIdentitySchema.parse({
      planId: "40000000-0000-4000-8000-000000000002",
      fingerprint: "b".repeat(64),
    }),
  };
  assert.equal(
    compileEvryConversationContext({
      conversation: conversation(20),
      activePlan: otherPlan,
    }).pendingPlan?.confirmation,
    null
  );

  assert.equal(
    compileEvryConversationContext({
      conversation: conversation(20),
      activePlan: { ...ACTIVE_PLAN, status: "completed", confirmable: false },
    }).pendingPlan,
    null
  );
});
