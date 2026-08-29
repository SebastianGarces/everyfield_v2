import type { PublicEvryConversation } from "../client-contract";
import type { EligibleEvrySuggestion } from "./types";

export function populateComposerFromSuggestion(
  suggestion: EligibleEvrySuggestion,
  setDraft: (request: string) => void,
  focusComposer: () => void
) {
  setDraft(suggestion.request);
  focusComposer();
}

export function shouldOfferEvrySuggestions(
  conversation: PublicEvryConversation | null
): boolean {
  const lastMessage = conversation?.messages.at(-1);
  return (
    !lastMessage ||
    (lastMessage.author === "assistant" &&
      lastMessage.deliveryStatus === "complete")
  );
}
