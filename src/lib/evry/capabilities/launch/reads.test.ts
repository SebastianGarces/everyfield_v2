import assert from "node:assert/strict";
import test from "node:test";

import {
  paginateLaunchJournalRows,
  selectLaunchEvryRead,
  type LaunchJournalPageRow,
} from "./reads";

function row(index: number): LaunchJournalPageRow {
  return {
    id: `entry-${index}`,
    key: `journal:entry-${String(index).padStart(3, "0")}`,
    label: `Exact history ${index} 🧪`,
    at: new Date(
      `2030-01-01T00:${String(index % 60).padStart(2, "0")}:00.000Z`
    ),
    facts: [{ label: "Exact text", value: `literal-${index}` }],
  };
}

test("journal cursors retrieve every older row without a gap or duplicate", () => {
  const source = Array.from({ length: 205 }, (_, index) => row(index));
  const seen: string[] = [];
  let cursor: string | null = null;
  do {
    const page = paginateLaunchJournalRows(source, 37, cursor);
    assert.equal(page.status, "available");
    if (page.status !== "available") break;
    seen.push(...page.rows.map(({ key }) => key));
    cursor = page.nextCursor;
    if (cursor) {
      assert.deepEqual(
        selectLaunchEvryRead(`show launch history after ${cursor}`),
        {
          readId: "launch.journal",
          input: { limit: 100, cursor },
        }
      );
    }
  } while (cursor);
  assert.equal(seen.length, source.length);
  assert.equal(new Set(seen).size, source.length);
  assert.deepEqual(new Set(seen), new Set(source.map(({ key }) => key)));
});

test("journal pagination fails closed on forged or stale cursors", () => {
  assert.equal(
    paginateLaunchJournalRows([row(1)], 100, "not-a-real-cursor").status,
    "invalid_cursor"
  );
  const first = paginateLaunchJournalRows([row(1), row(2)], 1, null);
  assert.equal(first.status, "available");
  assert.ok(first.status === "available" && first.nextCursor);
  assert.equal(
    paginateLaunchJournalRows([row(1)], 1, first.nextCursor).status,
    "missing_cursor"
  );
});
