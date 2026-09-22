import assert from "node:assert/strict";
import { test } from "node:test";
import { createHash } from "node:crypto";
import {
  installIsolatedFixtureHost,
  assertIsolatedFixtureTarget,
} from "./host";
import { createHttpEveEvalRunner } from "./runner";
import { compiledFixtureRequest, fixtureTurnSchema } from "./process-contract";

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

test("optional native question replies have a distinct strict fixture contract", () => {
  assert.deepEqual(
    fixtureTurnSchema.parse({
      respondIfAsked: "The individual 4C assessments.",
    }),
    { respondIfAsked: "The individual 4C assessments." }
  );
  for (const invalid of [
    { respondIfAsked: "" },
    { respondIfAsked: "4C", respond: "Required" },
    { respondIfAsked: "4C", optionId: "continue" },
  ])
    assert.equal(fixtureTurnSchema.safeParse(invalid).success, false);
});

test("optional replies only answer a native question and never manufacture follow-up messages", async () => {
  for (const mode of [
    "answer",
    "prose",
    "question",
    "tool-approval",
    "session-limit",
    "multiple",
  ] as const) {
    const priorFetch = globalThis.fetch;
    const priorDb = process.env.DATABASE_URL;
    process.env.DATABASE_URL = databaseUrl;
    const posted: unknown[] = [];
    const prepared: number[] = [];
    let serial = 0;
    const event = (type: string, data: unknown) => ({
      type,
      data,
      meta: {
        at: now.toISOString(),
        id: `optional-${serial++}`,
        deliveryIds: [`delivery-${posted.length}`],
      },
    });
    globalThis.fetch = async (input, init) => {
      const url = new URL(String(input));
      assert.equal(
        new Headers(init?.headers).get("cookie"),
        `session=${sessionToken}`
      );
      assert.equal(new Headers(init?.headers).get("origin"), origin);
      if (url.pathname.endsWith("/cancel")) return Response.json({ ok: true });
      if (url.pathname === "/eve/v1/session")
        return Response.json({ sessionId: "optional-session" });
      if (init?.method === "POST") {
        assert.equal(url.pathname, "/eve/v1/session/optional-session");
        posted.push(JSON.parse(String(init.body)));
        return Response.json({
          sessionId: "optional-session",
          deliveryId: `delivery-${posted.length}`,
        });
      }
      assert.equal(url.pathname, "/eve/v1/session/optional-session/stream");
      const data = {
        sequence: posted.length - 1,
        turnId: `turn-${posted.length}`,
        stepIndex: 0,
      };
      const events = [event("turn.started", data)];
      if (
        posted.length === 1 &&
        ["question", "session-limit", "multiple", "tool-approval"].includes(
          mode
        )
      ) {
        const request = {
          kind:
            mode === "session-limit" || mode === "tool-approval"
              ? mode
              : "question",
          requestId: "scope-question",
          prompt: "Which assessments?",
          allowFreeform: true,
          action: {
            kind: "tool-call",
            callId: "scope-question",
            toolName: "ask_question",
            input: {},
          },
        };
        events.push(
          event("input.requested", {
            ...data,
            requests:
              mode === "multiple"
                ? [request, { ...request, requestId: "another-question" }]
                : [request],
          })
        );
      } else {
        if (posted.length === 2)
          events.push(
            event("input.resolved", {
              ...data,
              resolutions: [
                {
                  requestId: "scope-question",
                  status: "answered",
                  text: "The individual 4C assessments.",
                },
              ],
            })
          );
        const message =
          mode === "prose"
            ? "Do you mean the individual 4C assessments?"
            : "Two assessments have recorded concerns.";
        events.push(
          event("message.completed", {
            ...data,
            message,
            finishReason: "stop",
          }),
          event("turn.completed", data)
        );
      }
      events.push(
        event("session.waiting", { ...data, reason: "awaiting-message" })
      );
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
      const run = createHttpEveEvalRunner({
        origin,
        databaseUrl,
        host,
        prices,
        beforeTurn: async ({ turnIndex }) => {
          prepared.push(turnIndex);
          return undefined;
        },
      });
      const promise = run({
        scenario: {
          turns: [
            "Which assessments have recorded concerns?",
            { respondIfAsked: "The individual 4C assessments." },
            { respondIfAsked: "Do not send after the question is resolved." },
          ],
        },
        actor,
        sessionToken,
        now,
        maxCostUsd: 1,
        signal: AbortSignal.timeout(2_000),
      });
      if (mode === "session-limit" || mode === "multiple") {
        await assert.rejects(promise, /exactly one native pending question/);
        assert.equal(posted.length, 1);
        assert.deepEqual(prepared, [0]);
      } else {
        const result = await promise;
        assert.equal(result.judge, null);
        assert.equal(posted.length, mode === "question" ? 2 : 1);
        assert.deepEqual(prepared, mode === "question" ? [0, 1] : [0]);
        assert.deepEqual(posted[0], {
          message: "Which assessments have recorded concerns?",
        });
        if (mode === "question") {
          assert.deepEqual(posted[1], {
            inputResponses: [
              {
                requestId: "scope-question",
                text: "The individual 4C assessments.",
              },
            ],
          });
          assert.equal(result.clarificationCount, 1);
          assert.deepEqual(result.clarificationMeasurement?.observedTurnIds, [
            "turn-1",
          ]);
        } else if (mode === "tool-approval") {
          assert.deepEqual(
            result.clarificationMeasurement?.observedTurnIds,
            []
          );
          assert.equal(result.clarificationCount, 0);
          assert.equal(result.answer, "");
          assert.deepEqual(result.hostCapture.calls, []);
        } else {
          assert.equal(
            result.answer,
            mode === "prose"
              ? "Do you mean the individual 4C assessments?"
              : "Two assessments have recorded concerns."
          );
          assert.deepEqual(result.clarificationMeasurement?.unmeasuredTurnIds, [
            "turn-1",
          ]);
          assert.equal(
            result.clarificationCount,
            0,
            "Structural lower bound is not a human prose judgment"
          );
        }
      }
    } finally {
      host.close();
      globalThis.fetch = priorFetch;
      if (priorDb === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = priorDb;
    }
  }
});

test("attachment fixture declarations require one bounded upload per existing turn", () => {
  const request = {
    compiledEntry: "/private/tmp/compiled/index.mjs",
    databaseUrl,
    proxyUrl: origin,
    sessionToken,
    actor,
    turns: ["Review this file"],
    now: now.toISOString(),
    maxCostUsd: 1,
    prices,
    model: { mode: "scripted", responses: [{ text: "Fixture" }] },
  };
  const upload = {
    turnIndex: 0,
    kind: "people_csv",
    name: "people.csv",
    contentType: "text/csv",
    bytesBase64: "YQ==",
    personId: null,
  };
  assert.equal(
    compiledFixtureRequest.safeParse({ ...request, attachments: [upload] })
      .success,
    true
  );
  for (const attachments of [
    [upload, upload],
    [{ ...upload, turnIndex: 1 }],
    [{ ...upload, bytesBase64: "not base64" }],
    [{ ...upload, reference: "signed-token" }],
  ]) {
    assert.equal(
      compiledFixtureRequest.safeParse({ ...request, attachments }).success,
      false
    );
  }
});

test("restart proof refuses a live model before spawning either server", () => {
  const request = {
    compiledEntry: "/private/tmp/compiled/index.mjs",
    databaseUrl,
    proxyUrl: origin,
    sessionToken,
    actor,
    turns: ["Show tasks"],
    now: now.toISOString(),
    maxCostUsd: 1,
    prices,
    verifyRestart: true,
  };
  assert.equal(
    compiledFixtureRequest.safeParse({
      ...request,
      model: { mode: "scripted", responses: [{ text: "Fixture" }] },
    }).success,
    true
  );
  const live = compiledFixtureRequest.safeParse({
    ...request,
    model: { mode: "live", spendingApproved: true },
  });
  assert.equal(live.success, false);
  if (!live.success)
    assert.deepEqual(live.error.issues[0]?.path, ["verifyRestart"]);
});

test("scripted restart follow-up cannot change identity or enable live calls or GET-only replay", () => {
  const request = {
    compiledEntry: "/private/tmp/compiled/index.mjs",
    databaseUrl,
    proxyUrl: origin,
    sessionToken,
    actor,
    turns: ["Prepare a review"],
    now: now.toISOString(),
    maxCostUsd: 1,
    prices,
    model: { mode: "scripted", responses: [{ text: "Prepared" }] },
    restartFollowup: {
      turn: "What happened?",
      responses: [
        { toolCalls: [{ name: "actions_status", input: {} }] },
        { text: "Status checked" },
      ],
    },
  };
  assert.equal(compiledFixtureRequest.safeParse(request).success, true);
  for (const invalid of [
    { ...request, model: { mode: "live", spendingApproved: true } },
    { ...request, verifyRestart: true },
    { ...request, attachments: [] },
    {
      ...request,
      restartFollowup: { ...request.restartFollowup, sessionId: "other" },
    },
    {
      ...request,
      restartFollowup: {
        ...request.restartFollowup,
        actor: { userId: "other", plantId: "other" },
      },
    },
    {
      ...request,
      restartFollowup: { ...request.restartFollowup, responses: [] },
    },
    {
      ...request,
      restartFollowup: { ...request.restartFollowup, model: { mode: "live" } },
    },
    { ...request, expectedTurnFailureMessage: "EVRY_SCRIPTED_STREAM_FAILURE" },
  ])
    assert.equal(compiledFixtureRequest.safeParse(invalid).success, false);
});

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
    const reservation = hooks.reserve({
      prompt: [
        {
          role: "assistant",
          content: [
            {
              type: "text",
              text: "Private fixture prose",
              providerOptions: {
                openai: { phase: "commentary", itemId: "private-provider-id" },
              },
            },
          ],
        },
      ],
      maxOutputTokens: 1_000,
    });
    assert.equal(fixture.snapshot().costUsd, 0.016096);
    assert.throws(
      () => hooks.reserve({ prompt: [], maxOutputTokens: 1_000 }),
      /budget/
    );
    assert.equal(fixture.snapshot().costBasis, "reserved_upper_bound");
    reservation.finish(100, 100);
    const captured = fixture.snapshot().modelCalls[0];
    assert.ok(captured.startedMs >= 0);
    assert.ok(captured.durationMs !== null && captured.durationMs >= 0);
    assert.deepEqual(captured.assistantTextHistory, [
      { phase: "commentary", hasItemId: true },
    ]);
    assert.ok(!JSON.stringify(captured).includes("private-provider-id"));
    assert.ok(!JSON.stringify(captured).includes("Private fixture prose"));
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

test("paid transport refuses unreserved calls, concurrent reuse and retries of one reservation", async () => {
  const previousDb = process.env.DATABASE_URL;
  const originalFetch = globalThis.fetch;
  process.env.DATABASE_URL = databaseUrl;
  let dispatched = 0;
  globalThis.fetch = async () => {
    dispatched++;
    return Response.json({});
  };
  const host = installIsolatedFixtureHost({
    origin,
    databaseUrl,
    allowPaidProviderCalls: true,
  });
  try {
    const fixture = host.register({
      ...actor,
      sessionToken,
      now,
      prices,
      maxCostUsd: 0.02,
    });
    const hooks = globalThis.__everyfieldIsolatedEveFixtureHost!.run(identity);
    await assert.rejects(
      fetch("https://api.openai.com/v1/responses"),
      /outbound/
    );
    const reservation = hooks.reserve({ prompt: [], maxOutputTokens: 1000 });
    const attempts = await reservation.run(() =>
      Promise.allSettled([
        fetch("https://api.openai.com/v1/responses"),
        fetch("https://api.openai.com/v1/responses"),
      ])
    );
    assert.equal(
      attempts.filter((result) => result.status === "fulfilled").length,
      1
    );
    await assert.rejects(
      reservation.run(() => fetch("https://api.openai.com/v1/responses")),
      /outbound/
    );
    assert.equal(dispatched, 1);
    assert.throws(
      () => hooks.reserve({ prompt: [], maxOutputTokens: 1000 }),
      /budget/
    );
    assert.equal(fixture.snapshot().modelCalls[0].costUsd, null);
    reservation.finish(100, 100);
    assert.equal(fixture.snapshot().modelCalls[0].inputTokens, 100);
    await assert.rejects(
      reservation.run(() => fetch("https://api.openai.com/v1/responses")),
      /closed/
    );
  } finally {
    host.close();
    globalThis.fetch = originalFetch;
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
    assert.ok(result.latency.firstInteractionMs !== null);
    assert.ok(result.latency.firstInteractionMs !== undefined);
    assert.ok(result.latency.firstInteractionMs <= result.latency.firstTextMs!);
    assert.equal(result.clarificationCount, 0);
    assert.deepEqual(result.clarificationMeasurement, {
      basis: "structural_lower_bound",
      observedTurnIds: [],
      unmeasuredTurnIds: ["turn-1", "turn-2"],
    });
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

test("restart follow-up snapshots before its sole POST and records zero restored work", async () => {
  const priorFetch = globalThis.fetch;
  const priorDb = process.env.DATABASE_URL;
  process.env.DATABASE_URL = databaseUrl;
  const requests: string[] = [];
  const eventsFor = (sequence: number, text: string) => {
    const common = { sequence, turnId: `turn-${sequence}`, stepIndex: 0 };
    return [
      { type: "turn.started", data: common },
      {
        type: "message.completed",
        data: { ...common, message: text, finishReason: "stop" },
      },
      { type: "turn.completed", data: common },
      {
        type: "session.waiting",
        data: { ...common, reason: "awaiting-message" },
      },
    ].map((entry, index) => ({
      ...entry,
      meta: {
        at: now.toISOString(),
        id: `event-${sequence}-${index}`,
        deliveryIds: [`delivery-${sequence}`],
      },
    }));
  };
  globalThis.fetch = async (input, init) => {
    const url = new URL(String(input));
    const method = init?.method ?? "GET";
    requests.push(`${method} ${url.pathname}`);
    assert.equal(
      new Headers(init?.headers).get("cookie"),
      `session=${sessionToken}`
    );
    if (method === "POST") {
      assert.equal(url.pathname, "/eve/v1/session/saved-session");
      assert.deepEqual(JSON.parse(String(init?.body)), {
        message: "What happened?",
      });
      return Response.json({
        sessionId: "saved-session",
        deliveryId: "delivery-1",
      });
    }
    assert.equal(url.pathname, "/eve/v1/session/saved-session/stream");
    const isRestore = requests.length === 1;
    if (!isRestore) {
      const hooks =
        globalThis.__everyfieldIsolatedEveFixtureHost!.run(identity);
      hooks.authorize(true);
      hooks.call({
        id: "new-status",
        name: "actions.status",
        input: {},
        output: { status: "unavailable" },
      });
    }
    return new Response(
      eventsFor(
        isRestore ? 0 : 1,
        isRestore ? "Saved answer" : "Current status"
      )
        .map((entry) => JSON.stringify(entry))
        .join("\n") + "\n",
      {
        headers: {
          "content-type": "application/x-ndjson",
          "x-eve-stream-version": "25",
          "x-eve-stream-tail-index": "3",
        },
      }
    );
  };
  const host = installIsolatedFixtureHost({ origin, databaseUrl });
  try {
    const result = await createHttpEveEvalRunner({
      origin,
      databaseUrl,
      host,
      prices,
      followupSessionId: "saved-session",
    })({
      scenario: { turns: ["What happened?"] },
      actor,
      sessionToken,
      now,
      maxCostUsd: 1,
      signal: AbortSignal.timeout(1_000),
    });
    assert.deepEqual(requests, [
      "GET /eve/v1/session/saved-session/stream",
      "POST /eve/v1/session/saved-session",
      "GET /eve/v1/session/saved-session/stream",
    ]);
    assert.equal(result.answer, "Saved answer\n\nCurrent status");
    assert.ok(result.followupRestore);
    assert.equal(result.followupRestore.messages.length, 1);
    assert.deepEqual(
      {
        generations: result.followupRestore.generations,
        invocations: result.followupRestore.invocations,
        capturedCalls: result.followupRestore.capturedCalls,
      },
      { generations: 0, invocations: 0, capturedCalls: 0 }
    );
    assert.deepEqual(
      result.hostCapture.calls.map((call) => call.name),
      ["actions.status"]
    );
  } finally {
    host.close();
    globalThis.fetch = priorFetch;
    if (priorDb === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = priorDb;
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
