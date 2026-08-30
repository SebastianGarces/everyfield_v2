import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { buildEvryReceiptArtifact } from "@/lib/evry/artifacts/review";
import {
  hydrateStoredEvryConversationArtifact,
  type StoredEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import {
  evryConversationIdSchema,
  evryConversationMessageIdSchema,
  evryConversationPlanIdentitySchema,
  evryConversationRequestKeySchema,
  initialEvryConversationState,
} from "@/lib/evry/conversations/contract";
import type {
  EvryStoredConversation,
  EvryStoredConversationArtifact,
  EvryStoredConversationMessage,
} from "@/lib/evry/conversations/repository";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  fingerprintEvryActionPlan,
  fingerprintEvryActionPlanIntent,
  mintEvryPlanRequestKey,
  parseStoredEvryActionPlan,
} from "@/lib/evry/plans";
import type { StoredEvryActionPlan } from "@/lib/evry/plans/repository";
import {
  createFixtureRecipeRegistry,
  RECIPE_IDENTITY,
} from "@/lib/evry/recipes/fixtures.test-helper";
import {
  createEvryRecipeReuseRegistry,
  defineEvryRecipeReuse,
} from "@/lib/evry/recipes/reuse";

import { createCompletedEvryRecipeReuse } from "./reuse";
import {
  createEvryConversation,
  evryConversationStore,
  type EvryResumedConversation,
} from "./service";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const SOURCE_CONVERSATION_ID = evryConversationIdSchema.parse(
  "30000000-0000-4000-8000-000000000001"
);
const NEW_CONVERSATION_ID = evryConversationIdSchema.parse(
  "30000000-0000-4000-8000-000000000002"
);
const PLAN_ID = "40000000-0000-4000-8000-000000000001";
const NEW_PLAN_ID = "40000000-0000-4000-8000-000000000002";
const RESULT_ARTIFACT_ID = "50000000-0000-4000-8000-000000000001";
const NOW = new Date("2026-08-30T12:00:00.000Z");
const REQUEST_KEY = evryConversationRequestKeySchema.parse(
  "60000000-0000-4000-8000-000000000001"
);
const COPIED_INTENT =
  "Reuse this successful meeting invitation with fresh application data.";

const recipeRegistry = createFixtureRecipeRegistry();
const planRegistry = recipeRegistry.executionRegistry.planRegistry;
const document = parseStoredEvryActionPlan({
  document: JSON.parse(
    readFileSync(
      new URL("../recipes/meeting-invitation.golden.json", import.meta.url),
      "utf8"
    )
  ),
  registry: planRegistry,
});
const createdAt = new Date("2026-08-30T11:00:00.000Z");
const expiresAt = new Date("2026-08-30T11:15:00.000Z");
const fingerprint = fingerprintEvryActionPlan({
  actorUserId: ACTOR.userId,
  plantId: ACTOR.plantId,
  expiresAt,
  document,
});
const storedPlan: StoredEvryActionPlan = {
  id: PLAN_ID,
  actorUserId: ACTOR.userId,
  plantId: ACTOR.plantId,
  requestKey: mintEvryPlanRequestKey(),
  intentFingerprint: fingerprintEvryActionPlanIntent({
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    document,
  }),
  fingerprint,
  document,
  createdAt,
  expiresAt,
  supersedesPlanId: null,
  status: "completed",
  stateVersion: 3,
  stateChangedAt: createdAt,
};
const receipt = buildEvryReceiptArtifact({
  kind: "result",
  artifactVersion: 1,
  plan: { planId: PLAN_ID, fingerprint },
  title: "Receipt: meeting invitation",
  status: "completed",
  reuse: { recipeIdentity: RECIPE_IDENTITY, label: "Reuse" },
  steps: document.steps.map((step) => ({
    stepId: step.id,
    label: step.disclosure?.title ?? step.id,
    status: "completed" as const,
    resultCode: "effect_completed" as const,
    affectedCount: 1,
    excludedCount: 0,
    sourceLinks: [],
    retry: { status: "unavailable" as const },
    error: null,
  })),
});

