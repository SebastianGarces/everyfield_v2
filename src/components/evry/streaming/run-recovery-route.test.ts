import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("the shell settles route mismatches and reconnects only after returning", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/components/evry/streaming/run-recovery-route-proof.ts"
      ),
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 }
  );

  assert.equal(
    proof.status,
    0,
    `run recovery route proof failed\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
});
