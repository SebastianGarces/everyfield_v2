import { defineState } from "eve/context";
import type { LanguageModelMiddleware } from "ai";
import {
  freshProcessingBudget,
  EVE_PROCESSING_LIMITS,
  processingOutputAllowance,
  reserveProcessingCall,
  type EveProcessingBudget,
} from "./processing-budget-policy";

export const evryProcessingBudget = defineState("evry.processing-budget", () =>
  freshProcessingBudget("")
);

type BudgetStore = {
  get(): EveProcessingBudget;
  update(change: (state: EveProcessingBudget) => EveProcessingBudget): void;
};

/** Guard actual provider calls, including retries and compaction, not UI events. */
export function processingBudgetMiddleware(
  store: BudgetStore
): LanguageModelMiddleware {
  const reserve = () => store.update(reserveProcessingCall);
  const finish = (
    inputTokens: number | undefined,
    outputTokens: number | undefined,
    reservedOutput: number
  ) => {
    store.update((state) => ({
      ...state,
      // Missing input accounting exhausts the turn instead of granting free work.
      inputTokens:
        typeof inputTokens === "number" &&
        Number.isFinite(inputTokens) &&
        inputTokens >= 0
          ? state.inputTokens + inputTokens
          : EVE_PROCESSING_LIMITS.inputTokens,
      outputTokens:
        state.outputTokens +
        (typeof outputTokens === "number" &&
        Number.isFinite(outputTokens) &&
        outputTokens >= 0
          ? outputTokens
          : reservedOutput),
    }));
  };
  return {
    transformParams: async ({ params }) => ({
      ...params,
      maxOutputTokens: Math.min(
        params.maxOutputTokens ?? Infinity,
        processingOutputAllowance(store.get())
      ),
    }),
    wrapGenerate: async ({ doGenerate, params }) => {
      reserve();
      const result = await doGenerate();
      finish(
        result.usage.inputTokens.total,
        result.usage.outputTokens.total,
        params.maxOutputTokens ?? EVE_PROCESSING_LIMITS.outputTokensPerCall
      );
      return result;
    },
    wrapStream: async ({ doStream, params }) => {
      reserve();
      const result = await doStream();
      return {
        ...result,
        stream: result.stream.pipeThrough(
          new TransformStream({
            transform(part, controller) {
              if (part.type === "finish")
                finish(
                  part.usage.inputTokens.total,
                  part.usage.outputTokens.total,
                  params.maxOutputTokens ??
                    EVE_PROCESSING_LIMITS.outputTokensPerCall
                );
              controller.enqueue(part);
            },
          })
        ),
      };
    },
  };
}
