import { defineHook } from "eve/hooks";
import { evryProcessingBudget } from "../../src/lib/evry/eve/runtime/processing-budget";
import {
  assertProcessingAllowance,
  beginProcessingTurn,
} from "../../src/lib/evry/eve/runtime/processing-budget-policy";

export default defineHook({
  events: {
    "step.started": () => {
      // Eve wraps boundary-hook failures as recoverable turn failures, before compaction.
      assertProcessingAllowance(evryProcessingBudget.get());
    },
    "turn.started": (event) => {
      evryProcessingBudget.update((state) =>
        beginProcessingTurn(state, event.data.turnId)
      );
    },
  },
});
