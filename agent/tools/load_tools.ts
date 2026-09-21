import { defineTool } from "eve/tools";
import { authenticatedSessionOf } from "../../src/lib/evry/eve/runtime/auth-policy";
import { describeEveRuntimeTools } from "../../src/lib/evry/eve/runtime/registry";
import {
  evryLoadedTools,
  selectRuntimeTools,
  toolSelectionSchema,
} from "../../src/lib/evry/eve/runtime/tool-selection";

export default defineTool({
  description:
    "Load full definitions before calling tools or composing code. Select up to eight canonical names from the catalog in your instructions. This replaces the previous working set, without losing results or task notes. You can load other tools later; an empty list unloads the working set.",
  inputSchema: toolSelectionSchema,
  execute({ names }, ctx) {
    const selected = selectRuntimeTools(
      names,
      describeEveRuntimeTools(authenticatedSessionOf(ctx.session.auth.current))
    );
    evryLoadedTools.update(() => selected);
    return { loaded: selected };
  },
});
