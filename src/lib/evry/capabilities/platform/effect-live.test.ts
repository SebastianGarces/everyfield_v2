import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { before, test } from "node:test";

const LIVE_DB = process.env.LIVE_DB_TESTS === "1";
const IDENTITIES = [
  "notifications.feed.mark-one-read",
  "notifications.feed.mark-all-read",
  "platform.feedback.submit",
] as const;
const LAYERS = [
  "tenancy",
  "permission",
  "execution",
  "idempotency",
  "errors",
] as const;

let outcomes: ReadonlySet<string> | Error | null = null;

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
        "src/lib/evry/capabilities/platform/effect-live-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: process.env,
      timeout: 180_000,
    }
  );
  try {
    assert.equal(
      proof.status,
      0,
      `Platform effect live proof failed\n${proof.stdout}\n${proof.stderr}`
    );
    const encoded = /^EVRY_PLATFORM_EFFECT_OUTCOMES=(.+)$/m.exec(
      proof.stdout
    )?.[1];
    assert.ok(encoded, "Platform effect proof returned no outcomes");
    const parsed = JSON.parse(encoded) as unknown;
    assert.ok(Array.isArray(parsed));
    assert.ok(parsed.every((item) => typeof item === "string"));
    outcomes = new Set(parsed);
  } catch (error) {
    outcomes = error instanceof Error ? error : new Error(String(error));
  }
});

for (const identity of IDENTITIES) {
  for (const layer of LAYERS) {
    test(
      `${identity}:${layer}:live`,
      {
        skip: LIVE_DB ? false : "opt-in: LIVE_DB_TESTS=1 pnpm test:live",
      },
      () => {
        if (outcomes instanceof Error) throw outcomes;
        assert.ok(outcomes?.has(`${identity}:${layer}`));
      }
    );
  }
}
