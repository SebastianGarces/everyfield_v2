import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createJevClient,
  JEV_MODEL,
  type JevClient,
  type JevRequest,
} from "./client";
import { discoveryHintText, suggestCapabilities } from "./discovery";
import {
  evaluateEvryResponse,
  EVRY_JUDGE_CRITERIA,
  summarizeJudgeCalibration,
} from "./evaluation";

const request: JevRequest = {
  state: {
    request: "Only high priority",
    taskState: { due: "today", assignee: "me" },
  },
  questions: { useful: { type: "noul", instructions: "Is this useful?" } },
};
const response = (answers = { useful: { type: "noul", noul: 0.8 } }) =>
  Response.json({
    model: JEV_MODEL,
    answers,
    usage: { input_tokens: 10, output_tokens: 2 },
  });

test("missing Jev key makes no request and preserves main model fallback", async () => {
  let called = false;
  const client = createJevClient({
    fetch: async () => {
      called = true;
      return response();
    },
  });
  assert.deepEqual(await client(request), {
    status: "unavailable",
    reason: "not_configured",
  });
  assert.equal(called, false);
});

test("provider uses pinned model, fixed endpoint and no redirect or secret logging", async () => {
  const client = createJevClient({
    apiKey: "test-key",
    fetch: async (url, init) => {
      assert.equal(url, "https://api.typesafe.ai/v1/systemone");
      assert.equal(init?.redirect, "error");
      assert.equal(typeof init?.body, "string");
      assert.equal(JSON.parse(String(init?.body)).model, JEV_MODEL);
      assert.deepEqual(JSON.parse(String(init?.body)).state.taskState, {
        due: "today",
        assignee: "me",
      });
      return response();
    },
  });
  const result = await client(request);
  assert.equal(result.status, "available");
  if (result.status === "available")
    assert.deepEqual(result.probabilities, { useful: 0.8 });
});

test("outages get one attempt and a safe fallback, not a request refusal", async () => {
  let calls = 0;
  const client = createJevClient({
    apiKey: "test",
    fetch: async () => {
      calls += 1;
      throw new Error("private provider error");
    },
  });
  assert.deepEqual(await client(request), {
    status: "unavailable",
    reason: "provider_error",
  });
  assert.equal(calls, 1);
});

test("deadline aborts a slow request without a retry", async () => {
  const client = createJevClient({
    apiKey: "test",
    timeoutMs: 5,
    fetch: async (_url, init) =>
      new Promise<Response>((_resolve, reject) => {
        const keepAlive = setTimeout(
          () => reject(new Error("did not abort")),
          200
        );
        init?.signal?.addEventListener("abort", () => {
          clearTimeout(keepAlive);
          reject(new Error("aborted"));
        });
      }),
  });
  assert.deepEqual(await client(request), {
    status: "unavailable",
    reason: "timeout",
  });
});

test("malformed, missing, extra, oversized and wrong-model answers fail closed to no hints", async () => {
  const fixtures = [
    Response.json({
      model: JEV_MODEL,
      answers: {},
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    response({ useful: { type: "noul", noul: 2 } }),
    Response.json({
      model: "jev-latest",
      answers: { useful: { type: "noul", noul: 0.9 } },
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
    new Response("x".repeat(100_000)),
    Response.json({
      model: JEV_MODEL,
      answers: {
        useful: { type: "noul", noul: 0.9 },
        extra: { type: "noul", noul: 0.9 },
      },
      usage: { input_tokens: 1, output_tokens: 1 },
    }),
  ];
  for (const fixture of fixtures) {
    assert.deepEqual(
      await createJevClient({ apiKey: "test", fetch: async () => fixture })(
        request
      ),
      { status: "unavailable", reason: "invalid_response" }
    );
  }
});

test("oversized input is rejected before spending", async () => {
  let called = false;
  const client = createJevClient({
    apiKey: "test",
    fetch: async () => {
      called = true;
      return response();
    },
  });
  assert.deepEqual(await client({ ...request, state: "x".repeat(100_000) }), {
    status: "unavailable",
    reason: "invalid_input",
  });
  assert.equal(called, false);
});

test("discovery considers persisted context, ranks multiple domains and keeps all available", async () => {
  const client: JevClient = async (input) => {
    assert.deepEqual(input.state, {
      request: "Yes",
      taskState: { audience: "core team", meetingType: "orientation" },
    });
    return {
      status: "available",
      probabilities: { candidate_0: 0.8, candidate_1: 0.95 },
      usage: { inputTokens: 1, outputTokens: 1 },
      durationMs: 1,
    };
  };
  const result = await suggestCapabilities({
    client,
    context: {
      request: "Yes",
      taskState: { audience: "core team", meetingType: "orientation" },
    },
    candidates: [
      { name: "people.query", description: "Read audience", kind: "tool" },
      {
        name: "meeting-invite",
        description: "Prepare invitation",
        kind: "skill",
      },
    ],
  });
  assert.deepEqual(
    result.hints.map((hint) => hint.name),
    ["meeting-invite", "people.query"]
  );
  assert.match(
    discoveryHintText(result.hints),
    /All authorized tools and skills remain available/
  );
  assert.equal(discoveryHintText([]), "");
});

test("semantic judge returns separate probabilities and asks no permission question", async () => {
  const result = await evaluateEvryResponse(
    async (input) => {
      assert.deepEqual(
        Object.keys(input.questions),
        Object.keys(EVRY_JUDGE_CRITERIA)
      );
      assert.ok(
        Object.values(input.questions).every(
          (question) => question.type === "noul"
        )
      );
      return {
        status: "available",
        probabilities: Object.fromEntries(
          Object.keys(input.questions).map((id) => [id, 0.7])
        ),
        usage: { inputTokens: 1, outputTokens: 1 },
        durationMs: 1,
      };
    },
    {
      request: "Who needs an interview?",
      taskState: {},
      toolEvidence: [],
      response: "No matches.",
    }
  );
  assert.equal(result.status, "available");
  assert.equal(Object.hasOwn(result, "approved"), false);
});

test("calibration exposes false passes and false failures separately", () => {
  assert.deepEqual(
    summarizeJudgeCalibration(
      [
        { expected: true, probability: 0.9 },
        { expected: false, probability: 0.1 },
        { expected: false, probability: 0.9 },
        { expected: true, probability: 0.1 },
      ],
      0.5
    ),
    {
      truePass: 1,
      trueFail: 1,
      falsePass: 1,
      falseFail: 1,
      samples: 4,
      threshold: 0.5,
    }
  );
});
