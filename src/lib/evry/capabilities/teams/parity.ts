import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "teams",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "prefix", path: "/teams" },
    {
      kind: "action-source",
      match: "exact",
      source: "src/app/(dashboard)/teams/actions.ts",
    },
  ],
});
