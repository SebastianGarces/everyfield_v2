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

test("the read and resolver request proof passes without a live model", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(
        process.cwd(),
        "src/app/api/evry/requests/read-request-proof.ts"
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
    `read request proof failed\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
  assert.match(proof.stdout, /Evry read request proof passed/);
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

test("production is explicitly closed without a model or domain adapter", () => {
  const source = readFileSync(ROUTE_PATH, "utf8");

  assert.match(source, /classify: unavailableClassifier/);
  assert.match(source, /evryRequestClassifierForModel/);
  assert.equal(source.match(/classifyEvryRequest\(/g)?.length, 1);
  assert.doesNotMatch(source, /@ai-sdk\/openai|gpt-[\w.-]+/i);
  assert.doesNotMatch(source, /eligibility\/repository|\/plan|\/tool|\/effect/);
  assert.match(source, /continueRead: null/);
  assert.match(source, /continueAction: null/);
  assert.match(source, /"cache-control": "private, no-store"/);
});

test("read dispatch reauthorizes the trusted registration identity", () => {
  const dispatchSource = readFileSync(
    path.join(process.cwd(), "src/lib/evry/reads/core.ts"),
    "utf8"
  );
  const registrationSource = readFileSync(
    path.join(process.cwd(), "src/lib/evry/reads/contract.ts"),
    "utf8"
  );
  const selected = dispatchSource.indexOf("const registration = registry.get(");
  const admitted = dispatchSource.indexOf(
    "isEvryReadCapabilityIdentity(registration.capabilityIdentity)"
  );
  const parsed = registrationSource.indexOf(
    "const parsed = inputSchema.safeParse(untrustedInput)"
  );
  const authorized = registrationSource.indexOf(
    "await authorizeEvryReadCapability(capabilityIdentity)",
    parsed
  );
  const executed = registrationSource.indexOf(
    "return run({ ...context, authorization }",
    authorized
  );

  assert.equal(selected >= 0, true);
  assert.equal(admitted >= 0, true);
  assert.equal(parsed >= 0, true);
  assert.equal(authorized > parsed, true);
  assert.equal(executed > authorized, true);
  assert.doesNotMatch(
    dispatchSource,
    /selection\.(?:plantId|capabilityIdentity)/
  );
});
