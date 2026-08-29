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
    id: "people-add",
    module: "people",
    requiredCapability: "people.write",
    request: "Add a person to the pipeline",
    fallback: false,
  },
  {
    id: "meetings-schedule",
    module: "meetings",
    requiredCapability: "meetings.write",
    request: "Schedule a vision meeting",
    fallback: true,
  },
  {
    id: "tasks-overdue",
    module: "tasks",
    requiredCapability: "read",
    request: "Show me my overdue tasks",
    fallback: true,
  },
  {
    id: "tasks-complete-own",
    module: "tasks",
    requiredCapability: "tasks.own",
    request: "Complete one of my assigned tasks",
    fallback: false,
  },
  {
    id: "tasks-create",
    module: "tasks",
    requiredCapability: "tasks.write",
    request: "Create a follow-up task",
    fallback: false,
  },
  {
    id: "launch-milestones",
    module: "launch",
    requiredCapability: "launch.milestone",
    request: "Review my launch milestones",
    fallback: true,
  },
  {
    id: "launch-date",
    module: "launch",
    requiredCapability: "launch.schedule",
    request: "Update the launch date",
    fallback: false,
  },
] as const satisfies readonly EvrySuggestionDefinition[];
