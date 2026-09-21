import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { test } from "node:test";

// Plain Node keeps Eve's shipped imports out of tsx's dependency transforms.
test("installed Eve dependency preserves recoverable conversation compaction", () => {
  const result = spawnSync(
    process.execPath,
    [resolve("scripts/evry-eve-compaction-recovery.test.mjs")],
    {
      encoding: "utf8",
      timeout: 30_000,
      env: { ...process.env, NODE_OPTIONS: "" },
    }
  );
  assert.equal(result.status, 0, result.stdout + result.stderr);
});
