import assert from "node:assert/strict";
import { test } from "node:test";

import { parseEvryConversationArtifactDocument } from "@/lib/evry/conversations/artifacts";
import {
  initialEvryConversationState,
  type EvryConversationPlanIdentity,
} from "@/lib/evry/conversations/contract";
import type {
  EvryStoredConversation,
  EvryStoredConversationMessage,
} from "@/lib/evry/conversations/repository";
import type { EvryConversationStore } from "@/lib/evry/conversations/service";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import {
  persistEvryPeopleFileReview,
  recoverEvryPeopleFileReview,
} from "./file-conversation";

const ACTOR = {
  userId: "10000000-0000-4000-8000-000000000001",
  plantId: "20000000-0000-4000-8000-000000000001",
  seat: "owner",
} as unknown as EvryPlantActor;
const CONVERSATION_ID = "30000000-0000-4000-8000-000000000001" as never;
const REQUEST_KEY = "40000000-0000-4000-8000-000000000001" as never;
const NOW = new Date("2026-08-29T12:00:00.000Z");
const PLAN = {
  planId: "50000000-0000-4000-8000-000000000001",
  fingerprint: "a".repeat(64),
} as EvryConversationPlanIdentity;
const DIGEST = "b".repeat(64);
const ATTACHMENT_REFERENCE = "signed-reference-a";
const STORED_PLAN = {
  document: {
    steps: [
      {
        capabilityIdentity: "people.crm.imports.execute-bulk-import",
        arguments: {
          attachmentReference: ATTACHMENT_REFERENCE,
          attachmentDigest: DIGEST,
        },
      },
    ],
  },
} as never;
const CONFIRMATION = parseEvryConversationArtifactDocument({
  kind: "confirmation",
  plan: PLAN,
  title: "Import one person",
  actionLabel: "Import",
  items: [{ label: "Person", value: "Ada Lovelace" }],
  consequences: ["Creates one People record."],
});

function storedMessage(input: {
  id: string;
  requestKey: string;
  sequence: number;
  author: "user" | "assistant";
  body: string;
  artifacts?: readonly (typeof CONFIRMATION)[];
}): EvryStoredConversationMessage {
  return {
    id: input.id as never,
    requestKey: input.requestKey as never,
    sequence: input.sequence,
    author: input.author,
    body: input.body,
    pageContext: null,
    replayReference: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: (input.artifacts ?? []).map((document, ordinal) => ({
      id: `60000000-0000-4000-8000-${String(ordinal + 1).padStart(12, "0")}`,
      ordinal,
      kind: document.kind,
      document,
      artifact: document as never,
    })),
    createdAt: NOW,
  };
}

function memoryStore(loss: { afterAssistantCommit: boolean }) {
  let current: EvryStoredConversation | null = null;
  let assistantAppends = 0;
  const store: EvryConversationStore = {
    async create(input) {
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
          storedMessage({
            id: "70000000-0000-4000-8000-000000000001",
            requestKey: input.requestKey,
            sequence: 0,
            author: "user",
            body: input.body,
          }),
        ],
      };
      return current;
    },
    async find() {
      return current;
    },
    async append(input) {
      if (!current) throw new Error("missing conversation");
      const replay = current.messages.find(
        ({ requestKey }) => requestKey === input.requestKey
      );
      if (replay) return current;
      if (input.author === "assistant") assistantAppends += 1;
      current = {
        ...current,
        activePlan:
          input.activePlan?.mode === "set"
            ? input.activePlan.plan
            : current.activePlan,
        stateVersion: current.stateVersion + 1,
        messages: [
          ...current.messages,
          storedMessage({
            id: input.messageId,
            requestKey: input.requestKey,
            sequence: current.messages.length,
            author: input.author,
            body: input.body,
            artifacts: input.artifacts as readonly (typeof CONFIRMATION)[],
          }),
        ],
      };
      if (input.author === "assistant" && loss.afterAssistantCommit) {
        loss.afterAssistantCommit = false;
        throw new Error("response lost after durable file review");
      }
      return current;
    },
  };
  return {
    store,
    current: () => current,
    assistantAppends: () => assistantAppends,
  };
}

const revalidatePlan = async () => ({
  identity: PLAN,
  status: "awaiting_confirmation" as const,
  expiresAt: "2026-08-29T12:15:00.000Z",
  confirmable: true,
});

test("durable file review survives response loss and source removal", async () => {
  const memory = memoryStore({ afterAssistantCommit: true });
  const input = {
    actor: ACTOR,
    conversationId: null,
    requestKey: REQUEST_KEY,
    userMessage: "Attached a People CSV import for review.",
    assistantMessage: "Review the exact import.",
    artifacts: [CONFIRMATION],
    plan: PLAN,
    now: NOW,
    store: memory.store,
    revalidatePlan,
  };

  await assert.rejects(
    persistEvryPeopleFileReview(input),
    /response lost after durable file review/
  );
  const recovered = await recoverEvryPeopleFileReview({
    ...input,
    expectedAttachment: { kind: "people_csv", digest: DIGEST },
    findByRequestKey: async () => memory.current(),
    loadPlan: async () => STORED_PLAN,
  });

  assert.ok(recovered);
  assert.equal(memory.assistantAppends(), 1);
  assert.equal(recovered.resumed.conversation.messages.length, 2);
  assert.deepEqual(recovered.resumed.conversation.activePlan, PLAN);
  assert.deepEqual(recovered.attachment, {
    kind: "people_csv",
    digest: DIGEST,
    reference: ATTACHMENT_REFERENCE,
  });
  assert.deepEqual(
    recovered.resumed.conversation.messages[1]?.artifacts.map(
      ({ document }) => document.kind
    ),
    ["confirmation"]
  );
});

test("same request key cannot recover a different file workflow", async () => {
  const memory = memoryStore({ afterAssistantCommit: false });
  const input = {
    actor: ACTOR,
    conversationId: null,
    requestKey: REQUEST_KEY,
    userMessage: "Attached a person photo for review.",
    assistantMessage: "Review the exact photo.",
    artifacts: [CONFIRMATION],
    plan: PLAN,
    now: NOW,
    store: memory.store,
    revalidatePlan,
  };
  await persistEvryPeopleFileReview(input);

  await assert.rejects(
    recoverEvryPeopleFileReview({
      ...input,
      expectedAttachment: { kind: "people_csv", digest: DIGEST },
      userMessage: "Attached a People CSV import for review.",
      findByRequestKey: async () => memory.current(),
      loadPlan: async () => STORED_PLAN,
    }),
    { name: "EvryConversationIdempotencyError" }
  );
});

test("same metadata with different bytes cannot recover the old file plan", async () => {
  const memory = memoryStore({ afterAssistantCommit: false });
  const input = {
    actor: ACTOR,
    conversationId: null,
    requestKey: REQUEST_KEY,
    userMessage: "Attached a People CSV import for review.",
    assistantMessage: "Review the exact import.",
    artifacts: [CONFIRMATION],
    plan: PLAN,
    now: NOW,
    store: memory.store,
    revalidatePlan,
  };
  await persistEvryPeopleFileReview(input);

  await assert.rejects(
    recoverEvryPeopleFileReview({
      ...input,
      // The filename, MIME type, size, and last-modified value may all match;
      // the staged content digest is the recovery identity.
      expectedAttachment: { kind: "people_csv", digest: "c".repeat(64) },
      findByRequestKey: async () => memory.current(),
      loadPlan: async () => STORED_PLAN,
    }),
    { name: "EvryConversationIdempotencyError" }
  );
});
