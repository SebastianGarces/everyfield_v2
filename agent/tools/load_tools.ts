import { defineTool } from "eve/tools";
import { authenticatedSessionOf } from "../../src/lib/evry/eve/runtime/auth-policy";
import { describeEveRuntimeTools } from "../../src/lib/evry/eve/runtime/registry";
import {
  evryLoadedTools,
  evryLoadedPreparations,
  selectRuntimeTools,
  toolSelectionSchema,
} from "../../src/lib/evry/eve/runtime/tool-selection";
import {
  evePreparations,
  selectedEvePreparationSchema,
} from "../../src/lib/evry/eve/preparation";

export default defineTool({
  description:
    "Load full definitions before calling tools or composing code. Select up to eight canonical names from the catalog. For actions.prepare, also select up to three preparationOperations from the operation catalog; omit that selection to list available operations without loading their schemas. Replaces the previous working set without losing results or task notes. An empty names list unloads it.",
  inputSchema: toolSelectionSchema,
  execute({ names, preparationOperations }, ctx) {
    const selected = selectRuntimeTools(
      names,
      describeEveRuntimeTools(authenticatedSessionOf(ctx.session.auth.current))
    );
    const operations = selected.includes("actions.prepare")
      ? [...new Set(preparationOperations)]
      : [];
    if (operations.length) selectedEvePreparationSchema(operations);
    const loaded = selected.filter(
      (name) => name !== "actions.prepare" || operations.length
    );
    evryLoadedTools.update(() => loaded);
    evryLoadedPreparations.update(() => operations);
    return {
      loaded,
      preparationOperations: operations,
      ...(selected.includes("actions.prepare") && !operations.length
        ? {
            availablePreparationOperations: evePreparations.map(
              (entry) => entry.id
            ),
          }
        : {}),
    };
  },
});
