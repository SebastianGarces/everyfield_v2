import assert from "node:assert/strict";
import { test } from "node:test";
import { selectRuntimeTools, toolSelectionSchema } from "./tool-selection";

test("the tool working set can switch modules without excluding any catalog capability", () => {
  const catalog = ["people.query", "tasks.query", "actions.prepare"].map(
    (name) => ({ name })
  );
  for (const { name } of catalog)
    assert.deepEqual(selectRuntimeTools([name], catalog), [name]);
  assert.deepEqual(selectRuntimeTools([], catalog), []);
  assert.deepEqual(
    selectRuntimeTools(["people.query", "people.query"], catalog),
    ["people.query"]
  );
  assert.throws(
    () => selectRuntimeTools(["arbitrary.execute"], catalog),
    /Unknown tools/
  );
  assert.equal(
    toolSelectionSchema.safeParse({ names: Array(9).fill("people.query") })
      .success,
    false
  );
});
