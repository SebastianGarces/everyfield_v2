import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("every team write enforces its seat and stored team subject before persistence", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "src/app/(dashboard)/teams/authorization-proof.ts",
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 }
  );
  assert.equal(proof.status, 0, `${proof.stdout}\n${proof.stderr}`);
  assert.match(proof.stdout, /Team authorization proof passed/);
});
