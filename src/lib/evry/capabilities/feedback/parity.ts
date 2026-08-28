import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "product-feedback",
  classification: { state: "supported" },
  selectors: [
    {
      kind: "action-source",
      match: "exact",
      source: "src/app/(dashboard)/feedback/actions.ts",
    },
  ],
});
