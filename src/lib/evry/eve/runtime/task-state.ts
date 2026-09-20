import { defineState } from "eve/context";
import { z } from "zod";
import type { EvryPageContext } from "@/lib/evry/resolvers/contract";

const factSchema = z
  .object({
    key: z.string().min(1).max(100),
    value: z.string().max(4_000),
    source: z.enum(["user", "record", "inferred"]),
  })
  .strict();
const referenceSchema = z
  .object({
    kind: z.string().min(1).max(80),
    id: z.string().min(1).max(160),
    label: z.string().max(240),
  })
  .strict();
export const taskPatchSchema = z
  .object({
    expectedRevision: z.number().int().nonnegative(),
    goal: z.string().max(2_000).optional(),
    facts: z.array(factSchema).max(80).optional(),
    removeFactKeys: z.array(z.string().max(100)).max(80).optional(),
    selectedRecords: z.array(referenceSchema).max(200).optional(),
    pendingQuestion: z.string().max(1_000).nullable().optional(),
  })
  .strict();

export type EvryTaskState = {
  revision: number;
  goal: string;
  facts: z.infer<typeof factSchema>[];
  selectedRecords: z.infer<typeof referenceSchema>[];
  pendingQuestion: string | null;
};

export function emptyTaskState(): EvryTaskState {
  return {
    revision: 0,
    goal: "",
    facts: [],
    selectedRecords: [],
    pendingQuestion: null,
  };
}

/** User/model facts guide planning. They never constitute permission or confirmation. */
export function applyTaskPatch(
  state: EvryTaskState,
  patch: z.infer<typeof taskPatchSchema>
): EvryTaskState {
  if (patch.expectedRevision !== state.revision)
    throw new Error("Task changed. Read the current task before updating it.");
  const facts = new Map(state.facts.map((fact) => [fact.key, fact]));
  for (const key of patch.removeFactKeys ?? []) facts.delete(key);
  for (const fact of patch.facts ?? []) facts.set(fact.key, fact);
  if (facts.size > 80)
    throw new Error("Keep only the current task's relevant facts.");
  return {
    revision: state.revision + 1,
    goal: patch.goal ?? state.goal,
    facts: [...facts.values()],
    selectedRecords: patch.selectedRecords ?? state.selectedRecords,
    pendingQuestion:
      patch.pendingQuestion === undefined
        ? state.pendingQuestion
        : patch.pendingQuestion,
  };
}

export const evryTaskState = defineState<EvryTaskState>(
  "evry.task",
  emptyTaskState
);
export const evryTurnInput = defineState<{
  text: string;
  receivedAt: string;
  pageContext: EvryPageContext | null;
}>("evry.turn-input", () => ({
  text: "",
  receivedAt: "",
  pageContext: null,
}));
