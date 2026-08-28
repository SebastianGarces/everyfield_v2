import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "plant-intelligence",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "prefix", path: "/phase" },
    {
      kind: "action-source",
      match: "prefix",
      source: "src/app/(dashboard)/phase",
    },
  ],
});
