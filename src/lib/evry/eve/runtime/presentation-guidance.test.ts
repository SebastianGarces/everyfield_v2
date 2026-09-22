import assert from "node:assert/strict";
import { test } from "node:test";
import { generateText, wrapLanguageModel } from "ai";
import { MockLanguageModelV4 } from "ai/test";
import { compactMessages } from "../../../../../node_modules/eve/dist/src/harness/compaction.js";
import {
  presentationGuidanceMiddleware,
  projectPresentationHistory,
} from "./presentation-guidance";

const usage = {
  inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
  outputTokens: { total: 1, text: 1, reasoning: 0 },
};
type Prompt = Parameters<typeof projectPresentationHistory>[0];
const old = "call_old:tool-1";
const fresh = "call_current";
const unknown = "call_untrusted";

function state() {
  return {
    turnId: "new",
    results: [{ turnId: "new", reference: fresh, capability: "tasks.query" }],
    issuedReferences: [old, fresh],
  };
}

test("exact issued raw and encoded handles are retired, not unknown handles, UUIDs, longer tokens or user text", () => {
  const prompt: Prompt = [
    { role: "system", content: `Policy quotes ${old}` },
    {
      role: "user",
      content: [
        {
          type: "text",
          text: `Summary of our conversation so far: [[evry-result:${old}]]`,
        },
      ],
    },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Jordan has 4 tasks. [[evry-result:${encodeURIComponent(old)}]] Raw ${old}; sentence ${old}. Next sentence. current [[evry-result:${fresh}]] unknown [[evry-result:${unknown}]] longer ${old}-extra dotted ${old}.extra UUID 11111111-1111-4111-8111-111111111111.`,
        },
      ],
    },
  ];
  const before = structuredClone(prompt);
  const result = projectPresentationHistory(prompt, state());
  assert.equal(result[0], prompt[0]);
  assert.equal(result[1], prompt[1]);
  assert.deepEqual(prompt, before);
  const text = JSON.stringify(result[2]);
  assert.match(text, /Jordan has 4 tasks/);
  assert.match(text, /Earlier result card omitted/);
  assert.match(text, /retired card reference/);
  assert.ok(text.includes(`[[evry-result:${fresh}]]`));
  assert.ok(text.includes(`[[evry-result:${unknown}]]`));
  assert.ok(text.includes(`${old}-extra`));
  assert.ok(text.includes(`${old}.extra`));
  assert.ok(text.includes("sentence [retired card reference]. Next sentence."));
  assert.ok(text.includes("11111111-1111-4111-8111-111111111111"));
});

test("aliased code output is projected while native protocol, preparation and approval data remain unchanged", () => {
  const prompt: Prompt = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: old,
          toolName: "code_mode",
          input: { source: old },
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: old,
          toolName: "code_mode",
          output: {
            type: "json",
            value: {
              arbitraryAlias: old,
              nested: [encodeURIComponent(old), "call_old%3atool-1"],
              record: { id: "person-1", name: "Jordan", score: 4 },
              current: fresh,
              unknown,
            },
          },
        },
        { type: "tool-approval-response", approvalId: old, approved: true },
        {
          type: "tool-result",
          toolCallId: "prepare",
          toolName: "actions_prepare",
          output: {
            type: "json",
            value: {
              activePlan: { planId: "plan-id", fingerprint: old },
              confirmation: "unchanged",
            },
          },
        },
      ],
    },
  ];
  const before = structuredClone(prompt);
  const result = projectPresentationHistory(prompt, state());
  assert.deepEqual(result[0], prompt[0]);
  const tool = result[1];
  assert.equal(tool.role, "tool");
  if (tool.role !== "tool") assert.fail("Expected tool output");
  assert.equal(tool.content[0].type, "tool-result");
  const first = tool.content[0];
  if (first.type !== "tool-result") assert.fail("Expected result");
  assert.equal(first.toolCallId, old);
  assert.deepEqual(first.output, {
    type: "json",
    value: {
      arbitraryAlias: "[retired card reference]",
      nested: ["[retired card reference]", "[retired card reference]"],
      record: { id: "person-1", name: "Jordan", score: 4 },
      current: fresh,
      unknown,
    },
  });
  assert.deepEqual(tool.content.slice(1), prompt[1].content.slice(1));
  assert.deepEqual(prompt, before);
});

test("current-turn handles also retire when their native artifacts are evicted", () => {
  const prompt: Prompt = [
    {
      role: "assistant",
      content: [{ type: "text", text: `[[evry-result:${fresh}]]` }],
    },
  ];
  assert.deepEqual(projectPresentationHistory(prompt, state()), prompt);
  const evicted = { ...state(), results: [] };
  assert.match(
    JSON.stringify(projectPresentationHistory(prompt, evicted)),
    /Earlier result card omitted/
  );
  assert.deepEqual(
    projectPresentationHistory(prompt, { ...evicted, issuedReferences: [] }),
    prompt
  );
});

test("code-mode key aliases and generated programs retire without merging groups or touching confirmation input", () => {
  const another = "call_another";
  const prompt: Prompt = [
    {
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: old,
          toolName: "code_mode",
          input: { js: `return { card: '${old}' };` },
        },
        {
          type: "tool-call",
          toolCallId: "prepare",
          toolName: "actions_prepare",
          input: { description: old, fingerprint: old },
        },
        {
          type: "text",
          text: `[[evry-result:call_old%3atool-1]] [[evry-result:${fresh}]] [[evry-result:unknown%3acard]]`,
        },
      ],
    },
    {
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolName: "code_mode",
          toolCallId: old,
          output: {
            type: "json",
            value: {
              [old]: ["Jordan"],
              [another]: ["Alex"],
              "[retired card reference]": ["Existing data"],
              [fresh]: ["Current record"],
            },
          },
        },
      ],
    },
  ];
  const result = projectPresentationHistory(prompt, {
    ...state(),
    issuedReferences: [...state().issuedReferences, another],
  });
  const assistant = result[0];
  assert.equal(assistant.role, "assistant");
  if (assistant.role !== "assistant") assert.fail("Expected assistant");
  const code = assistant.content[0];
  assert.equal(code.type, "tool-call");
  if (code.type !== "tool-call") assert.fail("Expected call");
  assert.equal(code.toolCallId, old);
  assert.deepEqual(code.input, {
    js: "return { card: '[retired card reference]' };",
  });
  assert.deepEqual(assistant.content[1], prompt[0].content[1]);
  assert.match(
    JSON.stringify(assistant.content[2]),
    /Earlier result card omitted/
  );
  assert.ok(JSON.stringify(assistant.content[2]).includes("unknown%3acard"));
  const tool = result[1];
  assert.equal(tool.role, "tool");
  if (tool.role !== "tool") assert.fail("Expected tool");
  const part = tool.content[0];
  if (part.type !== "tool-result") assert.fail("Expected result");
  assert.deepEqual(part.output, {
    type: "json",
    value: {
      "[retired card reference] 1": ["Jordan"],
      "[retired card reference] 2": ["Alex"],
      "[retired card reference]": ["Existing data"],
      [fresh]: ["Current record"],
    },
  });
});

test("actual generate and stream provider calls project each fresh state without changing model output or saved history", async () => {
  const current = state();
  const provider = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: "Answer" }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    }),
    doStream: async () => ({
      stream: new ReadableStream({
        start(controller) {
          controller.enqueue({
            type: "text-delta",
            id: "answer",
            delta: "Streamed",
          });
          controller.close();
        },
      }),
    }),
  });
  const model = wrapLanguageModel({
    model: provider,
    middleware: presentationGuidanceMiddleware(() => current),
  });
  const prompt: Prompt = [
    { role: "user", content: [{ type: "text", text: `Literal ${old}` }] },
    {
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Evidence. [[evry-result:${old}]] [[evry-result:${fresh}]]`,
        },
      ],
    },
  ];
  const saved = structuredClone(prompt);
  assert.deepEqual((await model.doGenerate({ prompt })).content, [
    { type: "text", text: "Answer" },
  ]);
  const first = provider.doGenerateCalls[0].prompt;
  assert.equal(first.length, prompt.length);
  assert.deepEqual(first[0], prompt[0]);
  assert.ok(JSON.stringify(first[1]).includes(`[[evry-result:${fresh}]]`));
  assert.ok(!JSON.stringify(first[1]).includes(old));
  current.turnId = "next";
  const streamed = await model.doStream({ prompt });
  const reader = streamed.stream.getReader();
  assert.deepEqual((await reader.read()).value, {
    type: "text-delta",
    id: "answer",
    delta: "Streamed",
  });
  assert.equal((await reader.read()).done, true);
  assert.ok(
    !JSON.stringify(provider.doStreamCalls[0].prompt[1]).includes(fresh)
  );
  assert.deepEqual(provider.doStreamCalls[0].prompt[0], prompt[0]);
  assert.deepEqual(prompt, saved);
});

