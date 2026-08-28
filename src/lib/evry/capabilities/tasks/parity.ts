import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "tasks",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "prefix", path: "/tasks" },
    ...[
      "src/app/(dashboard)/tasks/actions.ts",
      "src/app/(dashboard)/tasks/follow-up-actions.ts",
      "src/app/(dashboard)/tasks/phase-prompt-actions.ts",
    ].map((source) => ({
      kind: "action-source" as const,
      match: "exact" as const,
      source,
    })),
  ],
});
