import { createHash } from "node:crypto";

import {
  evryConversationMessageIdSchema,
  evryConversationRequestKeySchema,
  type EvryConversationMessageId,
  type EvryConversationRequestKey,
} from "@/lib/evry/conversations/contract";
import type {
  appendEvryConversationRecord,
  EvryStoredConversation,
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

export type EvryCapabilityConversationContinuationInput =
  EvryCapabilityConversationSelectionInput &
    Readonly<{
      store: EvryCapabilityConversationStore;
      resultIdentity: EvryCapabilityConversationResultIdentity;
    }>;

/**
 * One closed pack registration. `matches` must be pure: composition evaluates
 * every matcher before choosing, and no adapter runs unless exactly one pack
 * matches. The continuation receives the one stable durable result identity.
 */
export type EvryCapabilityConversationContinuation = Readonly<{
  identity: string;
  matches(input: EvryCapabilityConversationSelectionInput): boolean;
  continue(
    input: EvryCapabilityConversationContinuationInput
  ): Promise<EvryStoredConversation | null>;
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

function hasDurableContinuationResult(
  conversation: EvryStoredConversation,
  identity: EvryCapabilityConversationResultIdentity
): boolean {
  return conversation.messages.some(
    (message) =>
      message.id === identity.messageId &&
      message.requestKey === identity.requestKey &&
      message.author === "assistant"
  );
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
    const resultIdentity = evryCapabilityConversationResultIdentity({
      conversationId: input.conversation.id,
      userRequestKey: input.userRequestKey,
    });
    if (hasDurableContinuationResult(input.conversation, resultIdentity)) {
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
    return selected ? selected.continue({ ...input, resultIdentity }) : null;
  };
}
