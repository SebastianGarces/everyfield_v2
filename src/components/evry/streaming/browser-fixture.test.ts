import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("the preview fixture completes the accessible request lifecycle", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/components/evry/streaming/browser-fixture-proof.ts"
      ),
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 }
  );

  assert.equal(
    proof.status,
    0,
    `streaming fixture proof failed\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
});
