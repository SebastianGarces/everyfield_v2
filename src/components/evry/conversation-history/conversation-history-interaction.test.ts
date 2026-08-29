import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("the mounted workspace handles first and repeated History New clicks", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/components/evry/conversation-history/conversation-history-interaction-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      timeout: 30_000,
    }
  );

  assert.equal(
    proof.status,
    0,
    `conversation history interaction proof failed\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
});
