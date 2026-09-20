import { defineTool } from "eve/tools";
import {
  applyTaskPatch,
  evryTaskState,
  taskPatchSchema,
} from "../../src/lib/evry/eve/runtime/task-state";

export default defineTool({
  description:
    "Remember task constraints before asking a question or preparing a review. Facts merge by key, preserving prior date, time, audience and message choices unless deliberately changed. Cannot approve or execute anything.",
  inputSchema: taskPatchSchema,
  execute(input) {
    evryTaskState.update((state) => applyTaskPatch(state, input));
    return evryTaskState.get();
  },
});
