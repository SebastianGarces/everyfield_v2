import { defineEvryParityCapabilities } from "../contract";

export const PARITY_CAPABILITIES = defineEvryParityCapabilities({
  id: "teams",
  classification: { state: "supported" },
  selectors: [
    { kind: "route", match: "exact", path: "/teams" },
    { kind: "route", match: "exact", path: "/teams/[teamId]" },
    {
      kind: "route",
      match: "exact",
      path: "/teams/[teamId]/responsibilities",
    },
    { kind: "route", match: "exact", path: "/teams/[teamId]/training" },
    { kind: "route", match: "exact", path: "/teams/health" },
    { kind: "route", match: "exact", path: "/teams/org-chart" },
    {
      kind: "action-source",
      match: "exact",
      source: "src/app/(dashboard)/teams/actions.ts",
    },
  ],
});
