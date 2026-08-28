import type { EvryTraceSpan } from "./contract";

/** Closed cost/grouping name shared by emission and read-only reporting. */
export function evryObservationName(span: EvryTraceSpan): string {
  if (span.details.kind === "generation") {
    const grouping = span.details.grouping;
    return grouping.kind === "request-policy"
      ? "evry.policy.request-policy"
      : `evry.${span.stage}.${grouping.capabilityIdentity}`;
  }

  return span.capabilityIdentity
    ? `evry.${span.stage}.${span.capabilityIdentity}`
    : `evry.${span.stage}`;
}
