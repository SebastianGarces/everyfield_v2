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

test("every maximum-size stored state and artifact projection stays reopenable", () => {
  const escapeHeavy = (length: number) =>
    [...`x${'\\"\u0001'.repeat(length)}`].slice(0, length).join("");
  const base = conversation(12);
  const sourceMessageId = base.messages[0]?.id;
  assert.ok(sourceMessageId);
  const references = Array.from({ length: 16 }, (_, index) => ({
    key: `person.p${index}`,
    entityType: "person",
    entityId: `${index}-${escapeHeavy(150)}`,
    label: escapeHeavy(160),
    distinguishingFacts: Array.from({ length: 6 }, (_, fact) => ({
      label: `Fact ${fact}`,
      value: escapeHeavy(500),
    })),
    sourceLink: {
      label: escapeHeavy(160),
      href: `/people/${index}/${"x".repeat(470)}`,
    },
    aliases: Array.from({ length: 8 }, (_, alias) => `p${index}-${alias}`),
    sourceMessageId,
    resolvedAt: CREATED.toISOString(),
    validThrough: "2026-09-20T12:00:00.000Z",
  }));
  const state = evryConversationStateDocumentSchema.parse({
    version: 1,
    resolvedReferences: references,
    explicitChoices: Array.from({ length: 16 }, (_, index) => {
      const selectedIndex = (index % (references.length - 1)) + 1;
      return {
        id: uuid(8, index + 1),
        clarificationArtifactId: uuid(9, index + 1),
        offeredReferences: [
          {
            referenceKey: "person.p0",
            entityType: "person",
            entityId: references[0]?.entityId,
          },
          {
            referenceKey: `person.p${selectedIndex}`,
            entityType: "person",
            entityId: references[selectedIndex]?.entityId,
          },
        ],
        referenceKey: `person.p${selectedIndex}`,
        selectedEntityId: references[selectedIndex]?.entityId,
        sourceMessageId,
        selectedAt: new Date(CREATED.valueOf() + index).toISOString(),
      };
    }),
    activeRecipe: {
      identity: "recipe.maximum",
      inputs: Array.from({ length: 16 }, (_, index) => ({
        key: `input.${index}`,
        value: escapeHeavy(500),
      })),
      updatedAt: CREATED.toISOString(),
    },
    pendingClarification: {
      id: uuid(7, 1),
      entityType: "person",
      prompt: escapeHeavy(500),
      choiceReferenceKeys: references.slice(0, 8).map(({ key }) => key),
      sourceMessageId,
      askedAt: CREATED.toISOString(),
    },
    completedSteps: Array.from({ length: 32 }, (_, index) => ({
      planId: PLAN.planId,
      planFingerprint: PLAN.fingerprint,
      stepId: `step.${index}`,
      capabilityIdentity: escapeHeavy(200),
      status: "completed",
      resultCode: "effect_completed",
      occurredAt: CREATED.toISOString(),
    })),
    summary: { text: escapeHeavy(2_000), throughSequence: 11 },
  });
  const maximumConfirmation = parseEvryConversationArtifactDocument({
    kind: "confirmation",
    plan: PLAN,
    title: escapeHeavy(200),
    actionLabel: escapeHeavy(160),
    items: Array.from({ length: 32 }, () => ({
      label: escapeHeavy(160),
      value: escapeHeavy(1_000),
    })),
    consequences: Array.from({ length: 16 }, () => escapeHeavy(500)),
  });
  const messages = base.messages.map((storedMessage, sequence) => ({
    ...storedMessage,
    body: escapeHeavy(8_000),
    pageContext: {
      kind: "person" as const,
      recordId: escapeHeavy(160),
      label: escapeHeavy(160),
    },
    artifacts: Object.freeze(
      Array.from({ length: 16 }, (_, ordinal) =>
        Object.freeze({
          id: uuid(6, sequence * 16 + ordinal + 1),
          ordinal,
          kind: maximumConfirmation.kind,
          document: maximumConfirmation,
          artifact: hydrateStoredEvryConversationArtifact(maximumConfirmation),
        })
      )
    ),
  }));

  const compiled = compileEvryConversationContext({
    conversation: Object.freeze({
      ...base,
      state,
      messages: Object.freeze(messages),
    }),
    activePlan: ACTIVE_PLAN,
    focusRelevanceKeys: evryConversationRelevanceKeysSchema.parse([
      "person.p0",
    ]),
  });
  assert.equal(
    JSON.stringify(compiled).length <=
      EVRY_CONVERSATION_CONTEXT_LIMITS.serializedCharacters,
    true
  );
  assert.equal(
    compiled.recentTurns.every(
      ({ artifacts }) =>
        artifacts.length <= EVRY_CONVERSATION_CONTEXT_LIMITS.artifactsPerTurn
    ),
    true
  );
  assert.equal(
    compiled.structuredState.document.resolvedReferences[0]?.key,
    "person.p0"
  );
  assert.equal(
    compiled.structuredState.document.explicitChoices[0]?.id,
    uuid(8, 16)
  );
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
