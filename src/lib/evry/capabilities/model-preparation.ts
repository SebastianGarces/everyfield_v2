import { z } from "zod";
import type {
  EvryCapabilityConversationResult,
  EvryCapabilityConversationSelectionInput,
} from "./conversation";

/** Preparation only. Executing a plan is deliberately absent from this contract. */
export type EvryModelPreparation = Readonly<{
  id: string;
  capabilityIdentities: readonly string[];
  inputSchema: z.ZodType;
  run(
    selection: EvryCapabilityConversationSelectionInput,
    argumentsValue: unknown
  ): Promise<EvryCapabilityConversationResult | null>;
}>;

export function defineEvryModelPreparation<S extends z.ZodType>(entry: {
  id: string;
  capabilityIdentities: readonly string[];
  inputSchema: S;
  run(
    selection: EvryCapabilityConversationSelectionInput,
    argumentsValue: z.output<S>
  ): Promise<EvryCapabilityConversationResult | null>;
}): EvryModelPreparation {
  return {
    ...entry,
    run(selection, value) {
      return entry.run(selection, entry.inputSchema.parse(value));
    },
  };
}
