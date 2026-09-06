import type { EvrySuggestionDefinition } from "./types";

/**
 * Ordinary request copy, paired with the application capability it may imply.
 *
 * This catalog is not authority. The server filters it through the generated
 * parity inventory and the actor's held capabilities before any entry reaches
 * the browser; the action endpoint remains the final authorization boundary.
 */
export const EVRY_SUGGESTION_CATALOG = [
  {
    id: "people-follow-up",
    module: "people",
    requiredCapability: "read",
    request: "Show me who needs follow-up",
    fallback: true,
  },
  {
    id: "meetings-list",
    module: "meetings",
    requiredCapability: "read",
    request: "Show me meetings",
    fallback: true,
  },
  {
    id: "tasks-list",
    module: "tasks",
    requiredCapability: "read",
    request: "Show me my tasks",
    fallback: true,
  },
  {
    id: "launch-milestones",
    module: "launch",
    requiredCapability: "launch.milestone",
    request: "Show launch milestones",
    fallback: true,
  },
] as const satisfies readonly EvrySuggestionDefinition[];
