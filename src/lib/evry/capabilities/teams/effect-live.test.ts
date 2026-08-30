import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

import {
  TEAMS_EFFECT_IDENTITY_BY_OPERATION,
  TEAMS_EFFECT_OPERATIONS,
} from "./effect-contracts";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
type LiveLayer = "execution" | "idempotency" | "errors";
type LiveOutcomes = Record<string, Record<LiveLayer, boolean>>;
let cachedOutcomes: LiveOutcomes | null = null;
let proofAttempted = false;
let cachedFailure: unknown = null;

function runProof(): LiveOutcomes {
  if (cachedOutcomes) return cachedOutcomes;
  if (proofAttempted) throw cachedFailure;
  proofAttempted = true;
  try {
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
        timeout: 300_000,
      }
    );
    assert.equal(
      proof.status,
      0,
      `Teams live proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
    );
    assert.match(proof.stdout, /Evry Teams live effect proof passed/);
    const encoded = /^EVRY_TEAMS_LIVE_OUTCOMES=(.+)$/m.exec(proof.stdout)?.[1];
    assert.ok(encoded, `Teams live proof omitted outcomes\n${proof.stdout}`);
    cachedOutcomes = JSON.parse(encoded) as LiveOutcomes;
    return cachedOutcomes;
  } catch (error) {
    cachedFailure = error;
    throw error;
  }
}

test(
  "Teams execution survives real PostgreSQL replay, drift, authority, and role-seat races",
  {
    skip: LIVE_DB ? false : "opt-in: LIVE_DB_TESTS=1 pnpm test:live",
    timeout: 330_000,
  },
  () => {
    assert.equal(
      Object.keys(runProof()).length,
      TEAMS_EFFECT_OPERATIONS.length
    );
  }
);

for (const operation of TEAMS_EFFECT_OPERATIONS) {
  const identity = TEAMS_EFFECT_IDENTITY_BY_OPERATION[operation];
  for (const layer of ["execution", "idempotency", "errors"] as const) {
    test(
      `${identity}:${layer}:live`,
      {
        skip: LIVE_DB ? false : "opt-in: LIVE_DB_TESTS=1 pnpm test:live",
        timeout: 330_000,
      },
      () => {
        assert.equal(runProof()[identity]?.[layer], true);
      }
    );
  }
}
