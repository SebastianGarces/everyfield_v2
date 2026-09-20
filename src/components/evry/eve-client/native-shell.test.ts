import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("native Eve production shell preserves optimistic streaming and session identity", () => {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "src/components/evry/eve-client/native-shell-proof.ts",
    ],
    { cwd: process.cwd(), env, encoding: "utf8", timeout: 30_000 }
  );
  assert.equal(proof.status, 0, `${proof.stdout}\n${proof.stderr}`);
});
