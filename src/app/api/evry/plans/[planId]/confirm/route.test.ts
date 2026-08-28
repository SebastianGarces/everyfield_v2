import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/evry/plans/[planId]/confirm/route.ts"
);

test("the exact-confirmation request proof passes without a database", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/app/api/evry/plans/[planId]/confirm/request-proof.ts"
      ),
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        DATABASE_URL: "postgresql://ci:ci@localhost:5432/ci",
      },
      timeout: 30_000,
    }
  );

  assert.equal(
    proof.status,
    0,
    `request proof failed\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
  assert.match(proof.stdout, /Evry plan confirmation route proof passed/);
});

test("authentication precedes path and body parsing", () => {
  const source = readFileSync(ROUTE_PATH, "utf8");
  const factory = source.indexOf("export function createEvryPlanConfirmPost");
  const auth = source.indexOf(
    "const actor = await requireEvryPlantViewer()",
    factory
  );
  const params = source.indexOf("await context.params", factory);
  const body = source.indexOf("body = await request.json()", factory);
  const confirm = source.indexOf("const result = await confirm", factory);

  assert.equal(factory >= 0, true);
  assert.equal(auth > factory, true);
  assert.equal(params > auth, true);
  assert.equal(body > params, true);
  assert.equal(confirm > body, true);
  assert.match(source, /"cache-control": "private, no-store"/);
});