test("actual installed Eve compaction yields an assistant checkpoint that is scrubbed before the answering provider", async () => {
  const summary = `Retained person Jordan, 4 tasks. Alias ${old}. [[evry-result:${encodeURIComponent(old)}]]`;
  const provider = new MockLanguageModelV4({
    doGenerate: async () => ({
      content: [{ type: "text", text: summary }],
      finishReason: { unified: "stop", raw: "stop" },
      usage,
      warnings: [],
    }),
  });
  const model = wrapLanguageModel({
    model: provider,
    middleware: presentationGuidanceMiddleware(() => state()),
  });
  const messages: Parameters<typeof compactMessages>[0] = [];
  for (let index = 0; index < 25; index++) {
    messages.push({
      role: "user",
      content: `User ${index} ${"preserved context ".repeat(150)}`,
    });
    messages.push({
      role: "assistant",
      content: `Answer ${index} ${"known facts ".repeat(150)}`,
    });
  }
  messages.push({
    role: "user",
    content: `Literal user ${old} must stay unchanged.`,
  });
  const before = structuredClone(messages);
  const compacted = await compactMessages(
    messages,
    model,
    { recentWindowSize: 2, threshold: 2000 },
    undefined,
    undefined,
    undefined,
    undefined,
    true
  );
  assert.equal(provider.doGenerateCalls.length, 1);
  assert.equal(compacted[1].role, "assistant");
  assert.equal(compacted[1].content, summary);
  await generateText({ model, messages: compacted });
  const actual = provider.doGenerateCalls[1].prompt;
  const checkpoint = actual.find((message) => message.role === "assistant");
  assert.ok(checkpoint);
  assert.ok(!JSON.stringify(checkpoint).includes(old));
  assert.ok(!JSON.stringify(checkpoint).includes(encodeURIComponent(old)));
  assert.match(JSON.stringify(checkpoint), /Retained person Jordan, 4 tasks/);
  assert.ok(
    actual.some(
      (message) =>
        message.role === "user" &&
        JSON.stringify(message.content).includes(
          `Literal user ${old} must stay unchanged.`
        )
    )
  );
  assert.deepEqual(messages, before);
  assert.equal(compacted[1].content, summary);
});

