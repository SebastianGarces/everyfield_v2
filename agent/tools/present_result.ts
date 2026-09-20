import { defineTool } from "eve/tools";
import { z } from "zod";
import {
  evryResultState,
  findResult,
} from "../../src/lib/evry/eve/runtime/results";
import { withEveRuntimeScope } from "../../src/lib/evry/eve/runtime/scope";
import { fixtureRun } from "../../src/lib/evry/eve/runtime/fixture-bridge";

export default defineTool({
  description:
    "Show a result card where it helps the user. Use resultReference from a read in this turn. Explain the main finding in natural text before or after the card. Do not show a card for every lookup; an answer may be text only.",
  inputSchema: z.object({ reference: z.string().min(1).max(240) }).strict(),
  execute: ({ reference }, ctx) =>
    withEveRuntimeScope(ctx, async (scope) => {
      const result = findResult(evryResultState.get(), reference, scope.turnId);
      if (result)
        fixtureRun({
          ...scope.actor,
          appSessionId: scope.appSessionId,
        })?.present(reference);
      return result
        ? { status: "presented", artifacts: result.artifacts }
        : { status: "unavailable", artifacts: [] };
    }),
  toModelOutput: (result) => ({
    type: "json",
    value: { status: result.status },
  }),
});
