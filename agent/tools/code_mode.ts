import { defineState } from "eve/context";
import { defineTool } from "eve/tools";
import { z } from "zod";
import { runEvryComposition } from "../../src/lib/evry/eve/composition/runner";
import { createBoundEveRegistry } from "../../src/lib/evry/eve/runtime/registry";
import { withEveRuntimeScope } from "../../src/lib/evry/eve/runtime/scope";

const budgetState = defineState("evry.composition-budget", () => ({
  turnId: "",
  used: 0,
}));
export default defineTool({
  description:
    "Compose authorized reads and preparation in isolated JavaScript. Call await tools[canonicalName](input), for example await tools['people.query']({}). Return your result. No filesystem, imports, network, secrets, execution, or confirmation. Read the capability schemas from the direct tools; dotted canonical names appear in their descriptions. Results include resultReference for present_result.",
  inputSchema: z.object({ js: z.string().min(1).max(32_768) }).strict(),
  execute: ({ js }, ctx) =>
    withEveRuntimeScope(ctx, async (scope) => {
      const budget = {
        consume() {
          budgetState.update((state) => {
            const used = state.turnId === scope.turnId ? state.used : 0;
            if (used >= 48)
              throw new Error("Composition turn budget exhausted");
            return { turnId: scope.turnId, used: used + 1 };
          });
        },
        get used() {
          const state = budgetState.get();
          return state.turnId === scope.turnId ? state.used : 0;
        },
      };
      return runEvryComposition({
        js,
        registry: createBoundEveRegistry(scope),
        callId: ctx.callId,
        budget,
        signal: ctx.abortSignal,
      });
    }),
});