test("growing issued-reference metadata stays out of the prompt and projects a bounded long history", (context) => {
  const timings: { issued: number; bytes: number; projectionMs: number }[] = [];
  for (const size of [100, 1_000, 10_000]) {
    const issuedReferences = Array.from(
      { length: size },
      (_, index) => `call_${String(index).padStart(8, "0")}:native_read`
    );
    const first = issuedReferences[0];
    const last = issuedReferences.at(-1);
    assert.ok(first && last);
    const retainedEvidence = "Jordan has 4 pending tasks. ".repeat(8_000);
    const prompt: Prompt = [
      { role: "user", content: [{ type: "text", text: first }] },
      {
        role: "assistant",
        content: [
          {
            type: "text",
            text: `${first}. ${retainedEvidence}[[evry-result:${encodeURIComponent(last)}]]`,
          },
        ],
      },
    ];
    const started = performance.now();
    const result = projectPresentationHistory(prompt, {
      turnId: "new",
      results: [],
      issuedReferences,
    });
    const elapsed = performance.now() - started;
    assert.equal(result[0], prompt[0]);
    const assistant = result[1];
    assert.equal(assistant.role, "assistant");
    assert.deepEqual(assistant.content, [
      {
        type: "text",
        text: `[retired card reference]. ${retainedEvidence}[Earlier result card omitted]`,
      },
    ]);
    assert.equal(issuedReferences.length, size);
    const bytes = Buffer.byteLength(JSON.stringify(issuedReferences));
    assert.equal(bytes, size * 28 + 1);
    // A generous regression ceiling, not a production latency guarantee or cap.
    assert.ok(elapsed < 5_000, `Projection took ${elapsed.toFixed(1)}ms`);
    timings.push({ issued: size, bytes, projectionMs: Math.round(elapsed) });
  }
  context.diagnostic(JSON.stringify(timings));
});
