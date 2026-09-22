import { defineTool } from "eve/tools";
import { authenticatedSessionOf } from "../../src/lib/evry/eve/runtime/auth-policy";
import { describeEveRuntimeTools } from "../../src/lib/evry/eve/runtime/registry";
import {
  evryLoadedTools,
  evryLoadedPreparations,
  resolveToolLoad,
  toolLoadSchema,
} from "../../src/lib/evry/eve/runtime/tool-selection";
import {
  evePreparations,
  selectedEvePreparationSchema,
} from "../../src/lib/evry/eve/preparation";

export default defineTool({
  description:
    "Load missing capability definitions by adding them to the current working set. Tools already listed with full schemas can be called directly, including through code_mode; do not reload them just to select a smaller subset. Select up to eight canonical names from the catalog. The combined working set may contain at most eight tools and three exact preparationOperations. An over-limit addition leaves the current set unchanged. Use mode: replace when the next work needs different tools and supply the complete desired set, without losing results or task notes. An empty names list unloads it. For actions.prepare, also select up to three preparationOperations from the operation catalog; omit that selection to list available operations without adding preparation schemas or removing already loaded ones.",
  inputSchema: toolLoadSchema,
  execute(request, ctx) {
    const result = resolveToolLoad(
      {
        names: evryLoadedTools.get(),
        preparationOperations: evryLoadedPreparations.get(),
      },
      request,
      describeEveRuntimeTools(authenticatedSessionOf(ctx.session.auth.current)),
      evePreparations.map((entry) => entry.id)
    );
    if (result.status === "rejected") return result;
    if (result.preparationOperations.length)
      selectedEvePreparationSchema(result.preparationOperations);
    evryLoadedTools.update(() => result.loaded);
    evryLoadedPreparations.update(() => result.preparationOperations);
    return result;
  },
});
