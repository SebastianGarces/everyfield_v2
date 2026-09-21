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

export const evryLoadedTools = defineState<string[]>(
  "evry.loaded-tools",
  () => []
);

export const evryLoadedPreparations = defineState<string[]>(
  "evry.loaded-preparations",
  () => []
);

export function selectRuntimeTools(
  names: readonly string[],
  catalog: readonly { name: string }[]
) {
  const known = new Set(catalog.map((entry) => entry.name));
  const unknown = names.filter((name) => !known.has(name));
  if (unknown.length)
    throw new Error(
      `Unknown tools: ${unknown.join(", ")}. Use names from the catalog.`
    );
  return [...new Set(names)];
}
