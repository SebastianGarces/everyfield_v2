import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "meetings",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "prefix", path: "/meetings" },
    {
      kind: "action-source",
      match: "exact",
      source: "src/app/(dashboard)/meetings/actions.ts",
    },
  ],
});
