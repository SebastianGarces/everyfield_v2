import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "dashboard",
  classification: { state: "supported" },
  selectors: [{ kind: "route", match: "exact", path: "/dashboard" }],
});
