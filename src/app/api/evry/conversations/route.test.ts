import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

const ROOT = path.join(process.cwd(), "src/app/api/evry/conversations");

test("the conversation Request/Response proof passes with zero model calls", () => {
  const proof = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      path.join(ROOT, "request-proof.ts"),
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
    `conversation request proof failed\nstdout:\n${proof.stdout}\nstderr:\n${proof.stderr}`
  );
  assert.match(proof.stdout, /Evry conversation request proof passed/);
});

test("all conversation routes authenticate before path or body parsing", () => {
  for (const relative of [
    "route.ts",
    "[conversationId]/route.ts",
    "[conversationId]/messages/route.ts",
  ]) {
    const source = readFileSync(path.join(ROOT, relative), "utf8");
    const factory = source.indexOf("export function createEvryConversation");
    const auth = source.indexOf(
      "const actor = await requireEvryPlantViewer()",
      factory
    );
    const params = source.indexOf("routeParamsSchema.safeParse", factory);
    const body = source.indexOf("body = await request.json()", factory);

    assert.equal(factory >= 0, true, relative);
    assert.equal(auth > factory, true, relative);
    if (params >= 0) assert.equal(params > auth, true, relative);
    if (body >= 0) assert.equal(body > auth, true, relative);
  }
});

test("the route surface is private, neutral, and has no model or effect seam", () => {
  const source = [
    "shared.ts",
    "route.ts",
    "[conversationId]/route.ts",
    "[conversationId]/messages/route.ts",
  ]
    .map((relative) => readFileSync(path.join(ROOT, relative), "utf8"))
    .join("\n");

  assert.match(source, /"cache-control": "private, no-store"/);
  assert.match(source, /\{ status: "unavailable" \}, 404/);
  assert.doesNotMatch(
    source,
    /generateText|streamText|LanguageModel|eligibleEvryCapabilitiesFor|continueAction|executeEvry/
  );
  assert.doesNotMatch(source, /conversationId:\s*z\.string\(\).*body/i);
});
