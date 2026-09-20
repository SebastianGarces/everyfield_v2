import { defineState } from "eve/context";
import type { EveJsonValue } from "../capabilities/registry";

type ResultRecord = {
  reference: string;
  turnId: string;
  capability: string;
  artifacts: EveJsonValue[];
};
export const evryResultState = defineState<ResultRecord[]>(
  "evry.authorized-results",
  () => []
);

/** Only the authenticated registry wrapper writes this state; model task notes cannot. */
export function collectResult(
  records: ResultRecord[],
  entry: Omit<ResultRecord, "artifacts">,
  result: EveJsonValue
): ResultRecord[] {
  if (!result || typeof result !== "object" || Array.isArray(result))
    return records;
  const artifacts =
    result.kind === "read" || result.kind === "clarification"
      ? [result]
      : entry.capability === "actions.prepare" &&
          Array.isArray(result.artifacts)
        ? result.artifacts
        : [];
  if (artifacts.length === 0) return records;
  const next = [
    ...records.filter(
      (item) =>
        item.turnId === entry.turnId && item.reference !== entry.reference
    ),
    { ...entry, artifacts },
  ].slice(-24);
  while (JSON.stringify(next).length > 1_000_000) next.shift();
  return next;
}

export function findResult(
  records: ResultRecord[],
  reference: string,
  turnId: string
): ResultRecord | undefined {
  return records.find(
    (item) => item.reference === reference && item.turnId === turnId
  );
}
