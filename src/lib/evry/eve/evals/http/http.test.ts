import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  installIsolatedFixtureHost,
  assertIsolatedFixtureTarget,
} from "./host";
import { createHttpEveEvalRunner } from "./runner";

const origin = "http://127.0.0.1:4109";
const databaseUrl = "postgres://fixture:fixture@localhost:5499/eve_fixture";
const prices = {
  inputUsdPerMillion: 1,
  outputUsdPerMillion: 2,
  maxInputBytes: 10_000,
  maxOutputTokens: 1_000,
};
const now = new Date("2026-09-20T16:00:00Z");
const actor = { userId: "fixture-user", plantId: "fixture-plant" };
const sessionToken = "fixture-only-cookie";
const identity = {
  ...actor,
  appSessionId: createHash("sha256").update(sessionToken).digest("hex"),
};

test("isolated host rejects remote targets, ordinary databases, and cross-actor bindings", () => {
  assert.throws(() =>
    assertIsolatedFixtureTarget("https://example.com", databaseUrl)
  );
  assert.throws(() =>
    assertIsolatedFixtureTarget(origin, "postgres://localhost/production")
  );
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const host = installIsolatedFixtureHost({ origin, databaseUrl });
  try {
    host.register({ ...actor, sessionToken, now, prices, maxCostUsd: 1 });
    assert.throws(() =>
      globalThis.__everyfieldIsolatedEveFixtureHost?.run({
        ...identity,
        plantId: "other",
      })
    );
    assert.equal(
      globalThis.__everyfieldIsolatedEveFixtureHost
        ?.run(identity)
        .now.toISOString(),
      now.toISOString()
    );
  } finally {
    host.close();
    process.env.DATABASE_URL = previousDb;
  }
});

test("host reserves before generation, retains failed-call exposure, and never budgets unknown usage as zero", async () => {
  const previousDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const host = installIsolatedFixtureHost({ origin, databaseUrl });
  try {
    const fixture = host.register({
      ...actor,
      sessionToken,
      now,
      prices,
      maxCostUsd: 0.02,
    });
    const hooks = globalThis.__everyfieldIsolatedEveFixtureHost!.run(identity);
    const reservation = hooks.reserve({ prompt: [], maxOutputTokens: 1_000 });
    assert.equal(fixture.snapshot().costUsd, 0.012);
    assert.throws(
      () => hooks.reserve({ prompt: [], maxOutputTokens: 1_000 }),
      /budget/
    );
    assert.equal(fixture.snapshot().costBasis, "reserved_upper_bound");
    reservation.finish(100, 100);
    assert.ok(Math.abs(fixture.snapshot().costUsd - 0.0003) < 0.0000001);
    assert.equal(fixture.snapshot().costBasis, "provider_usage");
    fixture.stop();
    assert.throws(
      () => hooks.reserve({ prompt: [], maxOutputTokens: 1_000 }),
      /stopped/
    );
    await assert.rejects(
      fetch("https://api.openai.com/v1/responses"),
      /outbound/
    );
    await assert.rejects(fetch("https://api.resend.com/emails"), /outbound/);
    assert.equal(fixture.snapshot().outboundMessages, 1);
  } finally {
    host.close();
    process.env.DATABASE_URL = previousDb;
  }
});

