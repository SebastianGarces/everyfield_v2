import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import {
  COMPOSITION_LIMITS,
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

test("memory cap and a tighter dispatch cap are enforced by the real sandbox", async () => {
  const memory = await runEvryComposition({
    ...base(),
    js: `return new ArrayBuffer(64 * 1024 * 1024).byteLength;`,
    limits: { memoryLimitBytes: 4 * 1024 * 1024 },
  });
  assert.equal(memory.status, "failed");
  let active = 0;
  let highWater = 0;
  const concurrency = await runEvryComposition({
    ...base(),
    registry: fixture(async () => {
      highWater = Math.max(highWater, ++active);
      await new Promise((resolve) => setTimeout(resolve, 20));
      active--;
      return [];
    }),
    js: `return await Promise.all([tools["people.query"]({ids:[]}),tools["people.query"]({ids:[]})]);`,
    limits: { maxConcurrentToolCalls: 1 },
  });
  assert.equal(concurrency.status, "completed");
  assert.equal(concurrency.calls, 2);
  assert.equal(highWater, 1);
});

test("bounded batches retain all eight read results within the production concurrency cap", async () => {
  let active = 0;
  let highWater = 0;
  const count = COMPOSITION_LIMITS.maxConcurrentToolCalls * 2;
  const result = await runEvryComposition({
    ...base(),
    registry: fixture(async (_name, input) => {
      active++;
      highWater = Math.max(highWater, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active--;
      return input;
    }),
    js: `const results = [];
      for (let start = 0; start < ${count}; start += ${COMPOSITION_LIMITS.maxConcurrentToolCalls}) {
        const batch = Array.from({length: ${COMPOSITION_LIMITS.maxConcurrentToolCalls}}, (_, i) => tools["people.query"]({ids: [String(start + i)]}));
        results.push(...await Promise.allSettled(batch));
      }
      return results;`,
  });
  assert.equal(result.status, "completed");
  if (result.status !== "completed") assert.fail("Expected completed batches");
  assert.equal(result.calls, count);
  assert.equal(highWater, COMPOSITION_LIMITS.maxConcurrentToolCalls);
  assert.deepEqual(
    result.output,
    Array.from({ length: count }, (_, i) => ({
      status: "fulfilled",
      value: { ids: [String(i)] },
    }))
  );
});

for (const count of [8, COMPOSITION_LIMITS.maxBridgeRequests]) {
  test(`${count} simultaneous reads queue with four active dispatches and stable identities`, async () => {
    let active = 0;
    let highWater = 0;
    const ids: string[] = [];
    const result = await runEvryComposition({
      ...base(),
      registry: fixture(async (_name, input, invocation) => {
        ids.push(invocation.callId);
        highWater = Math.max(highWater, ++active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return input;
      }),
      js: `return await Promise.allSettled(Array.from({length: ${count}}, (_, i) => tools["people.query"]({ids: [String(i)]})));`,
    });
    assert.deepEqual(result, {
      status: "completed",
      calls: count,
      output: Array.from({ length: count }, (_, i) => ({
        status: "fulfilled",
        value: { ids: [String(i)] },
      })),
    });
    assert.equal(highWater, 4);
    assert.equal(active, 0);
    assert.equal(new Set(ids).size, count);
    assert.deepEqual(
      ids,
      Array.from({ length: count }, (_, i) => `test-call:tool-${i + 1}`)
    );
  });
}

test("the 25th admitted call is terminal even with allSettled and catch", async () => {
  const invoked: string[] = [];
  const result = await runEvryComposition({
    ...base(),
    registry: fixture(async (_name, input, invocation) => {
      invoked.push(invocation.callId);
      await new Promise((resolve) => setTimeout(resolve, 30));
      return input;
    }),
    js: `try { return await Promise.allSettled(Array.from({length:25}, () => tools["people.query"]({ids:[]}))); } catch { return "ignored"; }`,
  });
  assert.equal(result.status, "failed");
  if (result.status !== "failed") assert.fail("Expected terminal limit");
  assert.equal(result.reason, "limit");
  assert.ok(result.calls <= 4);
  assert.ok(!invoked.includes("test-call:tool-25"));
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(invoked.length, result.calls);
});

test("tightening dispatch never expands the production bound of twenty queued requests", async () => {
  const release = Promise.withResolvers<void>();
  let calls = 0;
  try {
    const result = await runEvryComposition({
      ...base(),
      limits: { maxConcurrentToolCalls: 1 },
      registry: fixture(async () => {
        calls++;
        await release.promise;
        return [];
      }),
      js: `return await Promise.allSettled(Array.from({length:22}, () => tools["people.query"]({ids:[]})));`,
    });
    assert.deepEqual(result, { status: "failed", reason: "limit", calls: 1 });
    assert.equal(calls, 1);
  } finally {
    release.resolve();
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(calls, 1);
});

test("parallel queued calls cannot overdraw the shared 48-call turn allowance", async () => {
  const budget = createCompositionBudget();
  for (let i = 0; i < 45; i++) budget.consume();
  let invoked = 0;
  const result = await runEvryComposition({
    ...base(),
    budget,
    registry: fixture(async () => {
      invoked++;
      return [];
    }),
    js: `return await Promise.allSettled(Array.from({length:8}, () => tools["people.query"]({ids:[]})));`,
  });
  assert.deepEqual(result, { status: "failed", reason: "limit", calls: 3 });
  assert.equal(invoked, 3);
  assert.equal(budget.used, 48);
  assert.deepEqual(
    await runEvryComposition({
      ...base(),
      budget,
      js: `try { await tools["people.query"]({ids:[]}); } catch {} return "ignored";`,
    }),
    { status: "failed", reason: "limit", calls: 0 }
  );
});

for (const termination of ["abort", "timeout", "early-return"] as const) {
  test(
    `real sandbox ${termination} cancels queued work and ignores late releases`,
    { timeout: 5_000 },
    async () => {
      const controller = new AbortController();
      const started = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const budget = createCompositionBudget();
      const signals: AbortSignal[] = [];
      let invoked = 0;
      const run = runEvryComposition({
        ...base(),
        budget,
        signal: controller.signal,
        limits: { timeoutMs: 700 },
        registry: fixture(async (_name, input, invocation) => {
          assert.ok(invocation.signal);
          signals.push(invocation.signal);
          invoked++;
          if (invoked === 4) started.resolve();
          // Deliberately ignores abort to exercise host work finishing after teardown.
          await release.promise;
          return input;
        }),
        js:
          termination === "early-return"
            ? `const pending = Array.from({length:8}, () => tools["people.query"]({ids:[]})); return "detached";`
            : `return await Promise.allSettled(Array.from({length:8}, () => tools["people.query"]({ids:[]})));`,
      });
      try {
        if (termination === "abort") {
          await started.promise;
          await new Promise((resolve) => setTimeout(resolve, 30));
          controller.abort();
        }
        const result = await run;
        assert.equal(result.status, "failed");
        if (result.status !== "failed")
          assert.fail("Expected terminal failure");
        assert.equal(
          result.reason,
          termination === "abort"
            ? "cancelled"
            : termination === "timeout"
              ? "limit"
              : "program_failed"
        );
        assert.ok(invoked <= 4);
        if (termination !== "early-return") assert.equal(invoked, 4);
        assert.equal(budget.used, invoked);
        assert.ok(signals.every((signal) => signal.aborted));
        release.resolve();
        await new Promise((resolve) => setTimeout(resolve, 30));
        assert.equal(invoked, result.calls);
        assert.equal(budget.used, result.calls);
      } finally {
        controller.abort();
        release.resolve();
        await run;
      }
    }
  );
}

test("queued dispatch re-enters the registry after revocation and frees failed slots without leaking errors", async () => {
  let allowed = true;
  let attempts = 0;
  let active = 0;
  let highWater = 0;
  const result = await runEvryComposition({
    ...base(),
    registry: fixture(async () => {
      attempts++;
      highWater = Math.max(highWater, ++active);
      try {
        // A registry stub proves dispatch timing, not production database authorization.
        if (!allowed) throw new Error("private revocation person@example.test");
        await new Promise((resolve) => setTimeout(resolve, 20));
        allowed = false;
        return { visible: true };
      } finally {
        active--;
      }
    }),
    js: `return (await Promise.allSettled(Array.from({length:8}, () => tools["people.query"]({ids:[]})))).map(r => r.status === "fulfilled" ? r.value : {error: r.reason.message});`,
  });
  assert.equal(result.status, "completed");
  assert.equal(result.calls, 8);
  assert.equal(attempts, 8);
  assert.equal(highWater, 4);
  assert.equal(active, 0);
  if (result.status !== "completed") assert.fail("Expected settled results");
  assert.deepEqual(result.output, [
    ...Array(4).fill({ visible: true }),
    ...Array(4).fill({ error: "Host tool failed." }),
  ]);
  assert.doesNotMatch(JSON.stringify(result), /private|person@/);
});

test("one failed read frees its slot and allSettled retains the other seven outcomes", async () => {
  const result = await runEvryComposition({
    ...base(),
    registry: fixture(async (_name, input) => {
      const { ids } = z.object({ ids: z.array(z.string()) }).parse(input);
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (ids[0] === "0") throw new Error("provider secret");
      return ids[0];
    }),
    js: `return (await Promise.allSettled(Array.from({length:8}, (_, i) => tools["people.query"]({ids:[String(i)]})))).map(r => r.status === "fulfilled" ? r.value : r.reason.message);`,
  });
  assert.deepEqual(result, {
    status: "completed",
    calls: 8,
    output: ["Host tool failed.", "1", "2", "3", "4", "5", "6", "7"],
  });
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
  for (const limits of [
    { maxConcurrentToolCalls: 5 },
    { maxBridgeRequests: 25 },
  ]) {
    await assert.rejects(
      runEvryComposition({ ...base(), js: "return 1", limits }),
      /Invalid composition limit/
    );
  }
  const [description] = describeCompositionTools(fixture());
  assert.equal(description.name, "people.query");
  assert.equal(description.inputSchema.type, "object");
  assert.throws(() => createCompositionBudget(49), /budget/);
});
