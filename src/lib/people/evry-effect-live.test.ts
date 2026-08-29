import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { before, test } from "node:test";

import generated from "@/lib/evry/capabilities/people/inventory.generated.json";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";

// Measured at 81.32s on the isolated local CI stack. This suite now owns a
// dedicated live-runner phase; five minutes leaves room for a slower two-core
// hosted runner while still turning a stalled proof into a hard failure.
const PEOPLE_EFFECT_PROOF_TIMEOUT_MS = 5 * 60_000;

const STORAGE_ENVIRONMENT_KEYS = [
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_PROFILE",
  "AWS_CONFIG_FILE",
  "AWS_SHARED_CREDENTIALS_FILE",
  "AWS_ENDPOINT_URL",
  "AWS_ENDPOINT_URL_S3",
  "AWS_BUCKET_NAME",
  "AWS_WEB_IDENTITY_TOKEN_FILE",
  "AWS_ROLE_ARN",
  "AWS_CONTAINER_CREDENTIALS_FULL_URI",
  "AWS_CONTAINER_CREDENTIALS_RELATIVE_URI",
] as const;

function credentialFreeProofEnvironment(): NodeJS.ProcessEnv {
  const environment = { ...process.env };
  for (const key of STORAGE_ENVIRONMENT_KEYS) delete environment[key];
  return environment;
}

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
  const environment = credentialFreeProofEnvironment();
  for (const key of STORAGE_ENVIRONMENT_KEYS) {
    assert.equal(environment[key], undefined, `${key} reached the proof child`);
  }
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
      env: environment,
      timeout: PEOPLE_EFFECT_PROOF_TIMEOUT_MS,
    }
  );
  assert.doesNotMatch(
    proof.stderr,
    /Region is missing|Could not load credentials|CredentialsProviderError/,
    "People effect proof reached the default S3 client"
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
