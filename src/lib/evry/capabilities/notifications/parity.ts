import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "notifications",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "prefix", path: "/notifications" },
    {
      kind: "action-source",
      match: "exact",
      source: "src/app/(dashboard)/notifications/actions.ts",
    },
  ],
});
