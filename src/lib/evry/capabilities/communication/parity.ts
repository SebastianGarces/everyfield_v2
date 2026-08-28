import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "communication",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "prefix", path: "/communication" },
    {
      kind: "action-source",
      match: "exact",
      source: "src/app/(dashboard)/communication/actions.ts",
    },
  ],
});
