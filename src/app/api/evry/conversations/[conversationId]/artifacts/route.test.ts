import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("the artifact lifecycle Request/Response proof passes without providers", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/app/api/evry/conversations/[conversationId]/artifacts/request-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://ci:ci@localhost:5432/ci",
      },
      timeout: 30_000,
    }
  );

  assert.equal(
    proof.status,
    0,
    "artifact lifecycle request proof failed\nstdout:\n" +
      proof.stdout +
      "\nstderr:\n" +
      proof.stderr
  );
  assert.match(proof.stdout, /Evry artifact lifecycle route proof passed/);
});
