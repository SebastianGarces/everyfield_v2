function record(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}

export type PendingPeopleFileSubmission = Readonly<{
  semanticKey: string;
  requestKey: string;
}>;

export function pendingPeopleFileSubmissionFor(
  current: PendingPeopleFileSubmission | null,
  semanticKey: string,
  mintRequestKey: () => string
): PendingPeopleFileSubmission {
  return current?.semanticKey === semanticKey
    ? current
    : { semanticKey, requestKey: mintRequestKey() };
}

/** Read duplicate row keys only from the typed, network-delivered preview. */
export function duplicateRowNumbersFromPeopleStage(
  value: unknown
): readonly number[] {
  const staged = record(value);
  const artifact = record(staged?.artifact);
  if (staged?.status !== "staged" || artifact?.kind !== "read") return [];
  if (!Array.isArray(artifact.items)) return [];

  const rows = new Set<number>();
  for (const itemValue of artifact.items) {
    const item = record(itemValue);
    const match =
      typeof item?.id === "string" ? /^csv-row-(\d+)$/.exec(item.id) : null;
    if (!match || !Array.isArray(item?.facts)) continue;
    const isDuplicate = item.facts.some((factValue) => {
      const fact = record(factValue);
      return fact?.label === "Status" && fact.value === "Duplicate review";
    });
    const rowNumber = Number(match[1]);
    if (isDuplicate && Number.isSafeInteger(rowNumber) && rowNumber > 0) {
      rows.add(rowNumber);
    }
  }
  return [...rows].sort((left, right) => left - right);
}
