import { defineTool } from "eve/tools";
import { z } from "zod";
import { evryTaskState } from "../../src/lib/evry/eve/runtime/task-state";

export default defineTool({
  description:
    "Read the current task goal, remembered constraints, selected records and pending question. These are planning notes, not approvals or current database evidence.",
  inputSchema: z.object({}).strict(),
  execute: () => evryTaskState.get(),
});
