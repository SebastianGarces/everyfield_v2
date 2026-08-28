import { createHash, randomUUID } from "node:crypto";

import type {
  EvryConversationAuthor,
  EvryConversationDeliveryStatus,
} from "@/db/schema";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import {
  findExactEvryActionPlan,
  type StoredEvryActionPlan,
} from "@/lib/evry/plans/repository";
import type { EvryPageContext } from "@/lib/evry/resolvers/contract";

import {
  storedEvryClarificationArtifactDocument,
  type StoredEvryConversationArtifactDocument,
} from "./artifacts";
import {
  compileEvryConversationContext,
  type EvryCompiledConversationContext,
  type EvryRevalidatedActivePlan,
} from "./context";
import {
  evryConversationIdSchema,
  evryConversationMessageIdSchema,
  evryConversationPlanIdentitySchema,
  evryConversationRequestKeySchema,
  type EvryConversationId,
  type EvryConversationMessageId,
  type EvryConversationPlanIdentity,
  type EvryConversationRelevanceKey,
  type EvryConversationRequestKey,
  type EvryConversationStateDocument,
} from "./contract";
import {
  appendEvryConversationRecord,
  createEvryConversationRecord,
  findEvryConversationRecord,
  type EvryStoredConversation,
} from "./repository";
import {
  resolveEvryConversationReference,
  type EvryConversationReferenceResolution,
} from "./references";

export type EvryConversationStore = Readonly<{
  create: typeof createEvryConversationRecord;
  find: typeof findEvryConversationRecord;
  append: typeof appendEvryConversationRecord;
}>;

export const evryConversationStore: EvryConversationStore = Object.freeze({
  create: createEvryConversationRecord,
  find: findEvryConversationRecord,
  append: appendEvryConversationRecord,
});

export type EvryConversationPlanLoader = (input: {
  planId: string;
  actorUserId: string;
  plantId: string;
  fingerprint: string;
}) => Promise<StoredEvryActionPlan | null>;

export type EvryResumedConversation = Readonly<{
  conversation: EvryStoredConversation;
  activePlan: EvryRevalidatedActivePlan | null;
  context: EvryCompiledConversationContext;
}>;

function revalidatedPlan(
  stored: StoredEvryActionPlan,
  now: Date
): EvryRevalidatedActivePlan {
  const expiredBeforeExecution =
    (stored.status === "awaiting_confirmation" ||
      stored.status === "approved") &&
    stored.expiresAt <= now;
  const status = expiredBeforeExecution ? "expired" : stored.status;
  return Object.freeze({
    identity: evryConversationPlanIdentitySchema.parse({
      planId: stored.id,
      fingerprint: stored.fingerprint,
    }),
    status,
    expiresAt: stored.expiresAt.toISOString(),
    confirmable: status === "awaiting_confirmation",
  });
}

export async function resumeEvryConversation(input: {
  actor: EvryPlantActor;
  conversationId: string;
  now: Date;
  focusRelevanceKeys?: readonly EvryConversationRelevanceKey[];
  store?: EvryConversationStore;
  loadPlan?: EvryConversationPlanLoader;
}): Promise<EvryResumedConversation | null> {
  const store = input.store ?? evryConversationStore;
  const conversation = await store.find({
    conversationId: input.conversationId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
  });
  if (!conversation) return null;

  let activePlan: EvryRevalidatedActivePlan | null = null;
  if (conversation.activePlan) {
    const storedPlan = await (input.loadPlan ?? findExactEvryActionPlan)({
      planId: conversation.activePlan.planId,
      fingerprint: conversation.activePlan.fingerprint,
      actorUserId: input.actor.userId,
      plantId: input.actor.plantId,
    });
    if (
      !storedPlan ||
      storedPlan.id !== conversation.activePlan.planId ||
      storedPlan.fingerprint !== conversation.activePlan.fingerprint ||
      storedPlan.actorUserId !== input.actor.userId ||
      storedPlan.plantId !== input.actor.plantId
    ) {
      return null;
    }
    activePlan = revalidatedPlan(storedPlan, input.now);
  }

  return Object.freeze({
    conversation,
    activePlan,
    context: compileEvryConversationContext({
      conversation,
      activePlan,
      focusRelevanceKeys: input.focusRelevanceKeys,
    }),
  });
}

export async function createEvryConversation(input: {
  actor: EvryPlantActor;
  requestKey: string;
  message: string;
  pageContext: EvryPageContext | null;
  now: Date;
  store?: EvryConversationStore;
}): Promise<EvryResumedConversation> {
  const requestKey = evryConversationRequestKeySchema.parse(input.requestKey);
  const conversation = await (input.store ?? evryConversationStore).create({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey,
    body: input.message,
    pageContext: input.pageContext,
    createdAt: input.now,
  });
  return Object.freeze({
    conversation,
    activePlan: null,
    context: compileEvryConversationContext({
      conversation,
      activePlan: null,
    }),
  });
}

