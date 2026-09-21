// Installed patched Eve compaction lifecycle. Scripted provider; no network or mutations.
import assert from "node:assert/strict";
import { test } from "node:test";
import { createRequire } from "node:module";
import { pathToFileURL, fileURLToPath } from "node:url";
const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(`${root}/package.json`);
const { MockLanguageModelV4 } = require("ai/test");
const { wrapLanguageModel } = require("ai");
const { createToolLoopHarness } = await import(
  pathToFileURL(`${root}/node_modules/eve/dist/src/harness/tool-loop.js`)
);
const { setHarnessEmissionState } = await import(
  pathToFileURL(`${root}/node_modules/eve/dist/src/harness/emission-state.js`)
);
const usage = {
  inputTokens: { total: 500, noCache: 500, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 500, text: 500, reasoning: 0 },
};
const history = Array.from({ length: 24 }, (_, index) => ({
  role: index % 2 ? "assistant" : "user",
  ...(index % 2 ? {} : { kind: "user" }),
  content: `Original context ${index}: ` + "recorded fact ".repeat(80),
}));
async function fixture(
  failure,
  mode = "conversation",
  signal,
  cancel,
  steeringSignal
) {
  let state = { turnId: "original", modelCalls: 0 };
  const events = [];
  let summaryCalls = 0;
  let warming = true;
  let recovered = false;
  const provider = new MockLanguageModelV4({
    doGenerate: async () => {
      if (!warming) {
        summaryCalls++;
        if (cancel) {
          cancel();
          signal.throwIfAborted();
        }
        if (failure === "provider" && !recovered)
          throw new Error("SCRIPTED_COMPACTION_FAILURE");
      }
      return {
        content: [
          {
            type: "text",
            text: warming
              ? "Prior investigation."
              : recovered
                ? "Accurate retained summary."
                : "Supported facts. ".repeat(260),
          },
        ],
        finishReason: { unified: "stop", raw: "stop" },
        usage,
        warnings: [],
      };
    },
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          for (const part of [
            { type: "stream-start", warnings: [] },
            { type: "text-start", id: "answer" },
            { type: "text-delta", id: "answer", delta: "Retry completed." },
            { type: "text-end", id: "answer" },
            {
              type: "finish",
              finishReason: { unified: "stop", raw: "stop" },
              usage,
            },
          ])
            controller.enqueue(part);
          controller.close();
        },
      }),
    }),
  });
  const reserve = () => {
    if (state.modelCalls >= 24)
      throw new Error("EVRY_PROCESSING_LIMIT_REACHED");
    state.modelCalls++;
  };
  const model = wrapLanguageModel({
    model: provider,
    middleware: {
      wrapGenerate: async ({ doGenerate }) => {
        reserve();
        return doGenerate();
      },
      wrapStream: async ({ doStream }) => {
        reserve();
        return doStream();
      },
    },
  });
  if (failure === "budget")
    for (let index = 0; index < 23; index++)
      await model.doGenerate({
        prompt: [
          {
            role: "user",
            content: [{ type: "text", text: "Check recorded information." }],
          },
        ],
      });
  warming = false;
  const run = createToolLoopHarness({
    mode,
    tools: new Map(),
    resolveModel: async () => model,
    abortSignal: signal,
    steeringSignal,
    handleEvent: async (event) => {
      events.push(event);
    },
  });
  const session = {
    agent: {
      modelReference: { id: "fixture/32k-context" },
      system: "Answer from recorded information.",
      tools: [],
    },
    sessionId: "compaction-proof",
    continuationToken: "proof",
    history,
    compaction: { recentWindowSize: 10, threshold: 2000 },
  };
  return {
    run,
    session,
    events,
    provider,
    get state() {
      return state;
    },
    get summaryCalls() {
      return summaryCalls;
    },
    retry() {
      recovered = true;
      state = { turnId: "retry", modelCalls: 0 };
    },
  };
}

for (const failure of ["budget", "provider"])
  test(`conversation ${failure} failure inside compaction parks without losing history; explicit retry succeeds`, async () => {
    const f = await fixture(failure);
    const result = await f.run(f.session, {
      message: "Continue reviewing the recorded facts.",
    });
    assert.equal(result.next, null);
    assert.ok(result.settledTurn?.isError);
    assert.deepEqual(result.session.history.slice(0, history.length), history);
    assert.ok(
      f.events.some(
        (event) =>
          event.type === "turn.failed" &&
          event.data.code === "COMPACTION_FAILED"
      )
    );
    assert.equal(
      f.events.filter((event) => event.type === "turn.failed").length,
      1
    );
    assert.ok(!f.events.some((event) => event.type === "session.failed"));
    assert.equal(
      f.summaryCalls,
      1,
      "no automatic summary/provider retry after failure"
    );
    assert.ok(
      result.session.history.some((message) =>
        JSON.stringify(message.content).includes(
          "Continue reviewing the recorded facts."
        )
      )
    );
    if (failure === "budget") assert.equal(f.state.modelCalls, 24);
    f.retry();
    const retry = await f.run(result.session, { message: "Please retry." });
    assert.equal(retry.settledTurn?.isError, undefined);
    assert.ok(
      f.events.some(
        (event) =>
          event.type === "message.appended" &&
          event.data.messageDelta === "Retry completed."
      )
    );
  });

test("task-mode compaction failure still throws", async () => {
  const f = await fixture("provider", "task");
  await assert.rejects(
    f.run(f.session, { message: "Review" }),
    /SCRIPTED_COMPACTION_FAILURE/
  );
});

test("cancellation remains cancellation, without a recoverable failure", async () => {
  const controller = new AbortController();
  controller.abort();
  const f = await fixture("provider", "conversation", controller.signal);
  await assert.rejects(f.run(f.session, { message: "Review" }), /cancelled/i);
  assert.ok(!f.events.some((event) => event.type === "turn.failed"));
});

test("cancellation during compaction remains cancellation", async () => {
  const controller = new AbortController();
  const f = await fixture("provider", "conversation", controller.signal, () =>
    controller.abort()
  );
  await assert.rejects(f.run(f.session, { message: "Review" }), /cancelled/i);
  assert.equal(f.summaryCalls, 1);
  assert.ok(!f.events.some((event) => event.type === "turn.failed"));
});

for (const protectedOutput of [false, true])
  test(`pending steering preserves native output protection: ${protectedOutput}`, async () => {
    const cancellation = new AbortController();
    const steering = new AbortController();
    const f = await fixture(
      "provider",
      "conversation",
      cancellation.signal,
      () => steering.abort(),
      steering.signal
    );
    const session = protectedOutput
      ? setHarnessEmissionState(f.session, {
          sessionStarted: true,
          sequence: 1,
          stepIndex: 1,
          turnId: "existing-turn",
          assistantOutputStarted: true,
        })
      : f.session;
    const result = await f.run(
      session,
      protectedOutput ? undefined : { message: "Review original request" }
    );
    assert.equal(result.steered === true, !protectedOutput);
    assert.equal(
      f.events.filter((event) => event.type === "turn.failed").length,
      Number(protectedOutput)
    );
    if (protectedOutput) assert.equal(result.next, null);
  });
