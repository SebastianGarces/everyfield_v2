import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const scratch = {
  DISCOVERY_PROFILE_PROOF: "1",
  DISCOVERY_PROFILE_DATABASE_URL:
    "postgres://proof:unused@localhost/discovery_294_proof",
  DISCOVERY_PROFILE_ENDPOINT: "http://127.0.0.1:4444/sql",
};
function preload(overrides: Record<string, string>) {
  return spawnSync(
    process.execPath,
    [
      "--import",
      "tsx",
      "--import",
      "./scripts/discovery-db-endpoint.ts",
      "-e",
      `const { neonConfig } = require('@neondatabase/serverless');
     console.log(JSON.stringify({endpoint:neonConfig.fetchEndpoint,connection:process.env.DATABASE_URL}));`,
    ],
    { encoding: "utf8", env: { ...process.env, ...scratch, ...overrides } }
  );
}

test("discovery preload configures the driver before a consumer imports it", () => {
  const result = preload({});
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    endpoint: scratch.DISCOVERY_PROFILE_ENDPOINT,
    connection: scratch.DISCOVERY_PROFILE_DATABASE_URL,
  });
});

test("discovery preload refuses non-proof or non-owned endpoints without connecting", () => {
  const overrides: Record<string, string>[] = [
    { DISCOVERY_PROFILE_PROOF: "0" },
    {
      DISCOVERY_PROFILE_DATABASE_URL:
        "postgres://proof:unused@localhost/shared",
    },
    { DISCOVERY_PROFILE_ENDPOINT: "https://example.com/sql" },
  ];
  for (const override of overrides)
    assert.notEqual(preload(override).status, 0);
});
