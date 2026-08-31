import { createHash } from "node:crypto";

import { z } from "zod";

import {
  parseEvryConversationArtifactDocument,
  type StoredEvryConversationArtifactDocument,
} from "@/lib/evry/conversations/artifacts";
import {
  EVRY_CONVERSATION_MAX_MESSAGE_CHARACTERS,
  evryConversationMessageIdSchema,
  evryConversationPlanIdentitySchema,
  evryConversationRequestKeySchema,
  type EvryConversationMessageId,
  type EvryConversationPlanIdentity,
  type EvryConversationRequestKey,
} from "@/lib/evry/conversations/contract";
import type {
  appendEvryConversationRecord,
  EvryStoredConversation,
  EvryStoredConversationMessage,
} from "@/lib/evry/conversations/repository";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type {
  EvryPageContext,
  EvryResolvedPageContext,
} from "@/lib/evry/resolvers/contract";

export type EvryCapabilityConversationStore = Readonly<{
  append: typeof appendEvryConversationRecord;
}>;

export type EvryCapabilityConversationSelectionInput = Readonly<{
  actor: EvryPlantActor;
  conversation: EvryStoredConversation;
  userRequestKey: string;
  literalUserText: string;
  pageContext: EvryResolvedPageContext | null;
  requestPageContext: EvryPageContext | null;
  now: Date;
}>;

export type EvryCapabilityConversationResultIdentity = Readonly<{
  messageId: EvryConversationMessageId;
  requestKey: EvryConversationRequestKey;
}>;

type EvryCapabilityActivePlanMutation =
  | Readonly<{ mode: "preserve" }>
  | Readonly<{ mode: "set"; plan: EvryConversationPlanIdentity }>;

export type EvryCapabilityConversationResult = Readonly<{
  body: string;
  artifacts: readonly StoredEvryConversationArtifactDocument[];
  activePlan?: EvryCapabilityActivePlanMutation;
}>;

/**
 * One closed pack registration. `matches` must be pure: composition evaluates
 * every matcher before choosing, and no adapter runs unless exactly one pack
 * matches. A pack returns content only; shared code owns every durable field.
 */
export type EvryCapabilityConversationContinuation = Readonly<{
  identity: string;
  matches(input: EvryCapabilityConversationSelectionInput): boolean;
  continue(
    input: EvryCapabilityConversationSelectionInput
  ): Promise<EvryCapabilityConversationResult | null>;
}>;

export class EvryCapabilityConversationAmbiguityError extends Error {
  constructor(identities: readonly string[]) {
    super(`Multiple Evry capability packs matched: ${identities.join(", ")}`);
    this.name = "EvryCapabilityConversationAmbiguityError";
  }
}

function derivedUuid(
  conversationId: string,
  userRequestKey: string,
  purpose: "message" | "request"
): string {
  const hash = createHash("sha256");
  for (const value of [
    "evry-capability-continuation-v1",
    conversationId,
    userRequestKey,
    purpose,
  ]) {
    const bytes = Buffer.from(value, "utf8");
    hash.update(String(bytes.length));
    hash.update(":");
    hash.update(bytes);
  }
  const bytes = hash.digest("hex").slice(0, 32).split("");
  bytes[12] = "4";
  bytes[16] = ((Number.parseInt(bytes[16] ?? "0", 16) & 0x3) | 0x8).toString(
    16
  );
  return `${bytes.slice(0, 8).join("")}-${bytes
    .slice(8, 12)
    .join("")}-${bytes.slice(12, 16).join("")}-${bytes
    .slice(16, 20)
    .join("")}-${bytes.slice(20).join("")}`;
}

export function evryCapabilityConversationResultIdentity(input: {
  conversationId: string;
  userRequestKey: string;
}): EvryCapabilityConversationResultIdentity {
  return Object.freeze({
    messageId: evryConversationMessageIdSchema.parse(
      derivedUuid(input.conversationId, input.userRequestKey, "message")
    ),
    requestKey: evryConversationRequestKeySchema.parse(
      derivedUuid(input.conversationId, input.userRequestKey, "request")
    ),
  });
}

export function hasDurableEvryCapabilityConversationResult(input: {
  conversation: EvryStoredConversation;
  userRequestKey: string;
}): boolean {
  const identity = evryCapabilityConversationResultIdentity({
    conversationId: input.conversation.id,
    userRequestKey: input.userRequestKey,
  });
  const message = input.conversation.messages.find(
    (candidate) =>
      candidate.id === identity.messageId &&
      candidate.requestKey === identity.requestKey
  );
  return message ? isCompleteCapabilityResultMessage(message) : false;
}

