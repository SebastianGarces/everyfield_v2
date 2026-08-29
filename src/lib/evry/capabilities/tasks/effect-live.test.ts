import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { before, test } from "node:test";

import { TASK_ACTION_CONTRACTS } from "./contracts";

const TASK_READ_IDENTITIES = [
  "tasks.read.detail",
  "tasks.read.list",
  "tasks.read.phase-template-prompt",
  "tasks.read.planning-options",
  "tasks.read.templates",
] as const;

const LIVE = process.env.LIVE_DB_TESTS === "1";
const run = LIVE ? test : test.skip;
let output = "";

before(() => {
  if (!LIVE) return;
  const result = spawnSync(
    process.execPath,
    [
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      "--import",
      path.join(process.cwd(), "scripts/live-db-endpoint.ts"),
      path.join(__dirname, "effect-live-proof.ts"),
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      encoding: "utf8",
      timeout: 420_000,
    }
  );
  output = `${result.stdout}${result.stderr}`;
  assert.equal(result.status, 0, output);
});

run("Task effect live proof refuses cross-plant resolution", () => {
  assert.match(output, /PASS tasks:cross-plant-neutral-resolution/);
});

run("Task effects refuse one of two concurrently confirmed stale plans", () => {
  assert.match(output, /PASS tasks:competing-confirmed-plans/);
});

run(
  "Task effects refuse prerequisite and child-set drift after confirmation",
  () => {
    assert.match(output, /PASS tasks:structural-source-drift/);
  }
);

run("Recurring completion refuses checklist add/delete/edit drift", () => {
  assert.match(output, /PASS tasks:recurring-checklist-source-drift/);
});

run("Task source-derived handoff remains exact above the bulk UI cap", () => {
  assert.match(output, /PASS tasks:source-derived-handoff-above-bulk-cap/);
});

run("A resolver-shaped 100-Task completion reaches trusted review", () => {
  assert.match(output, /PASS tasks:resolver-shaped-bulk-review/);
});

run("Task list cursors reach 51 matching rows without page exclusions", () => {
  assert.match(output, /PASS tasks\.read\.list:cursor-pagination/);
});

run(
  "Task detail cursors reconstruct every checklist and prerequisite row",
  () => {
    assert.match(
      output,
      /PASS tasks\.read\.detail:related-cursor-reconstruction/
    );
  }
);

run(
  "Typed planning cursors preserve task/search and reconstruct every option",
  () => {
    assert.match(
      output,
      /PASS tasks\.read\.planning-options:typed-cursor-reconstruction/
    );
  }
);

for (const race of [
  "dependency-cycle-barrier",
  "reparent-child-barrier",
  "delete-child-barrier",
] as const) {
  run(`Task structure serialization proves ${race}`, () => {
    assert.match(output, new RegExp(`PASS tasks:${race}`));
  });
}

for (const contract of Object.values(TASK_ACTION_CONTRACTS)) {
  if (contract.operationKind !== "effect") continue;
  for (const layer of [
    "permission",
    "tenancy",
    "execution",
    "idempotency",
    "errors",
  ] as const) {
    run(`${contract.operationId} owns ${layer} live proof`, () => {
      assert.match(output, new RegExp(`PASS ${contract.operationId}:${layer}`));
    });
  }
}

for (const capabilityIdentity of TASK_READ_IDENTITIES) {
  for (const layer of [
    "permission",
    "tenancy",
    "execution",
    "idempotency",
    "errors",
    "ui_artifact",
  ] as const) {
    run(`${capabilityIdentity} owns ${layer} live proof`, () => {
      assert.match(output, new RegExp(`PASS ${capabilityIdentity}:${layer}`));
    });
  }
}
