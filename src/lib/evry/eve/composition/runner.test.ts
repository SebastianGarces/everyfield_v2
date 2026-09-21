import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  createCompositionBudget,
  describeCompositionTools,
  runEvryComposition,
  type CompositionRegistry,
  type CompositionTrace,
} from "./runner";

function fixture(
  handler: CompositionRegistry["invoke"] = async (_name, input) => input
): CompositionRegistry {
  return {
    describe: () => [
      {
        name: "people.query",
        description: "Read people",
        effect: "read",
        inputSchema: z.object({ ids: z.array(z.string()) }),
      },
    ],
    invoke: handler,
  };
}
const base = () => ({
  registry: fixture(),
  callId: "test-call",
  budget: createCompositionBudget(),
});

test("real sandbox composes parallel tools and preserves nested call identities", async () => {
  const events: CompositionTrace[] = [];
  let active = 0;
  let highWater = 0;
  const calls: string[] = [];
  const result = await runEvryComposition({
    ...base(),
    registry: fixture(async (_name, input, invocation) => {
      active += 1;
      highWater = Math.max(active, highWater);
      calls.push(invocation.callId);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active -= 1;
      return input;
    }),
    js: `const results = await Promise.all([tools["people.query"]({ids:["a"]}), tools["people.query"]({ids:["b"]})]); return results.flatMap(r => r.ids);`,
    onCall: (event) => events.push(event),
  });
  assert.deepEqual(result, {
    status: "completed",
    output: ["a", "b"],
    calls: 2,
  });
  assert.equal(highWater, 2);
  assert.equal(new Set(calls).size, 2);
  assert.ok(calls.every((id) => id.startsWith("test-call:tool-")));
  assert.equal(
    events.filter((event) => event.status === "succeeded").length,
    2
  );
  assert.ok(
    events.every(
      (event) =>
        !Object.hasOwn(event, "input") && !Object.hasOwn(event, "output")
    )
  );
});

test("sandbox has no ambient process, network, filesystem, or require", async () => {
  const result = await runEvryComposition({
    ...base(),
    js: `return [typeof process, typeof fetch, typeof require, typeof Buffer, typeof WebSocket];`,
  });
  assert.deepEqual(result, {
    status: "completed",
    output: Array(5).fill("undefined"),
    calls: 0,
  });
});

test("imports and constructor tricks cannot reach Node process", async () => {
  for (const js of [
    `return await import("node:fs");`,
    `return ({}).constructor.constructor("return process")();`,
  ]) {
    const result = await runEvryComposition({ ...base(), js });
    assert.equal(result.status, "failed");
  }
});

test("unknown commit tool is unreachable and calls no registry handler", async () => {
  let calls = 0;
  const result = await runEvryComposition({
    ...base(),
    registry: fixture(async () => {
      calls += 1;
    }),
    js: `return await tools.executeApprovedPlan({approved:true});`,
  });
  assert.equal(result.status, "failed");
  assert.equal(calls, 0);
});

test("input schemas reject malformed arguments before dispatch", async () => {
  let called = false;
  const result = await runEvryComposition({
    ...base(),
    registry: fixture(async () => {
      called = true;
    }),
    js: `return await tools["people.query"]({ids:"not-an-array"});`,
  });
  assert.equal(result.status, "failed");
  assert.equal(called, false);
});

test("shared turn budget is not reset between programs and cannot be caught away", async () => {
  const budget = createCompositionBudget(1);
  const options = {
    ...base(),
    budget,
    js: `try { return await tools["people.query"]({ids:[]}); } catch { return "ignored"; }`,
  };
  assert.equal((await runEvryComposition(options)).status, "completed");
  assert.deepEqual(await runEvryComposition(options), {
    status: "failed",
    reason: "limit",
    calls: 0,
  });
  assert.equal(budget.used, 1);
});

test("invalid-input feedback contains only trusted tool and schema field names", async () => {
  const result = await runEvryComposition({
    ...base(),
    registry: {
      describe: () => [
        {
          name: "people.query",
          description: "Read people",
          effect: "read",
          inputSchema: z.strictObject({ ids: z.array(z.string()) }),
        },
      ],
      invoke: async () => {
        throw new Error("must not invoke");
      },
    },
    js: `return await tools["people.query"]({"secret-key-person@example.test":"secret-value-token",ids:"private-input"});`,
  });
  assert.deepEqual(result, {
    status: "failed",
    reason: "invalid_input",
    toolName: "people.query",
    requiredFields: ["ids"],
    calls: 0,
  });
  assert.doesNotMatch(JSON.stringify(result), /secret|private|example/);
});