const activePlanMutationSchema = z.discriminatedUnion("mode", [
  z.strictObject({ mode: z.literal("preserve") }),
  z.strictObject({
    mode: z.literal("set"),
    plan: evryConversationPlanIdentitySchema,
  }),
]);
const resultSchema = z.strictObject({
  body: z.string().trim().min(1).max(EVRY_CONVERSATION_MAX_MESSAGE_CHARACTERS),
  artifacts: z.array(z.unknown()).min(1).max(16),
  activePlan: activePlanMutationSchema.optional(),
});

function parseCapabilityResult(
  input: EvryCapabilityConversationResult
): EvryCapabilityConversationResult {
  const parsed = resultSchema.parse(input);
  const artifacts = Object.freeze(
    parsed.artifacts.map(parseEvryConversationArtifactDocument)
  );
  const confirmationPlans = artifacts.flatMap((artifact) =>
    artifact.kind === "confirmation" ? [artifact.plan] : []
  );
  const setPlan =
    parsed.activePlan?.mode === "set" ? parsed.activePlan.plan : null;
  if (
    (setPlan === null && confirmationPlans.length !== 0) ||
    (setPlan !== null &&
      (confirmationPlans.length !== 1 ||
        confirmationPlans[0]?.planId !== setPlan.planId ||
        confirmationPlans[0]?.fingerprint !== setPlan.fingerprint))
  ) {
    throw new Error(
      "Evry capability confirmation must bind one exact active plan"
    );
  }
  return Object.freeze({
    body: parsed.body,
    artifacts,
    activePlan: parsed.activePlan,
  });
}

function isCompleteCapabilityResultMessage(
  message: EvryStoredConversationMessage
): boolean {
  if (
    message.author !== "assistant" ||
    message.deliveryStatus !== "complete" ||
    message.body.trim().length === 0 ||
    message.body.length > EVRY_CONVERSATION_MAX_MESSAGE_CHARACTERS ||
    message.artifacts.length < 1 ||
    message.artifacts.length > 16
  ) {
    return false;
  }
  return message.artifacts.every((artifact) => {
    try {
      const parsed = parseEvryConversationArtifactDocument(artifact.document);
      return parsed.kind === artifact.kind;
    } catch {
      return false;
    }
  });
}

async function appendResult(input: {
  selection: EvryCapabilityConversationSelectionInput;
  store: EvryCapabilityConversationStore;
  identity: EvryCapabilityConversationResultIdentity;
  result: EvryCapabilityConversationResult;
}): Promise<EvryStoredConversation> {
  const result = parseCapabilityResult(input.result);
  return input.store.append({
    messageId: input.identity.messageId,
    conversationId: input.selection.conversation.id,
    actorUserId: input.selection.actor.userId,
    plantId: input.selection.actor.plantId,
    requestKey: input.identity.requestKey,
    expectedStateVersion: input.selection.conversation.stateVersion,
    state: input.selection.conversation.state,
    author: "assistant",
    body: result.body,
    pageContext: null,
    requestPageContext: null,
    relevanceKeys: [],
    deliveryStatus: "complete",
    artifacts: result.artifacts,
    idempotencyContext: { status: "none" },
    replayReference: null,
    activePlan: result.activePlan ?? { mode: "preserve" },
    createdAt: input.selection.now,
    knownConversation: input.selection.conversation,
  });
}

/** Recover a request's durable result, then select exactly one closed pack. */
export function composeEvryCapabilityConversationContinuations(
  continuations: readonly EvryCapabilityConversationContinuation[]
): (
  input: EvryCapabilityConversationSelectionInput &
    Readonly<{ store: EvryCapabilityConversationStore }>
) => Promise<EvryStoredConversation | null> {
  const identities = continuations.map(({ identity }) => identity);
  if (
    identities.some((identity) => identity.trim().length === 0) ||
    new Set(identities).size !== identities.length
  ) {
    throw new Error("Evry capability continuation identities must be unique");
  }

  return async function continueEvryCapabilityConversation(input) {
    if (
      hasDurableEvryCapabilityConversationResult({
        conversation: input.conversation,
        userRequestKey: input.userRequestKey,
      })
    ) {
      return input.conversation;
    }

    const selectionInput: EvryCapabilityConversationSelectionInput = input;
    const matches = continuations.filter((continuation) =>
      continuation.matches(selectionInput)
    );
    if (matches.length > 1) {
      throw new EvryCapabilityConversationAmbiguityError(
        matches.map(({ identity }) => identity)
      );
    }
    const selected = matches[0];
    if (!selected) return null;
    const result = await selected.continue(selectionInput);
    if (!result) return null;
    return appendResult({
      selection: selectionInput,
      store: input.store,
      identity: evryCapabilityConversationResultIdentity({
        conversationId: input.conversation.id,
        userRequestKey: input.userRequestKey,
      }),
      result,
    });
  };
}
