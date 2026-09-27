import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { once } from "node:events";
import { resolve } from "node:path";
import { test } from "node:test";

const command = resolve("scripts/phase-engine-assess.mjs");
const cronSecret = "task-local-cron-secret";
const providerSecret = "fake-provider-secret-must-never-appear";
const empty = {
  ok: true,
  selected: 0,
  attempted: 0,
  assessed: 0,
  failed: 0,
  skipped: 0,
  deferred: 0,
  deferredUnattempted: 0,
  rateLimited: 0,
  schemaRejected: 0,
  schemaRetried: 0,
};

async function run(url: string, secret = cronSecret) {
  const child = spawn(process.execPath, [command], {
    env: { NODE_ENV: "test", ASSESS_URL: url, CRON_SECRET: secret },
  });
  let output = "";
  child.stdout.on("data", (data) => (output += data));
  child.stderr.on("data", (data) => (output += data));
  const [code] = await once(child, "close");
  assert.ok(!output.includes(cronSecret));
  assert.ok(!output.includes(providerSecret));
  return { code, output };
}

async function fixture(body: unknown, status = 200) {
  let authorization: string | undefined;
  const server = createServer((request, response) => {
    authorization = request.headers.authorization;
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    const result = await run(`http://127.0.0.1:${address.port}/assess`);
    assert.equal(authorization, `Bearer ${cronSecret}`);
    return result;
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

for (const [name, counts] of [
  ["observed all-failed run", { selected: 3, attempted: 3, failed: 3 }],
  [
    "mixed success and failure",
    { selected: 3, attempted: 3, assessed: 2, failed: 1 },
  ],
] as const) {
  test(`${name} fails the actual scheduler command and retains safe counts`, async () => {
    const result = await fixture({
      ...empty,
      ...counts,
      outcomes: [{ error: providerSecret }],
    });
    assert.equal(result.code, 1);
    assert.match(result.output, new RegExp(`"failed":${counts.failed}`));
    assert.match(result.output, /"selected":3/);
    assert.doesNotMatch(result.output, /run completed/);
  });
}

for (const [name, counts] of [
  ["assessed-only", { selected: 3, attempted: 3, assessed: 3 }],
  ["zero-work", {}],
  ["skipped-only", { selected: 3, skipped: 3 }],
  [
    "deferred-before-attempt",
    { selected: 3, deferred: 3, deferredUnattempted: 3 },
  ],
  [
    "rate-limited-only",
    { selected: 3, attempted: 3, deferred: 3, rateLimited: 3 },
  ],
] as const) {
  test(`${name} remains successful`, async () => {
    const result = await fixture({ ...empty, ...counts });
    assert.equal(result.code, 0, result.output);
    assert.match(result.output, /completed without failures/);
  });
}

for (const field of Object.keys(empty).filter((key) => key !== "ok")) {
  test(`missing required count ${field} fails closed`, async () => {
    const result = await fixture({ ...empty, [field]: undefined });
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.output, /run completed/);
  });
}

for (const [name, body] of [
  ["malformed JSON", `{${providerSecret}`],
  ["missing body", ""],
  ["null body", "null"],
  ["false ok", { ...empty, ok: false }],
  ["negative count", { ...empty, failed: -1 }],
  ["string count", { ...empty, failed: "0" }],
  ["fractional count", { ...empty, assessed: 0.5 }],
  ["inconsistent totals", { ...empty, selected: 3 }],
  ["impossible attempted", { ...empty, attempted: 1 }],
  ["impossible deferral subset", { ...empty, deferredUnattempted: 1 }],
  ["impossible rate limit subset", { ...empty, rateLimited: 1 }],
  ["impossible rejection subset", { ...empty, schemaRejected: 1 }],
] as const) {
  test(`${name} cannot be called completed`, async () => {
    const result = await fixture(body);
    assert.equal(result.code, 1);
    assert.doesNotMatch(result.output, /run completed/);
  });
}

for (const status of [401, 404, 500]) {
  test(`HTTP ${status} fails without printing its raw error body`, async () => {
    const result = await fixture(
      { error: `${providerSecret} ${cronSecret}` },
      status
    );
    assert.equal(result.code, 1);
    assert.match(result.output, new RegExp(`HTTP ${status}`));
  });
}

test("missing cron secret fails before making a request", async () => {
  const result = await run("http://127.0.0.1:1", "");
  assert.equal(result.code, 1);
  assert.match(result.output, /CRON_SECRET is not set/);
  assert.doesNotMatch(result.output, /HTTP/);
});

test("a network failure is a failed tick with no credential-bearing URL printed", async () => {
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise<void>((resolve) => server.close(() => resolve()));
  const result = await run(
    `http://127.0.0.1:${address.port}/?secret=${providerSecret}`
  );
  assert.equal(result.code, 1);
  assert.match(result.output, /No HTTP response/);
});
