import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { test } from "node:test";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const EFFECT_IDENTITIES = [
  "communication.messages.send",
  "communication.resends.send-to-non-openers",
  "communication.templates.create",
  "communication.templates.update",
  "communication.templates.delete",
  "communication.templates.fork",
] as const;
const LIVE_LAYERS = ["execution", "idempotency", "errors"] as const;

type EffectOutcomes = ReadonlySet<string>;

let cachedOutcomes: EffectOutcomes | null = null;

function effectOutcomes(): EffectOutcomes {
  if (cachedOutcomes) return cachedOutcomes;
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
        "src/lib/communication/evry-effect-live-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      timeout: 60_000,
    }
  );
  assert.equal(
    proof.status,
    0,
    `Communication effect live proof failed\nerror: ${proof.error?.message ?? "none"}\nsignal: ${proof.signal ?? "none"}\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
  assert.match(proof.stdout, /Communication effect live proof passed/);
  const encoded = /^EVRY_COMMUNICATION_EFFECT_OUTCOMES=(.+)$/m.exec(
    proof.stdout
  )?.[1];
  assert.ok(encoded, "Communication effect proof returned no outcomes");
  const parsed = JSON.parse(encoded) as unknown;
  assert.ok(Array.isArray(parsed));
  assert.ok(parsed.every((outcome) => typeof outcome === "string"));
  cachedOutcomes = new Set(parsed);
  assert.equal(cachedOutcomes.size, parsed.length);
  return cachedOutcomes;
}

for (const identity of EFFECT_IDENTITIES) {
  for (const layer of LIVE_LAYERS) {
    test(
      `${identity}:${layer}:live`,
      {
        skip: LIVE_DB
          ? false
          : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — real Postgres is required",
      },
      () => {
        assert.ok(effectOutcomes().has(`${identity}:${layer}`));
      }
    );
  }
}