function storedArtifact(
  artifactDocument: StoredEvryConversationArtifactDocument
): EvryStoredConversationArtifact {
  return {
    id: RESULT_ARTIFACT_ID,
    ordinal: 0,
    kind: artifactDocument.kind,
    document: artifactDocument,
    artifact: hydrateStoredEvryConversationArtifact(artifactDocument),
  };
}

function storedMessage(
  artifactDocument?: StoredEvryConversationArtifactDocument
): EvryStoredConversationMessage {
  return {
    id: evryConversationMessageIdSchema.parse(
      "70000000-0000-4000-8000-000000000001"
    ),
    requestKey: evryConversationRequestKeySchema.parse(
      "80000000-0000-4000-8000-000000000001"
    ),
    sequence: 0,
    author: "assistant",
    body: "Execution finished.",
    pageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    createdAt: NOW,
    artifacts: artifactDocument ? [storedArtifact(artifactDocument)] : [],
  };
}

function conversation(input: {
  id: typeof SOURCE_CONVERSATION_ID;
  activePlan: EvryStoredConversation["activePlan"];
  messages: readonly EvryStoredConversationMessage[];
}): EvryStoredConversation {
  return {
    id: input.id,
    actorUserId: ACTOR.userId,
    plantId: ACTOR.plantId,
    title: "Meeting invitation",
    createdAt: NOW,
    lastActivityAt: NOW,
    activePlan: input.activePlan,
    stateVersion: 0,
    state: initialEvryConversationState(),
    messages: input.messages,
  };
}

const source = conversation({
  id: SOURCE_CONVERSATION_ID,
  activePlan: null,
  messages: [storedMessage(receipt)],
});

function reusedConversation(
  activePlan: EvryStoredConversation["activePlan"] = evryConversationPlanIdentitySchema.parse(
    {
      planId: NEW_PLAN_ID,
      fingerprint: "b".repeat(64),
    }
  )
): EvryResumedConversation {
  const stored = conversation({
    id: NEW_CONVERSATION_ID,
    activePlan,
    messages: [
      {
        ...storedMessage(),
        author: "user",
        body: COPIED_INTENT,
      },
    ],
  });
  return {
    conversation: stored,
    activePlan: activePlan
      ? {
          identity: activePlan,
          status: "awaiting_confirmation",
          expiresAt: NOW.toISOString(),
          confirmable: true,
        }
      : null,
    context: {} as EvryResumedConversation["context"],
  };
}

function harness(resumed: EvryResumedConversation = reusedConversation()) {
  let createCalls = 0;
  const create: typeof createEvryConversation = async (input) => {
    createCalls++;
    assert.equal(input.actor, ACTOR);
    assert.equal(input.message, COPIED_INTENT);
    assert.equal(input.pageContext, null);
    assert.equal(input.requestPageContext, null);
    return resumed;
  };
  const registry = createEvryRecipeReuseRegistry([
    defineEvryRecipeReuse({
      identity: RECIPE_IDENTITY,
      recipeRegistry,
      project: () => ({
        recipeIdentity: RECIPE_IDENTITY,
        message: COPIED_INTENT,
      }),
    }),
  ]);
  const reuse = createCompletedEvryRecipeReuse({
    store: {
      ...evryConversationStore,
      async find(input) {
        return input.conversationId === SOURCE_CONVERSATION_ID &&
          input.actorUserId === ACTOR.userId &&
          input.plantId === ACTOR.plantId
          ? source
          : null;
      },
    },
    async findPlan(input) {
      return input.planId === PLAN_ID && input.fingerprint === fingerprint
        ? storedPlan
        : null;
    },
    create,
    registry,
    planRegistry,
  });
  return { reuse, createCalls: () => createCalls };
}

