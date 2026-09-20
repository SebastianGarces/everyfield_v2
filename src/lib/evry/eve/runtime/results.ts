import { defineState } from "eve/context";
import type { EveJsonValue } from "../capabilities/registry";

type ResultRecord = {
  reference: string;
  turnId: string;
  capability: string;
  artifact: EveJsonValue;
};
export const evryResultState = defineState<ResultRecord[]>(
  "evry.authorized-results",
  () => []
);

/** Only the authenticated registry wrapper writes this state; model task notes cannot. */
export function collectResult(
  records: ResultRecord[],
  entry: Omit<ResultRecord, "artifact">,
  result: EveJsonValue
): ResultRecord[] {
  if (
    !result ||
    typeof result !== "object" ||
    Array.isArray(result) ||
    (result.kind !== "read" && result.kind !== "clarification")
  )
    return records;
  const next = [
    ...records.filter(
      (item) =>
        item.turnId === entry.turnId && item.reference !== entry.reference
    ),
    { ...entry, artifact: result },
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
