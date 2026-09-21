import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { withLiveReviewBudget } from "./evry-eve-live-budget";

test("live review ledger settles usage, retains failures, and prevents concurrent or repeated overspending", async () => {
  const directory = await mkdtemp(join(tmpdir(), "evry-review-budget-"));
  const path = join(directory, "ledger.json");
  try {
    await writeFile(path, JSON.stringify({ approvedUsd: 1, allocations: [] }));
    assert.equal(
      await withLiveReviewBudget(path, 0.6, async () => {
        await assert.rejects(
          withLiveReviewBudget(path, 0.6, async () => ({
            result: null,
            costUsd: 0,
          })),
          /EEXIST/
        );
        return { result: "done", costUsd: 0.2 };
      }),
      "done"
    );
    await assert.rejects(
      withLiveReviewBudget(path, 0.6, async () => {
        throw new Error("interrupted");
      }),
      /interrupted/
    );
    let dispatched = false;
    await assert.rejects(
      withLiveReviewBudget(path, 0.3, async () => {
        dispatched = true;
        return { result: null, costUsd: 0 };
      }),
      /remaining approved total/
    );
    assert.equal(dispatched, false);
    const saved = JSON.parse(await readFile(path, "utf8"));
    assert.deepEqual(
      saved.allocations.map(
        (entry: { settledUsd: number | null }) => entry.settledUsd
      ),
      [0.2, null]
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