test("validation feedback bounds trusted schema names and omits custom refinement messages", async () => {
  const schema = z
    .strictObject(
      Object.fromEntries(
        Array.from({ length: 20 }, (_, index) => [`field${index}`, z.string()])
      )
    )
    .refine(() => false, "private refinement diagnostic");
  const result = await runEvryComposition({
    ...base(),
    registry: {
      describe: () => [
        {
          name: "people.query",
          description: "Read people",
          effect: "read",
          inputSchema: schema,
        },
      ],
      invoke: async () => {
        throw new Error("must not invoke");
      },
    },
    js: `return await tools["people.query"](Object.fromEntries(Array.from({length:20},(_,i)=>["field"+i,"sensitive-value"])));`,
  });
  assert.equal(result.status, "failed");
  if (result.status !== "failed" || result.reason !== "invalid_input")
    assert.fail("Expected bounded validation feedback");
  assert.equal(result.requiredFields.length, 16);
  assert.equal(result.calls, 0);
  assert.doesNotMatch(JSON.stringify(result), /private|sensitive/);
});

test("infinite code is interrupted by the real worker deadline", async () => {
  const result = await runEvryComposition({
    ...base(),
    js: `while(true){}`,
    limits: { timeoutMs: 100 },
  });
  assert.deepEqual(result, { status: "failed", reason: "limit", calls: 0 });
});

test("bridge budget, output budget and source budget are enforced", async () => {
  const cases = [
    {
      js: `await tools["people.query"]({ids:[]}); return await tools["people.query"]({ids:[]});`,
      limits: { maxBridgeRequests: 1 },
    },
    { js: `return "a".repeat(10000);`, limits: { maxResultBytes: 100 } },
    { js: `return "a".repeat(10000);`, limits: { maxSourceBytes: 10 } },
  ];
  for (const candidate of cases)
    assert.equal(
      (await runEvryComposition({ ...base(), ...candidate })).status,
      "failed"
    );
});

test("memory and in-flight bridge caps are enforced by the real sandbox", async () => {
  const memory = await runEvryComposition({
    ...base(),
    js: `return new ArrayBuffer(64 * 1024 * 1024).byteLength;`,
    limits: { memoryLimitBytes: 4 * 1024 * 1024 },
  });
  assert.equal(memory.status, "failed");
  const concurrency = await runEvryComposition({
    ...base(),
    registry: fixture(
      async () => new Promise((resolve) => setTimeout(() => resolve([]), 20))
    ),
    js: `return await Promise.all([tools["people.query"]({ids:[]}),tools["people.query"]({ids:[]})]);`,
    limits: { maxInFlightBridgeRequests: 1 },
  });
  assert.equal(concurrency.status, "failed");
});

test("preparation gets a stable trusted nested identity on replay", async () => {
  const ids: string[] = [];
  const registry: CompositionRegistry = {
    describe: () => [
      {
        name: "actions.prepare",
        description: "Prepare only",
        effect: "prepare",
        inputSchema: z.object({ title: z.string() }),
      },
    ],
    invoke: async (_name, _input, invocation) => {
      ids.push(invocation.callId);
      return { review: "ready", sent: false };
    },
  };
  for (let replay = 0; replay < 2; replay += 1) {
    const result = await runEvryComposition({
      ...base(),
      registry,
      js: `return await tools["actions.prepare"]({title:"Orientation"});`,
    });
    assert.equal(result.status, "completed");
  }
  assert.equal(ids.length, 2);
  assert.equal(ids[0], ids[1]);
});

test("each nested call reaches fresh authorization and denial exposes no private error", async () => {
  let attempts = 0;
  const result = await runEvryComposition({
    ...base(),
    registry: fixture(async () => {
      attempts += 1;
      if (attempts > 1)
        throw new Error("permission revoked for private-user-id");
      return [];
    }),
    js: `await tools["people.query"]({ids:[]}); try { await tools["people.query"]({ids:[]}); } catch(e) { return e.message; }`,
  });
  assert.equal(attempts, 2);
  assert.equal(result.status, "completed");
  assert.ok(!JSON.stringify(result).includes("private-user-id"));
});

test("abort reaches the worker and late host work cannot continue a program", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runEvryComposition({
    ...base(),
    signal: controller.signal,
    js: `return 1;`,
  });
  assert.deepEqual(result, { status: "failed", reason: "cancelled", calls: 0 });
});

test("tool exceptions and broken telemetry cannot leak raw provider data", async () => {
  const options = {
    ...base(),
    registry: fixture(async () => {
      throw new Error("secret-token and person@example.test");
    }),
    js: `return await tools["people.query"]({ids:[]});`,
    onCall() {
      throw new Error("telemetry failed");
    },
  };
  const result = await runEvryComposition(options);
  assert.deepEqual(result, {
    status: "failed",
    reason: "program_failed",
    calls: 1,
  });
  assert.ok(!JSON.stringify(result).includes("secret"));
});

test("trusted limits cannot be widened and descriptions derive from the registry schema", async () => {
  await assert.rejects(
    runEvryComposition({
      ...base(),
      js: "return 1",
      limits: { timeoutMs: 16_000 },
    }),
    /Invalid composition limit/
  );
  const [description] = describeCompositionTools(fixture());
  assert.equal(description.name, "people.query");
  assert.equal(description.inputSchema.type, "object");
  assert.throws(() => createCompositionBudget(49), /budget/);
});
