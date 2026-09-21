import { defineTool } from "eve/tools";
import { z } from "zod";
import { evryTaskState } from "../../src/lib/evry/eve/runtime/task-state";

export default defineTool({
  description:
    "Read task notes when absent from the turn context or after a revision conflict. Current notes and revision are normally supplied at the start of each turn. These are planning notes, not approvals or current database evidence.",
  inputSchema: z.object({}).strict(),
  execute: () => evryTaskState.get(),
});