test("official Eve client runner uses cookie auth, fixed-session follow-ups and trusted host capture without info", async () => {
  const priorFetch = globalThis.fetch;
  const priorDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  let turn = 0;
  let serial = 0;
  const requests: string[] = [];
  const event = (type: string, data: unknown) => ({
    type,
    data,
    meta: {
      at: now.toISOString(),
      id: `event-${serial++}`,
      deliveryIds: [`delivery-${turn}`],
    },
  });
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push(`${init?.method ?? "GET"} ${url.pathname}`);
    assert.equal(
      new Headers(init?.headers).get("cookie"),
      `session=${sessionToken}`
    );
    assert.equal(new Headers(init?.headers).get("origin"), origin);
    assert.equal(init?.redirect, "error");
    if (url.pathname === "/eve/v1/session")
      return Response.json({ sessionId: "fixture-eve-session" });
    if (
      init?.method === "POST" &&
      url.pathname === "/eve/v1/session/fixture-eve-session"
    ) {
      turn++;
      return Response.json({
        sessionId: "fixture-eve-session",
        deliveryId: `delivery-${turn}`,
      });
    }
    assert.equal(url.pathname, "/eve/v1/session/fixture-eve-session/stream");
    const hooks = globalThis.__everyfieldIsolatedEveFixtureHost!.run(identity);
    hooks.authorize(true);
    hooks.call({
      id: `read-${turn}`,
      name: "tasks.query",
      input: {},
      output: { kind: "read", items: [] },
    });
    hooks.present(`read-${turn}`);
    const data = { sequence: turn - 1, turnId: `turn-${turn}`, stepIndex: 0 };
    const events = [
      event("turn.started", data),
      event("message.appended", { ...data, messageDelta: `Answer ${turn}` }),
      event("message.completed", {
        ...data,
        message: `Answer ${turn}`,
        finishReason: "stop",
      }),
      event("turn.completed", data),
      event("session.waiting", { ...data, reason: "awaiting-message" }),
    ];
    return new Response(
      events.map((entry) => JSON.stringify(entry)).join("\n") + "\n",
      {
        headers: {
          "content-type": "application/x-ndjson",
          "x-eve-stream-version": "25",
        },
      }
    );
  };
  const host = installIsolatedFixtureHost({ origin, databaseUrl });
  try {
    const run = createHttpEveEvalRunner({ origin, databaseUrl, host, prices });
    const result = await run({
      scenario: { turns: ["Today", "Only high priority"] },
      actor,
      sessionToken,
      now,
      maxCostUsd: 1,
      signal: new AbortController().signal,
    });
    assert.equal(result.answer, "Answer 1\n\nAnswer 2");
    assert.deepEqual(result.hostCapture.presented, ["read-1", "read-2"]);
    assert.equal(result.hostCapture.freshAuthorizations, 2);
    assert.equal(result.eveSessionId, "fixture-eve-session");
    assert.equal(result.judge, null);
    assert.equal(
      requests.some((path) => path.includes("/info")),
      false
    );
    assert.equal(
      requests.filter((path) => path === "POST /eve/v1/session").length,
      1
    );
  } finally {
    host.close();
    globalThis.fetch = priorFetch;
    process.env.DATABASE_URL = priorDb;
  }
});

test("abort sends an authenticated server cancellation rather than only closing the stream", async () => {
  const priorFetch = globalThis.fetch;
  const priorDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const controller = new AbortController();
  let cancelled = false;
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === "/eve/v1/session")
      return Response.json({ sessionId: "cancel-session" });
    if (url.pathname.endsWith("/cancel")) {
      cancelled = true;
      return Response.json({
        ok: true,
        sessionId: "cancel-session",
        status: "accepted",
      });
    }
    if (init?.method === "POST")
      return Response.json({
        sessionId: "cancel-session",
        deliveryId: "cancel-delivery",
      });
    controller.abort(new Error("test cancellation"));
    throw new Error("stream interrupted");
  };
  const host = installIsolatedFixtureHost({ origin, databaseUrl });
  try {
    const run = createHttpEveEvalRunner({ origin, databaseUrl, host, prices });
    await assert.rejects(
      run({
        scenario: { turns: ["Hello"] },
        actor,
        sessionToken,
        now,
        maxCostUsd: 1,
        signal: controller.signal,
      })
    );
    assert.equal(cancelled, true);
  } finally {
    host.close();
    globalThis.fetch = priorFetch;
    process.env.DATABASE_URL = priorDb;
  }
});
