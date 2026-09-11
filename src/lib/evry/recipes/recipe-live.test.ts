import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const skip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` because real Postgres is required";

test(
  "a backend request compiles, persists, and confirms the exact recipe plan",
  { skip },
  () => {
    const proof = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--import",
        "./scripts/live-db-endpoint.ts",
        path.join(process.cwd(), "src/lib/evry/recipes/recipe-live-proof.ts"),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: process.env,
        timeout: 120_000,
      }
    );

    assert.equal(
      proof.status,
      0,
      `live recipe proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
    );
    assert.match(proof.stdout, /Evry recipe live request proof passed/);
  }
);

for (const scenario of ["end_to_end", "partial_failure"] as const) {
  test(`meeting.invitation.reference:${scenario}`, { skip }, () => {
    const proof = spawnSync(
      process.execPath,
      [
        "--no-warnings",
        "--experimental-test-module-mocks",
        "--import",
        "tsx",
        "--import",
        "./scripts/live-db-endpoint.ts",
        path.join(
          process.cwd(),
          "src/lib/evry/recipes/meeting-invitation-live-proof.ts"
        ),
        scenario,
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: process.env,
        timeout: 120_000,
      }
    );
    assert.equal(
      proof.status,
      0,
      `live invitation proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
    );
    assert.match(proof.stdout, /Meeting invitation live proof passed/);
  });
}
