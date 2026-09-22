import type { ModelMessage } from "ai";
import { z } from "zod";
import { EVE_WORKFLOW_COVERAGE } from "../capabilities/catalog";
import { toolSelectionSchema } from "./tool-selection";

/** Completed native skill loads bring their bounded authored working set into the next step. */
export function latestWorkingSetLoad(
  messages: readonly ModelMessage[],
  catalog: readonly { name: string }[],
  priorCallIds: readonly string[] = []
): {
  callId: string;
  selection: z.infer<typeof toolSelectionSchema> | null;
} | null {
  const calls = new Map<string, { name: string; skill?: string }>();
  let selected: {
    callId: string;
    selection: z.infer<typeof toolSelectionSchema> | null;
  } | null = null;
  const allowed = new Set(catalog.map((entry) => entry.name));
  const prior = new Set(priorCallIds);
  for (const message of messages) {
    if (message.role === "assistant") {
      if (!Array.isArray(message.content)) continue;
      for (const part of message.content) {
        if (part.type !== "tool-call" || prior.has(part.toolCallId)) continue;
        if (part.toolName === "load_tools")
          calls.set(part.toolCallId, { name: part.toolName });
        if (part.toolName === "load_skill") {
          const input = z.object({ skill: z.string() }).safeParse(part.input);
          if (input.success)
            calls.set(part.toolCallId, {
              name: part.toolName,
              skill: input.data.skill,
            });
        }
      }
    }
    if (message.role !== "tool") continue;
    for (const part of message.content) {
      if (part.type !== "tool-result") continue;
      const call = calls.get(part.toolCallId);
      if (!call || call.name !== part.toolName) continue;
      if (
        call.name === "load_tools" &&
        part.output.type === "json" &&
        z
          .object({
            status: z.literal("loaded").optional(),
            loaded: z.array(z.string()).max(8),
          })
          .safeParse(part.output.value).success
      ) {
        selected = { callId: part.toolCallId, selection: null }; // The successful loader owns its persisted working set.
      }
      if (
        call.name !== "load_skill" ||
        !["text", "json"].includes(part.output.type) ||
        !("value" in part.output) ||
        typeof part.output.value !== "string" ||
        !part.output.value.trim()
      )
        continue;
      const workflow = EVE_WORKFLOW_COVERAGE.find(
        (entry) => entry.name === call.skill
      );
      if (workflow) {
        const preparationOperations =
          allowed.has("actions.prepare") && "preparationOperations" in workflow
            ? [...workflow.preparationOperations]
            : [];
        selected = {
          callId: part.toolCallId,
          selection: toolSelectionSchema.parse({
            names: workflow.tools.filter(
              (name) =>
                allowed.has(name) &&
                (name !== "actions.prepare" || preparationOperations.length > 0)
            ),
            preparationOperations,
          }),
        };
      }
    }
  }
  return selected;
}
