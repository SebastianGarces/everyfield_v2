/** Per-turn limits bound tool planning; they do not stand in for bulk queries. */
export const EVRY_READ_BUDGET = {
  calls: 8,
  rows: 200,
  evidenceCharacters: 100_000,
  durationMs: 90_000,
} as const;

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, child]) => [key, canonical(child)])
    );
  return value;
}

export function createEvryReadBudget(clock: () => number = Date.now) {
  const started = clock();
  const calls = new Set<string>();
  let rows = 0;
  let characters = 0;
  const remaining = () => ({
    calls: Math.max(0, EVRY_READ_BUDGET.calls - calls.size),
    rows: Math.max(0, EVRY_READ_BUDGET.rows - rows),
    evidenceCharacters: Math.max(
      0,
      EVRY_READ_BUDGET.evidenceCharacters - characters
    ),
    durationMs: Math.max(0, EVRY_READ_BUDGET.durationMs - (clock() - started)),
  });
  const exhausted = () =>
    Object.values(remaining()).some((value) => value <= 0);
  return {
    remaining,
    exhausted,
    claim(id: string, input: unknown) {
      const key = JSON.stringify([id, canonical(input)]);
      if (exhausted() || calls.has(key)) return false;
      calls.add(key);
      return true;
    },
    record(resultRows: number, evidence: unknown) {
      rows += resultRows;
      characters += JSON.stringify(evidence).length;
    },
  };
}
