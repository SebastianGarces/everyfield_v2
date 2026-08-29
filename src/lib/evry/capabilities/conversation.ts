import type {
  EvryPageContext,
  EvryResolvedPageContext,
} from "@/lib/evry/resolvers/contract";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";
import type {
  appendEvryConversationRecord,
  EvryStoredConversation,
} from "@/lib/evry/conversations/repository";

export type EvryCapabilityConversationStore = Readonly<{
  append: typeof appendEvryConversationRecord;
}>;

export type EvryCapabilityConversationContinuation = (input: {
  actor: EvryPlantActor;
  conversation: EvryStoredConversation;
  userRequestKey: string;
  literalUserText: string;
  pageContext: EvryResolvedPageContext | null;
  requestPageContext: EvryPageContext | null;
  now: Date;
  store: EvryCapabilityConversationStore;
}) => Promise<EvryStoredConversation | null>;

/** Select at most one closed capability pack for a durable user turn. */
export function composeEvryCapabilityConversationContinuations(
  continuations: readonly EvryCapabilityConversationContinuation[]
): EvryCapabilityConversationContinuation {
  return async function continueEvryCapabilityConversation(input) {
    for (const continuation of continuations) {
      const continued = await continuation(input);
      if (continued) return continued;
    }
    return null;
  };
}
