import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const ROUTE_PATH = path.join(
  process.cwd(),
  "src/app/api/evry/requests/route.ts"
);

test("the request-level policy proof passes without a live model", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(process.cwd(), "src/app/api/evry/requests/request-proof.ts"),
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
  assert.match(proof.stdout, /Evry request route proof passed/);
});

test("the route orders auth, parse, policy, then capability eligibility", () => {
  const source = readFileSync(ROUTE_PATH, "utf8");
  const factoryStart = source.indexOf("export function createEvryRequestPost");
  const auth = source.indexOf(
    "const actor = await requireEvryPlantViewer()",
    factoryStart
  );
  const body = source.indexOf("body = await request.json()", factoryStart);
  const policy = source.indexOf(
    "const policy = await classify(parsed.data.requestText)",
    factoryStart
  );
  const capability = source.indexOf(
    "eligibleEvryCapabilitiesFor(actor)",
    factoryStart
  );

  assert.equal(factoryStart >= 0, true);
  assert.equal(auth > factoryStart, true);
  assert.equal(body > auth, true);
  assert.equal(policy > body, true);
  assert.equal(capability > policy, true);
});

test("production is explicitly closed without a model or second classifier", () => {
  const source = readFileSync(ROUTE_PATH, "utf8");

  assert.match(source, /classify: unavailableClassifier/);
  assert.match(source, /evryRequestClassifierForModel/);
  assert.equal(source.match(/classifyEvryRequest\(/g)?.length, 1);
  assert.doesNotMatch(source, /@ai-sdk\/openai|gpt-[\w.-]+/i);
  assert.doesNotMatch(
    source,
    /eligibility\/repository|\/read|\/plan|\/tool|\/effect/
  );
  assert.match(source, /"cache-control": "private, no-store"/);
});
