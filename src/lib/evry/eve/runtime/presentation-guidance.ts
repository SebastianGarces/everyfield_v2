import type { LanguageModelMiddleware } from "ai";
import type { evryResultState } from "./results";

type PresentationState = {
  turnId: string | null;
  results: readonly Pick<
    ReturnType<typeof evryResultState.get>[number],
    "turnId" | "reference" | "capability"
  >[];
};

export function currentPresentationGuidance(state: PresentationState): string {
  const references = state.results
    .filter(
      (result) =>
        state.turnId !== null &&
        result.turnId === state.turnId &&
        result.capability !== "actions.prepare"
    )
    .map((result) => result.reference);
  return `Current optional result-card references: ${JSON.stringify(references)}. Use only these references in result markers, never references from earlier turns or summaries. Choose cards only when helpful. If this list is empty, answer from retained evidence in text when sufficient; retrieve again only when current evidence is needed. Preparation reviews appear automatically.`;
}

/** Refresh presentation guidance at each provider call without rewriting history. */
export function presentationGuidanceMiddleware(
  readState: () => PresentationState
): LanguageModelMiddleware {
  return {
    transformParams: async ({ params }) => ({
      ...params,
      prompt: [
        { role: "system", content: currentPresentationGuidance(readState()) },
        ...params.prompt,
      ],
    }),
  };
}
