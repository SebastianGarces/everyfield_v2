import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { before, test } from "node:test";

import generated from "./inventory.generated.json";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
type Outcome = Readonly<{
  identity: string;
  operationKind: "read" | "effect";
  allowed: true;
  replayed: true;
  denied: true;
  foreignRefused: true;
  durable: true;
}>;
let outcomes = new Map<string, Outcome>();

before(() => {
  if (!LIVE_DB) return;
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--import",
      "tsx",
      "--import",
      "./scripts/live-db-endpoint.ts",
      path.join(
        process.cwd(),
        "src/lib/evry/capabilities/documents-wiki/effect-live-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        AWS_ACCESS_KEY_ID: "",
        AWS_SECRET_ACCESS_KEY: "",
        AWS_ENDPOINT_URL_S3: "",
        AWS_BUCKET_NAME: "",
      },
      timeout: 180_000,
    }
  );
  assert.equal(
    proof.status,
    0,
    `Documents/wiki live proof failed\n${proof.stdout}\n${proof.stderr}`
  );
  const payload = proof.stdout
    .split("\n")
    .find((line) => line.startsWith("DOCUMENTS_WIKI_CAPABILITY_OUTCOMES="))
    ?.slice("DOCUMENTS_WIKI_CAPABILITY_OUTCOMES=".length);
  assert.ok(payload);
  outcomes = new Map(
    (JSON.parse(payload) as Outcome[]).map((outcome) => [
      outcome.identity,
      outcome,
    ])
  );
});

for (const capability of generated.capabilities) {
  test(
    `${capability.identity}:production-live-outcome`,
    { skip: LIVE_DB ? false : "real Postgres is required" },
    () => {
      const outcome = outcomes.get(capability.identity);
      assert.ok(outcome);
      assert.deepEqual(outcome, {
        identity: capability.identity,
        operationKind: capability.operationKind,
        allowed: true,
        replayed: true,
        denied: true,
        foreignRefused: true,
        durable: true,
      });
    }
  );
}
