import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "people",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "prefix", path: "/people" },
    ...[
      "src/app/(dashboard)/people/actions.ts",
      "src/app/(dashboard)/people/activity-actions.ts",
      "src/app/(dashboard)/people/assessment-actions.ts",
      "src/app/(dashboard)/people/household-actions.ts",
      "src/app/(dashboard)/people/pipeline-actions.ts",
      "src/app/(dashboard)/people/skill-actions.ts",
      "src/app/(dashboard)/people/tag-actions.ts",
    ].map((source) => ({
      kind: "action-source" as const,
      match: "exact" as const,
      source,
    })),
  ],
});
