import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { before, test } from "node:test";

import generated from "@/lib/evry/capabilities/people/inventory.generated.json";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";

type LiveOutcome = Readonly<{
  identity: string;
  operationKind: "read" | "effect";
  allowed: true;
  replayed: true;
  denied?: true;
  foreignRefused?: true;
  durable?: true;
}>;

let outcomes = new Map<string, LiveOutcome>();

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
      path.join(process.cwd(), "src/lib/people/evry-effect-live-proof.ts"),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      timeout: 180_000,
    }
  );
  assert.equal(
    proof.status,
    0,
    `People effect live proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
  const serialized = proof.stdout
    .split("\n")
    .find((line) => line.startsWith("PEOPLE_CAPABILITY_OUTCOMES="))
    ?.slice("PEOPLE_CAPABILITY_OUTCOMES=".length);
  assert.ok(serialized, `Missing operation outcomes\n${proof.stdout}`);
  const parsed = JSON.parse(serialized) as LiveOutcome[];
  outcomes = new Map(parsed.map((outcome) => [outcome.identity, outcome]));
});

for (const capability of generated.capabilities) {
  test(
    `${capability.identity}:production-live-outcome`,
    { skip: LIVE_DB ? false : "real Postgres is required" },
    () => {
      const outcome = outcomes.get(capability.identity);
      assert.ok(outcome, `Missing live outcome for ${capability.identity}`);
      assert.equal(outcome.operationKind, capability.operationKind);
      assert.equal(outcome.allowed, true);
      assert.equal(outcome.replayed, true);
      if (capability.operationKind === "effect") {
        assert.equal(outcome.denied, true);
        assert.equal(outcome.foreignRefused, true);
        assert.equal(outcome.durable, true);
      }
    }
  );
}
