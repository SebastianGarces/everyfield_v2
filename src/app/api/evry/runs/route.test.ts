import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("the active-run Request/Response proof passes", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(process.cwd(), "src/app/api/evry/runs/request-proof.ts"),
    ],
    { cwd: process.cwd(), encoding: "utf8", env: process.env }
  );
  assert.equal(
    proof.status,
    0,
    `active-run request proof failed\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
});
