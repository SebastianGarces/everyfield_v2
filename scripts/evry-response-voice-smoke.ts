import assert from "node:assert/strict";
import { wrapLanguageModel } from "ai";
import { generateEvryModelResponse } from "@/lib/evry/capabilities/model-response";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import {
  getEvryPolicyModel,
  EVRY_POLICY_MODEL_ID,
} from "@/lib/evry/models/provider";
import {
  evryModelCandidate,
  calculateEvryModelCostUsd,
} from "@/lib/evry/models/candidates";

// Synthetic context only. No database readers, messages, plans or effects.
// node --env-file=.env.local --import tsx scripts/evry-response-voice-smoke.ts --live
async function main() {
  assert.ok(
    process.argv.includes("--live"),
    "Pass --live to allow six paid response checks."
  );
  const candidate = evryModelCandidate(EVRY_POLICY_MODEL_ID);
  const provider = getEvryPolicyModel();
  assert.ok(
    candidate &&
      typeof provider !== "string" &&
      provider.specificationVersion === "v3"
  );
  const budgetUsd = 0.1;
  let reservedUsd = 0;
  let costUsd = 0;
  let calls = 0;
  const model = wrapLanguageModel({
    model: provider,
    middleware: {
      specificationVersion: "v3",
      async wrapStream({ params, doStream }) {
        assert.equal(params.providerOptions?.openai?.store, false);
        assert.ok(calls < 6);
        const ceiling =
          ((Buffer.byteLength(JSON.stringify(params)) + 4096) *
            candidate.pricePerMillionTokens.input +
            3000 * candidate.pricePerMillionTokens.output) /
          1_000_000;
        assert.ok(
          reservedUsd + ceiling <= budgetUsd,
          "Cost cap reached before call."
        );
        reservedUsd += ceiling;
        calls++;
        const result = await doStream();
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                if (chunk.type === "finish") {
                  const input = chunk.usage.inputTokens;
                  const output = chunk.usage.outputTokens;
                  assert.ok(
                    input.total !== undefined && output.total !== undefined
                  );
                  costUsd += calculateEvryModelCostUsd({
                    candidate,
                    inputUncachedTokens:
                      input.noCache ?? input.total - (input.cacheRead ?? 0),
                    inputCacheReadTokens: input.cacheRead ?? 0,
                    inputCacheWriteTokens: input.cacheWrite ?? 0,
                    outputTokens: output.total,
                  });
                }
                controller.enqueue(chunk);
              },
            })
          ),
        };
      },
    },
  });
  const cases = [
    {
      request: "My pending tasks due today, excluding overdue",
      count: 2,
      title: "Tasks",
      filters: {
        assignedTo: "me",
        statuses: ["not_started", "in_progress", "blocked"],
        due: "today",
        timeZone: "America/New_York",
        nextCursor: null,
      },
      expected: /2|two/i,
      maxWords: 45,
    },
    {
      request: "Only high priority",
      count: 1,
      title: "Tasks",
      filters: {
        assignedTo: "me",
        statuses: ["not_started", "in_progress", "blocked"],
        due: "today",
        priority: "high",
        timeZone: "America/New_York",
        nextCursor: null,
      },
      expected: /1|one/i,
      maxWords: 45,
    },
    {
      request:
        "Which prospects have completed follow-up but no interview recorded?",
      count: 0,
      title: "Prospects",
      filters: {
        stage: "prospect",
        interview: "not_recorded",
        followUp: "completed",
        evidence:
          "A completed person-linked task, not a meeting attribution. No record is not proof an event never happened outside EveryField.",
        nextCursor: null,
      },
      expected: /no |none|0|zero/i,
      maxWords: 55,
    },
    {
      request: "Can you give me a list of core team members?",
      count: 8,
      title: "Core Group",
      filters: { stage: "core_group", nextCursor: null },
      expected: /8|eight/i,
      maxWords: 45,
    },
    {
      request:
        "Can you tell me the difference between 4C assessments and prospect interviews?",
      count: null,
      title: "Product help",
      filters: {},
      expected: /assessment[\s\S]*interview|interview[\s\S]*assessment/i,
      maxWords: 150,
    },
    {
      request: "Which prospects should I interview first and why?",
      count: 2,
      title: "Prospects",
      filters: {
        interview: "not_recorded",
        recentAttendance: true,
        coverage:
          "Only two prospects could be checked; the remaining records were unavailable.",
      },
      expected: /attend/i,
      maxWords: 100,
    },
  ];
  for (const sample of cases) {
    const results =
      sample.count === null
        ? []
        : [
            buildEvryReadArtifact({
              title: sample.title,
              filters: [],
              exclusions: [],
              sourceLinks: [],
              items: Array.from({ length: sample.count }, (_, index) => ({
                id: `sample-${index}`,
                label: `Sample ${index + 1}`,
                facts: [],
                sourceLink: trustedEvryApplicationSourceLink({
                  label: "Tasks",
                  href: "/tasks",
                }),
              })),
            }),
          ];
    const response = await generateEvryModelResponse(
      {
        context: {
          latestRequest: sample.request,
          conversation: {
            previousRequest: "My pending tasks due today, excluding overdue",
          },
          freshReadResults: results.map((artifact) => ({
            readId: "synthetic.query",
            input: sample.filters,
            artifact,
          })),
        },
        draft: "Answer the requested question using the available evidence.",
        results,
      },
      () => model
    );
    const words = response.body.split(/\s+/).length;
    console.log(
      JSON.stringify({
        request: sample.request,
        response: response.body,
        words,
        resultCards: response.artifacts.length,
      })
    );
    assert.match(response.body, sample.expected);
    assert.ok(words <= sample.maxWords, `Response too long: ${words} words.`);
    assert.doesNotMatch(
      response.body,
      /next page|nextCursor|page cursor|America\/New_York|not_started|core_group|person-linked|all matching records were returned/i
    );
    if (sample.count === null)
      assert.doesNotMatch(
        response.body,
        /current records|records provided|no.*entries|anyone.s.*history/i
      );
    if (sample.filters.coverage)
      assert.match(
        response.body,
        /only|partial|some|couldn.t|could not|remaining|unable|unavailable|incomplete/i
      );
  }
  console.log(
    JSON.stringify({ status: "passed", calls, costUsd, reservedUsd, budgetUsd })
  );
}

main().catch(() => {
  console.error(
    "Response voice smoke failed; inspect synthetic outputs above. No automatic retry."
  );
  process.exitCode = 1;
});
