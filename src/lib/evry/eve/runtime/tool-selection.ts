import { defineState } from "eve/context";
import { z } from "zod";

// A working set, not a capability restriction: the agent may replace it each step.
export const toolSelectionSchema = z
  .object({
    names: z.array(z.string().min(1).max(160)).max(8),
    preparationOperations: z
      .array(z.string().min(1).max(160))
      .max(3)
      .default([]),
  })
  .strict();

/** Loading is incremental; replacement is a deliberate command, not saved state. */
export const toolLoadSchema = toolSelectionSchema.extend({
  mode: z.enum(["add", "replace"]).default("add"),
});

type ToolSelection = z.infer<typeof toolSelectionSchema>;

export function resolveToolLoad(
  current: ToolSelection,
  request: z.infer<typeof toolLoadSchema>,
  catalog: readonly { name: string }[],
  preparationIds: readonly string[]
) {
  const known = new Set(catalog.map(({ name }) => name));
  const operations = new Set(preparationIds);
  const reject = (
    reason: "unknown_tool" | "unknown_preparation" | "working_set_limit"
  ) => ({ status: "rejected" as const, reason, current, requested: request });
  if (request.names.some((name) => !known.has(name)))
    return reject("unknown_tool");
  if (request.preparationOperations.some((name) => !operations.has(name)))
    return reject("unknown_preparation");

  // Empty names retains the existing explicit unload contract.
  const base =
    request.mode === "add" && request.names.length
      ? current
      : { names: [], preparationOperations: [] };
  const selected = [...new Set([...base.names, ...request.names])];
  const preparations = selected.includes("actions.prepare")
    ? [
        ...new Set([
          ...base.preparationOperations,
          ...(request.names.includes("actions.prepare")
            ? request.preparationOperations
            : []),
        ]),
      ]
    : [];
  const loaded = selected.filter(
    (name) => name !== "actions.prepare" || preparations.length > 0
  );
  if (
    !toolSelectionSchema.safeParse({
      names: loaded,
      preparationOperations: preparations,
    }).success
  )
    return reject("working_set_limit");
  return {
    status: "loaded" as const,
    loaded,
    preparationOperations: preparations,
    ...(request.names.includes("actions.prepare") &&
    !request.preparationOperations.length
      ? { availablePreparationOperations: [...preparationIds] }
      : {}),
  };
}

export const evryLoadedTools = defineState<string[]>(
  "evry.loaded-tools",
  () => []
);

export const evryLoadedPreparations = defineState<string[]>(
  "evry.loaded-preparations",
  () => []
);