export async function appendTrustedEvryConversationMessage(input: {
  messageId: EvryConversationMessageId;
  actor: EvryPlantActor;
  conversationId: EvryConversationId;
  requestKey: EvryConversationRequestKey;
  expectedStateVersion: number;
  state: EvryConversationStateDocument;
  author: EvryConversationAuthor;
  body: string;
  pageContext: EvryPageContext | null;
  relevanceKeys: readonly EvryConversationRelevanceKey[];
  deliveryStatus: EvryConversationDeliveryStatus;
  artifacts: readonly StoredEvryConversationArtifactDocument[];
  activePlan?:
    | Readonly<{ mode: "preserve" }>
    | Readonly<{ mode: "clear" }>
    | Readonly<{ mode: "set"; plan: EvryConversationPlanIdentity }>;
  now: Date;
  store?: EvryConversationStore;
}): Promise<EvryStoredConversation> {
  return (input.store ?? evryConversationStore).append({
    messageId: input.messageId,
    conversationId: input.conversationId,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey: input.requestKey,
    expectedStateVersion: input.expectedStateVersion,
    state: input.state,
    author: input.author,
    body: input.body,
    pageContext: input.pageContext,
    relevanceKeys: input.relevanceKeys,
    deliveryStatus: input.deliveryStatus,
    artifacts: input.artifacts,
    activePlan: input.activePlan,
    createdAt: input.now,
  });
}

function derivedClarificationRequestKey(
  requestKey: EvryConversationRequestKey
): EvryConversationRequestKey {
  const bytes = createHash("sha256")
    .update(`evry-clarification:${requestKey}`)
    .digest("hex")
    .slice(0, 32)
    .split("");
  bytes[12] = "4";
  bytes[16] = ((Number.parseInt(bytes[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16
  );
  return evryConversationRequestKeySchema.parse(
    `${bytes.slice(0, 8).join("")}-${bytes.slice(8, 12).join("")}-${bytes
      .slice(12, 16)
      .join("")}-${bytes.slice(16, 20).join("")}-${bytes.slice(20).join("")}`
  );
}

export type EvryConversationContinuation =
  | Readonly<{
      status: "continued";
      resumed: EvryResumedConversation;
      reference: Exclude<
        EvryConversationReferenceResolution,
        { status: "clarification" }
      >;
    }>
  | Readonly<{
      status: "clarification";
      resumed: EvryResumedConversation;
      reference: Extract<
        EvryConversationReferenceResolution,
        { status: "clarification" }
      >;
    }>;

/** Persist one user turn and any deterministic clarification; no model runs. */
export async function continueEvryConversation(input: {
  actor: EvryPlantActor;
  conversationId: string;
  requestKey: string;
  message: string;
  pageContext: EvryPageContext | null;
  now: Date;
  store?: EvryConversationStore;
  loadPlan?: EvryConversationPlanLoader;
}): Promise<EvryConversationContinuation | null> {
  const store = input.store ?? evryConversationStore;
  const conversationId = evryConversationIdSchema.safeParse(
    input.conversationId
  );
  const requestKey = evryConversationRequestKeySchema.safeParse(
    input.requestKey
  );
  if (!conversationId.success || !requestKey.success) return null;

  const current = await store.find({
    conversationId: conversationId.data,
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
  });
  if (!current) return null;

  const reference = resolveEvryConversationReference({
    text: input.message,
    state: current.state,
    now: input.now,
  });
  const relevanceKeys =
    reference.status === "resolved" ? reference.relevanceKeys : [];
  let appended = await appendTrustedEvryConversationMessage({
    messageId: evryConversationMessageIdSchema.parse(randomUUID()),
    actor: input.actor,
    conversationId: conversationId.data,
    requestKey: requestKey.data,
    expectedStateVersion: current.stateVersion,
    state: current.state,
    author: "user",
    body: input.message,
    pageContext: input.pageContext,
    relevanceKeys,
    deliveryStatus: "complete",
    artifacts: [],
    activePlan: { mode: "preserve" },
    now: input.now,
    store,
  });

  if (reference.status === "clarification") {
    appended = await appendTrustedEvryConversationMessage({
      messageId: evryConversationMessageIdSchema.parse(randomUUID()),
      actor: input.actor,
      conversationId: conversationId.data,
      requestKey: derivedClarificationRequestKey(requestKey.data),
      expectedStateVersion: appended.stateVersion,
      state: appended.state,
      author: "assistant",
      body: reference.artifact.prompt,
      pageContext: null,
      relevanceKeys: [],
      deliveryStatus: "complete",
      artifacts: [storedEvryClarificationArtifactDocument(reference.artifact)],
      activePlan: { mode: "preserve" },
      now: input.now,
      store,
    });
  }

  const resumed = await resumeEvryConversation({
    actor: input.actor,
    conversationId: appended.id,
    now: input.now,
    focusRelevanceKeys: relevanceKeys,
    store,
    loadPlan: input.loadPlan,
  });
  if (!resumed) return null;
  return reference.status === "clarification"
    ? { status: "clarification", resumed, reference }
    : { status: "continued", resumed, reference };
}
