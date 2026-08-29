import type { Capability } from "@/lib/auth/seat-rules";

export const EVRY_SUGGESTION_MODULES = [
  "people",
  "meetings",
  "tasks",
  "launch",
] as const;

export type EvrySuggestionModule = (typeof EVRY_SUGGESTION_MODULES)[number];

export type EvrySuggestionDefinition = Readonly<{
  id: string;
  module: EvrySuggestionModule;
  requiredCapability: Capability;
  request: string;
  fallback: boolean;
}>;

/** The deliberately small, serializable shape carried across the RSC boundary. */
export type EligibleEvrySuggestion = Pick<
  EvrySuggestionDefinition,
  "id" | "module" | "request" | "fallback"
>;
