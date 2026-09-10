import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

test("RSVP HTTP 401/403 responses precede parsing and writes", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/app/api/meetings/[id]/rsvp/request-proof.ts"
      ),
    ],
    { cwd: process.cwd(), encoding: "utf8", timeout: 30_000 }
  );
  assert.equal(
    proof.status,
    0,
    `RSVP request proof failed\n${proof.stdout}\n${proof.stderr}`
  );
  assert.match(proof.stdout, /RSVP HTTP authorization proof passed/);
});
