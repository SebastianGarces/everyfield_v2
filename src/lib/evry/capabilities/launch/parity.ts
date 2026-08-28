import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "launch",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "prefix", path: "/launch" },
    {
      kind: "action-source",
      match: "exact",
      source: "src/app/(dashboard)/launch/actions.ts",
    },
  ],
});
