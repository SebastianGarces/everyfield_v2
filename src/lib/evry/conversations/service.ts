import { createHash, randomUUID } from "node:crypto";

import type {
  EvryConversationAuthor,
  EvryConversationDeliveryStatus,
} from "@/db/schema";
import {
  evryCapabilityConversationResultIdentity,
  hasDurableEvryCapabilityConversationResult,
} from "@/lib/evry/capabilities/conversation";
import { continueProductionEvryCapabilityConversation } from "@/lib/evry/capabilities/production";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import { boundaryArtifactFor } from "@/lib/evry/policy/artifacts";
import type {
  EvryPageContext,
  EvryResolvedPageContext,
} from "@/lib/evry/resolvers/contract";
import type { EvryConversationStreamStage } from "@/lib/evry/streaming/conversation-wire";

import {
  evryBoundaryArtifactDocument,
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
  evryConversationReplayReferenceSchema,
  evryConversationRequestKeySchema,
  type EvryConversationId,
  type EvryConversationMessageId,
  type EvryConversationMessageIdempotencyContext,
  type EvryConversationPlanIdentity,
  type EvryConversationReplayReference,
  type EvryConversationRelevanceKey,
  type EvryConversationRequestKey,
  type EvryConversationStateDocument,
} from "./contract";
import {
  revalidateProductionEvryConversationPlan,
  type EvryConversationPlanResumeRevalidator,
} from "./plan-resume";
import {
  appendEvryConversationRecord,
  createEvryConversationRecord,
  EvryConversationIdempotencyError,
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

async function appendUnmatchedEvryConversationResult(input: {
  actor: EvryPlantActor;
  conversation: EvryStoredConversation;
  userRequestKey: EvryConversationRequestKey;
  now: Date;
  store: EvryConversationStore;
}): Promise<EvryStoredConversation> {
  const identity = evryCapabilityConversationResultIdentity({
    conversationId: input.conversation.id,
    userRequestKey: input.userRequestKey,
  });
  const artifact = boundaryArtifactFor("ambiguous");
  return appendTrustedEvryConversationMessage({
    messageId: identity.messageId,
    actor: input.actor,
    conversationId: input.conversation.id,
    requestKey: identity.requestKey,
    expectedStateVersion: input.conversation.stateVersion,
    state: input.conversation.state,
    author: "assistant",
    body: artifact.message,
    pageContext: null,
    requestPageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: [evryBoundaryArtifactDocument("ambiguous")],
    idempotencyContext: { status: "none" },
    replayReference: null,
    activePlan: { mode: "preserve" },
    now: input.now,
    store: input.store,
  });
}

export type EvryResumedConversation = Readonly<{
  conversation: EvryStoredConversation;
  activePlan: EvryRevalidatedActivePlan | null;
  context: EvryCompiledConversationContext;
}>;

export async function resumeEvryConversation(input: {
  actor: EvryPlantActor;
  conversationId: string;
  now: Date;
  focusRelevanceKeys?: readonly EvryConversationRelevanceKey[];
  store?: EvryConversationStore;
  revalidatePlan?: EvryConversationPlanResumeRevalidator;
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
    activePlan = await (
      input.revalidatePlan ?? revalidateProductionEvryConversationPlan
    )({
      actor: input.actor,
      identity: conversation.activePlan,
      checkedAt: input.now,
    });
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
  pageContext: EvryResolvedPageContext | null;
  requestPageContext: EvryPageContext | null;
  now: Date;
  store?: EvryConversationStore;
  continueCapabilityConversation?: typeof continueProductionEvryCapabilityConversation;
  reportStage?: (stage: EvryConversationStreamStage) => void | Promise<void>;
}): Promise<EvryResumedConversation> {
  const requestKey = evryConversationRequestKeySchema.parse(input.requestKey);
  const store = input.store ?? evryConversationStore;
  let conversation = await store.create({
    actorUserId: input.actor.userId,
    plantId: input.actor.plantId,
    requestKey,
    body: input.message,
    pageContext: input.pageContext,
    requestPageContext: input.requestPageContext,
    createdAt: input.now,
  });
  await input.reportStage?.("compiling_response");
  const continued = await (
    input.continueCapabilityConversation ??
    continueProductionEvryCapabilityConversation
  )({
    actor: input.actor,
    conversation,
    userRequestKey: requestKey,
    literalUserText: input.message,
    pageContext: input.pageContext,
    requestPageContext: input.requestPageContext,
    now: input.now,
    store,
  });
  if (continued === null) {
    conversation = await appendUnmatchedEvryConversationResult({
      actor: input.actor,
      conversation,
      userRequestKey: requestKey,
      now: input.now,
      store,
    });
  } else {
    conversation = continued;
  }
  const resumed = await resumeEvryConversation({
    actor: input.actor,
    conversationId: conversation.id,
    now: input.now,
    store,
  });
  if (!resumed) throw new Error("Created Evry conversation disappeared");
  return resumed;
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
  pageContext: EvryResolvedPageContext | null;
  requestPageContext: EvryPageContext | null;
  relevanceKeys: readonly EvryConversationRelevanceKey[];
  deliveryStatus: EvryConversationDeliveryStatus;
  artifacts: readonly StoredEvryConversationArtifactDocument[];
  idempotencyContext: EvryConversationMessageIdempotencyContext;
  replayReference: EvryConversationReplayReference | null;
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
    requestPageContext: input.requestPageContext,
    relevanceKeys: input.relevanceKeys,
    deliveryStatus: input.deliveryStatus,
    artifacts: input.artifacts,
    idempotencyContext: input.idempotencyContext,
    replayReference: input.replayReference,
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

function sameResolvedPageContext(
  left: EvryResolvedPageContext | null,
  right: EvryResolvedPageContext | null
): boolean {
  return (
    (left === null && right === null) ||
    (left !== null &&
      right !== null &&
      left.kind === right.kind &&
      left.recordId === right.recordId)
  );
}

function assertDurableCapabilityReplayRequest(input: {
  conversation: EvryStoredConversation;
  requestKey: EvryConversationRequestKey;
  message: string;
  pageContext: EvryResolvedPageContext | null;
}): void {
  const userMessage = input.conversation.messages.find(
    (message) =>
      message.requestKey === input.requestKey && message.author === "user"
  );
  if (
    !userMessage ||
    userMessage.body !== input.message ||
    !sameResolvedPageContext(userMessage.pageContext, input.pageContext)
  ) {
    throw new EvryConversationIdempotencyError();
  }
}

function durableCapabilityReplayReference(input: {
  conversation: EvryStoredConversation;
  requestKey: EvryConversationRequestKey;
}): EvryConversationReplayReference {
  const userMessage = input.conversation.messages.find(
    (message) =>
      message.requestKey === input.requestKey && message.author === "user"
  );
  const replayReference = evryConversationReplayReferenceSchema.safeParse(
    userMessage?.replayReference
  );
  if (!replayReference.success) {
    throw new EvryConversationIdempotencyError();
  }
  return replayReference.data;
}

/** Persist one user turn and any deterministic clarification; no model runs. */
export async function continueEvryConversation(input: {
  actor: EvryPlantActor;
  conversationId: string;
  requestKey: string;
  message: string;
  pageContext: EvryResolvedPageContext | null;
  requestPageContext: EvryPageContext | null;
  now: Date;
  store?: EvryConversationStore;
  continueCapabilityConversation?: typeof continueProductionEvryCapabilityConversation;
  resolveReference?: typeof resolveEvryConversationReference;
  revalidatePlan?: EvryConversationPlanResumeRevalidator;
  reportStage?: (stage: EvryConversationStreamStage) => void | Promise<void>;
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

  // A prior request may have committed both its user turn and its capability
  // result before the response was lost. Recover that immutable result before
  // reference resolution, append, selection, or source/plan work can rerun.
  if (
    hasDurableEvryCapabilityConversationResult({
      conversation: current,
      userRequestKey: requestKey.data,
    })
  ) {
    assertDurableCapabilityReplayRequest({
      conversation: current,
      requestKey: requestKey.data,
      message: input.message,
      pageContext: input.pageContext,
    });
    const replayReference = durableCapabilityReplayReference({
      conversation: current,
      requestKey: requestKey.data,
    });
    const resumed = await resumeEvryConversation({
      actor: input.actor,
      conversationId: current.id,
      now: input.now,
      store,
      revalidatePlan: input.revalidatePlan,
    });
    return resumed
      ? {
          status: "continued",
          resumed,
          reference: replayReference,
        }
      : null;
  }

  await input.reportStage?.("resolving_references");
  const reference = (
    input.resolveReference ?? resolveEvryConversationReference
  )({
    text: input.message,
    state: current.state,
    now: input.now,
  });
  const relevanceKeys =
    reference.status === "resolved" ? reference.relevanceKeys : [];
  const idempotencyContext: EvryConversationMessageIdempotencyContext =
    reference.status === "resolved"
      ? {
          status: "resolved",
          referenceKey: reference.reference.key,
          entityType: reference.reference.entityType,
          entityId: reference.reference.entityId,
        }
      : reference.status === "clarification"
        ? { status: "clarification", reason: reference.reason }
        : { status: "not_applicable" };
  const replayReference: EvryConversationReplayReference | null =
    reference.status === "resolved"
      ? {
          status: "resolved",
          reference: reference.reference,
          relevanceKeys: reference.relevanceKeys,
        }
      : reference.status === "not_applicable"
        ? { status: "not_applicable" }
        : null;
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
    requestPageContext: input.requestPageContext,
    relevanceKeys,
    deliveryStatus: "complete",
    artifacts: [],
    idempotencyContext,
    replayReference,
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
      requestPageContext: null,
      relevanceKeys: [],
      deliveryStatus: "complete",
      artifacts: [storedEvryClarificationArtifactDocument(reference.artifact)],
      idempotencyContext: { status: "none" },
      replayReference: null,
      activePlan: { mode: "preserve" },
      now: input.now,
      store,
    });
  } else {
    const continued = await (
      input.continueCapabilityConversation ??
      continueProductionEvryCapabilityConversation
    )({
      actor: input.actor,
      conversation: appended,
      userRequestKey: requestKey.data,
      literalUserText: input.message,
      pageContext: input.pageContext,
      requestPageContext: input.requestPageContext,
      now: input.now,
      store,
    });
    appended =
      continued ??
      (await appendUnmatchedEvryConversationResult({
        actor: input.actor,
        conversation: appended,
        userRequestKey: requestKey.data,
        now: input.now,
        store,
      }));
  }

  await input.reportStage?.(
    current.activePlan ? "revalidating_plan" : "compiling_response"
  );
  const resumed = await resumeEvryConversation({
    actor: input.actor,
    conversationId: appended.id,
    now: input.now,
    focusRelevanceKeys: relevanceKeys,
    store,
    revalidatePlan: input.revalidatePlan,
  });
  if (!resumed) return null;
  return reference.status === "clarification"
    ? { status: "clarification", resumed, reference }
    : { status: "continued", resumed, reference };
}
