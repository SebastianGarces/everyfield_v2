import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("conversation scroll follows the production component lifecycle", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "src/components/evry/conversation-scroll-proof.ts",
    ],
    { cwd: process.cwd(), env, encoding: "utf8", timeout: 30_000 }
  );
  assert.equal(proof.status, 0, `${proof.stdout}\n${proof.stderr}`);
});
