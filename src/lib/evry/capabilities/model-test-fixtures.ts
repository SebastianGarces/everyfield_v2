import { MockLanguageModelV3 } from "ai/test";

export function modelDecision(overrides: Record<string, unknown> = {}) {
  return {
    classification: "application_read",
    response: "How can I help with your work?",
    readId: null,
    readInputJson: null,
    prepareOriginalRequest: false,
    settingsSectionId: null,
    ...overrides,
  };
}

export function scriptedConversationModel(output: unknown) {
  const calls: unknown[] = [];
  const model = new MockLanguageModelV3({
    doGenerate: async (options) => {
      calls.push(options);
      return {
        content: [{ type: "text", text: JSON.stringify(output) }],
        finishReason: { unified: "stop", raw: "stop" },
        usage: {
          inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 5, text: 5, reasoning: 0 },
        },
        warnings: [],
      };
    },
  });
  return { model, calls };
}
