import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "wiki",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "prefix", path: "/wiki" },
    ...[
      "src/app/(dashboard)/wiki/actions.ts",
      "src/lib/wiki/bookmarks.ts",
      "src/lib/wiki/progress.ts",
    ].map((source) => ({
      kind: "action-source" as const,
      match: "exact" as const,
      source,
    })),
  ],
});
