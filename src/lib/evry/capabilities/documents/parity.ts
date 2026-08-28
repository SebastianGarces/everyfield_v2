import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "documents-and-files",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "prefix", path: "/documents" },
    ...[
      "src/app/(dashboard)/documents/actions.ts",
      "src/app/(dashboard)/people/import-export-actions.ts",
    ].map((source) => ({
      kind: "action-source" as const,
      match: "exact" as const,
      source,
    })),
  ],
});
