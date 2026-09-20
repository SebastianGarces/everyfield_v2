import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { parseFixtureHostCapture } from "./host-capture";
import { createFixtureManifest } from "./manifest";

const capture = () => ({
  calls: [
    {
      id: "authorized-read-1",
      name: "tasks.query",
      input: {},
      output: {
        kind: "read",
        counts: { matched: 1 },
        items: [{ id: "task-1", label: "Task" }],
      },
    },
  ],
  presented: ["authorized-read-1"],
  freshAuthorizations: 1,
  refusedAuthorizations: 0,
  outboundMessages: 0,
  costUsd: 0.02,
  costBasis: "provider_usage",
});

test("HTTP fixture evidence resolves original authorized result references", () => {
  assert.deepEqual(parseFixtureHostCapture(capture()), capture());
  assert.throws(() => parseFixtureHostCapture(undefined));
  assert.throws(
    () =>
      parseFixtureHostCapture({ ...capture(), presented: ["model-invented"] }),
    /Untrusted/
  );
  assert.throws(
    () =>
      parseFixtureHostCapture({
        ...capture(),
        calls: [...capture().calls, ...capture().calls],
      }),
    /Duplicate/
  );
  assert.throws(() => parseFixtureHostCapture({ ...capture(), costUsd: -1 }));
  assert.throws(() =>
    parseFixtureHostCapture({ ...capture(), freshAuthorizations: -1 })
  );
});

test("HTTP fixture cookie token hashes to the existing seeded session identity", () => {
  const manifest = createFixtureManifest("regression-today", 2);
  assert.equal(
    createHash("sha256").update(manifest.sessionToken).digest("hex"),
    manifest.sessionId
  );
  assert.equal(manifest.sessionToken, "regression-today:2:session");
});
