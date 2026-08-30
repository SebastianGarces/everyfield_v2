import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";

test(
  "Teams execution survives real PostgreSQL replay, drift, authority, and role-seat races",
  {
    skip: LIVE_DB ? false : "opt-in: LIVE_DB_TESTS=1 pnpm test:live",
    timeout: 120_000,
  },
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
        path.join(
          process.cwd(),
          "src/lib/evry/capabilities/teams/effect-live-proof.ts"
        ),
      ],
      {
        cwd: process.cwd(),
        encoding: "utf8",
        env: process.env,
        timeout: 110_000,
      }
    );
    assert.equal(
      proof.status,
      0,
      `Teams live proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
    );
    assert.match(proof.stdout, /Evry Teams live effect proof passed/);
  }
);
