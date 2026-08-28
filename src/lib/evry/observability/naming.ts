import type { EvryTraceSpan } from "./contract";

/** Closed cost/grouping name shared by emission and read-only reporting. */
export function evryObservationName(span: EvryTraceSpan): string {
  if (span.details.kind === "generation") {
    const grouping = span.details.grouping;
    if (grouping.kind === "request-policy") {
      return "evry.policy.request-policy";
    }
    return grouping.kind === "selected-recipe"
      ? `evry.${span.stage}.${grouping.recipeIdentity}`
      : `evry.${span.stage}.${grouping.capabilityIdentity}`;
  }

  return span.capabilityIdentity
    ? `evry.${span.stage}.${span.capabilityIdentity}`
    : `evry.${span.stage}`;
}