test("completed reuse creates a fresh conversation from copied intent only", async () => {
  const fake = harness();
  const result = await fake.reuse({
    actor: ACTOR,
    sourceConversationId: SOURCE_CONVERSATION_ID,
    resultArtifactId: RESULT_ARTIFACT_ID,
    requestKey: REQUEST_KEY,
    now: NOW,
  });
  assert.equal(result.status, "created");
  assert.equal(fake.createCalls(), 1);
  if (result.status !== "created") return;
  assert.equal(result.copiedIntent, COPIED_INTENT);
  assert.notEqual(result.resumed.conversation.id, source.id);
  assert.notEqual(
    result.resumed.conversation.activePlan?.planId,
    receipt.plan.planId
  );
  assert.notEqual(
    result.resumed.conversation.activePlan?.fingerprint,
    receipt.plan.fingerprint
  );
  const replay = await fake.reuse({
    actor: ACTOR,
    sourceConversationId: SOURCE_CONVERSATION_ID,
    resultArtifactId: RESULT_ARTIFACT_ID,
    requestKey: REQUEST_KEY,
    now: NOW,
  });
  assert.equal(replay.status, "created");
  if (replay.status === "created") {
    assert.equal(
      replay.resumed.conversation.id,
      result.resumed.conversation.id
    );
    assert.deepEqual(
      replay.resumed.conversation.activePlan,
      result.resumed.conversation.activePlan
    );
  }
});

test("reuse refuses a nonterminal receipt and any returned source identity", async () => {
  const partialReceipt = buildEvryReceiptArtifact({
    ...receipt,
    status: "partially_failed",
    reuse: undefined,
    steps: receipt.steps.map((step, index) =>
      index === 0
        ? step
        : {
            ...step,
            status: "failed" as const,
            resultCode: "effect_failed" as const,
            error: { kind: "expected" as const, message: "Failed" },
          }
    ),
  });
  const nonterminal = createCompletedEvryRecipeReuse({
    store: {
      ...evryConversationStore,
      async find() {
        return { ...source, messages: [storedMessage(partialReceipt)] };
      },
    },
    async findPlan() {
      throw new Error("nonterminal receipt must stop before plan lookup");
    },
    async create() {
      throw new Error("nonterminal receipt must not create a conversation");
    },
    registry: createEvryRecipeReuseRegistry([]),
    planRegistry,
  });
  assert.deepEqual(
    await nonterminal({
      actor: ACTOR,
      sourceConversationId: SOURCE_CONVERSATION_ID,
      resultArtifactId: RESULT_ARTIFACT_ID,
      requestKey: REQUEST_KEY,
      now: NOW,
    }),
    { status: "unavailable" }
  );

  const sourceIdentity = harness(
    reusedConversation({
      planId: NEW_PLAN_ID,
      fingerprint: receipt.plan.fingerprint,
    })
  );
  assert.deepEqual(
    await sourceIdentity.reuse({
      actor: ACTOR,
      sourceConversationId: SOURCE_CONVERSATION_ID,
      resultArtifactId: RESULT_ARTIFACT_ID,
      requestKey: REQUEST_KEY,
      now: NOW,
    }),
    { status: "unavailable" }
  );
});

test("reuse is neutral for another actor and reaches no plan or create boundary", async () => {
  let planReads = 0;
  let createCalls = 0;
  const reuse = createCompletedEvryRecipeReuse({
    store: {
      ...evryConversationStore,
      async find(input) {
        assert.notEqual(input.actorUserId, ACTOR.userId);
        return null;
      },
    },
    async findPlan() {
      planReads++;
      return storedPlan;
    },
    async create() {
      createCalls++;
      return reusedConversation();
    },
    registry: createEvryRecipeReuseRegistry([]),
    planRegistry,
  });
  assert.deepEqual(
    await reuse({
      actor: { ...ACTOR, userId: "10000000-0000-4000-8000-000000000002" },
      sourceConversationId: SOURCE_CONVERSATION_ID,
      resultArtifactId: RESULT_ARTIFACT_ID,
      requestKey: REQUEST_KEY,
      now: NOW,
    }),
    { status: "unavailable" }
  );
  assert.equal(planReads, 0);
  assert.equal(createCalls, 0);
});
