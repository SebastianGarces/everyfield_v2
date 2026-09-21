import { defineTool } from "eve/tools";
import {
  applyTaskPatch,
  evryTaskState,
  taskPatchSchema,
} from "../../src/lib/evry/eve/runtime/task-state";

export default defineTool({
  description:
    "Save task constraints before a clarification, preparation, or long investigation, using the revision supplied in the turn context or last update. Group known choices in one update rather than saving each lookup separately. Facts merge by key, preserving prior choices unless deliberately changed. Cannot approve or execute anything.",
  inputSchema: taskPatchSchema,
  execute(input) {
    evryTaskState.update((state) => applyTaskPatch(state, input));
    return evryTaskState.get();
  },
});
