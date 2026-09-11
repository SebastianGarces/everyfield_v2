import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("reuse shell ownership survives delayed route commit and cancels on departure", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/components/evry/artifacts/reuse-navigation-proof.ts"
      ),
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 }
  );
  assert.equal(
    proof.status,
    0,
    `reuse navigation proof failed\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
});
