import type { EvryCapabilityConversationContinuation } from "./conversation";

export const EVRY_HELP_REQUESTS = [
  "What can you do for me?",
  "What can you do?",
  "How can you help me?",
  "How can you help?",
  "What can I ask you?",
  "What can you help me with?",
  "What can you help with?",
  "What do you do?",
  "Help",
  "Hello",
  "Hi",
] as const;

function normalizeRequest(text: string) {
  return text
    .trim()
    .toLowerCase()
    .replace(/[?.!]+$/u, "")
    .replace(/\s+/gu, " ");
}

const helpRequests = new Set(EVRY_HELP_REQUESTS.map(normalizeRequest));

/** Product help is a conversation, not a plan or a data lookup. */
export const continueEvryHelpConversation: EvryCapabilityConversationContinuation =
  {
    identity: "evry.help",
    referencePolicy: "self_contained",
    matches: ({ literalUserText }) =>
      helpRequests.has(normalizeRequest(literalUserText)),
    async continue() {
      return {
        body: "I can help you find people who need follow-up, check tasks, and look up meetings. I can also prepare changes such as creating a meeting and sending invitations, depending on your permissions.\n\nI’ll show you a review before making changes or sending anything. What would you like to work on?",
        artifacts: [],
      };
    },
  };
