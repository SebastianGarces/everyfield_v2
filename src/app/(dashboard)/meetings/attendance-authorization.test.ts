import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

test("attendance writes enforce the stored meeting and team before persistence", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "src/app/(dashboard)/meetings/attendance-authorization-proof.ts",
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 }
  );
  assert.equal(proof.status, 0, `${proof.stdout}\n${proof.stderr}`);
  assert.match(proof.stdout, /Attendance authorization proof passed/);
});
