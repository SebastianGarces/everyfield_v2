import assert from "node:assert/strict";
import { wrapLanguageModel, type LanguageModelMiddleware } from "ai";
import { z } from "zod";
import { generateEvryModelTurn } from "@/lib/evry/capabilities/model-turn";
import { generateEvryModelResponse } from "@/lib/evry/capabilities/model-response";
import { createEvryReadBudget } from "@/lib/evry/capabilities/read-budget";
import {
  buildEvryReadArtifact,
  trustedEvryApplicationSourceLink,
} from "@/lib/evry/artifacts/core";
import type { EvryReadArtifact } from "@/lib/evry/artifacts/types";
import { PRODUCTION_EVRY_MODEL_READS } from "@/lib/evry/capabilities/production";
import { tasksQueryShape } from "@/lib/evry/capabilities/queries/operations-tasks";
import { peopleQuerySchema } from "@/lib/evry/capabilities/queries/people-query-sql";
import {
  EVRY_POLICY_MODEL_ID,
  getEvryPolicyModel,
} from "@/lib/evry/models/provider";
import {
  calculateEvryModelCostUsd,
  evryModelCandidate,
} from "@/lib/evry/models/candidates";

// Opt-in paid contract smoke. Never executes application readers or effects.
// node --env-file=.env.local --import tsx scripts/evry-query-model-smoke.ts --live
async function main() {
  assert.ok(
    process.argv.includes("--live"),
    "Pass --live to permit paid calls."
  );
  const candidate = evryModelCandidate(EVRY_POLICY_MODEL_ID);
  assert.ok(candidate);
  const provider = getEvryPolicyModel();
  assert.ok(
    typeof provider !== "string" && provider.specificationVersion === "v3"
  );
  const budgetUsd = 0.05;
  let calls = 0;
  let reservedUsd = 0;
  let estimatedActualUsd = 0;
  const outcomes: { request: string; status: string }[] = [];
  type Generate = Parameters<
    NonNullable<LanguageModelMiddleware["wrapGenerate"]>
  >[0];
  type Usage = Awaited<ReturnType<Generate["doGenerate"]>>["usage"];
  const reserve = (params: Generate["params"], maxOutputTokens: number) => {
    assert.equal(params.providerOptions?.openai?.store, false);
    assert.equal(params.maxOutputTokens, maxOutputTokens);
    assert.ok(calls < 10, "Maximum ten calls, no provider retries.");
    const ceiling =
      ((Buffer.byteLength(JSON.stringify(params)) + 4096) *
        candidate.pricePerMillionTokens.input +
        maxOutputTokens * candidate.pricePerMillionTokens.output) /
      1_000_000;
    assert.ok(
      reservedUsd + ceiling <= budgetUsd,
      "Cost ceiling reached; no call made."
    );
    reservedUsd += ceiling;
    return { call: ++calls, started: performance.now() };
  };
  const record = (usage: Usage, call: number, started: number) => {
    const input = usage.inputTokens;
    const output = usage.outputTokens;
    assert.ok(input.total !== undefined && output.total !== undefined);
    const costUsd = calculateEvryModelCostUsd({
      candidate,
      inputUncachedTokens:
        input.noCache ?? input.total - (input.cacheRead ?? 0),
      inputCacheReadTokens: input.cacheRead ?? 0,
      inputCacheWriteTokens: input.cacheWrite ?? 0,
      outputTokens: output.total,
    });
    estimatedActualUsd += costUsd;
    console.log(
      JSON.stringify({
        call,
        model: EVRY_POLICY_MODEL_ID,
        inputTokens: input.total,
        outputTokens: output.total,
        costUsd,
        latencyMs: Math.round(performance.now() - started),
      })
    );
  };
  const model = wrapLanguageModel({
    model: provider,
    middleware: {
      specificationVersion: "v3",
      async wrapGenerate({ doGenerate, params }) {
        const { call, started } = reserve(params, 1500);
        const result = await doGenerate();
        record(result.usage, call, started);
        // The opt-in fixture sends synthetic context only. Record the model's
        // wire decision, never provider headers/errors or environment values,
        // so protocol failures remain diagnosable before application parsing.
        console.log(
          JSON.stringify({
            call,
            wireOutput: result.content.flatMap((part) =>
              part.type === "text" ? [part.text] : []
            ),
          })
        );
        return result;
      },
      async wrapStream({ doStream, params }) {
        const { call, started } = reserve(params, 3000);
        const result = await doStream();
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                if (chunk.type === "finish") record(chunk.usage, call, started);
                controller.enqueue(chunk);
              },
            })
          ),
        };
      },
    },
  });
  const modelReads: readonly { id: string; inputSchema: z.ZodType }[] =
    PRODUCTION_EVRY_MODEL_READS;
  const reads = modelReads.map(({ id, inputSchema }) => ({
    id,
    description: inputSchema.description?.slice(0, 500),
  }));
  const cases = [
    {
      id: "tasks",
      request:
        "Give me a list of tasks I have pending for today, not overdue ones.",
      readId: "tasks.query",
      label: "Prepare welcome packets",
      criteria: /today/i,
    },
    {
      id: "people",
      request:
        "Which prospects have received follow-up but have not yet been interviewed? Explain why those people were selected.",
      readId: "people.query",
      label: "Alex Sample",
      criteria: /follow.up[\s\S]*interview|interview[\s\S]*follow.up/i,
    },
    {
      id: "boundary",
      request: "Show people needing follow-up and write a sermon about grace.",
      readId: null,
      label: null,
      criteria: null,
    },
  ];
  const caseId = process.argv
    .find((arg) => arg.startsWith("--case="))
    ?.slice(7);
  const selectedCases = cases.filter(
    (sample) => !caseId || sample.id === caseId
  );
  assert.ok(
    selectedCases.length,
    "Unknown --case; use tasks, people, or boundary."
  );
  try {
    for (const sample of selectedCases) {
      const workBudget = createEvryReadBudget();
      let discoveries = 0;
      const requestedContracts: {
        kind: "read";
        id: string;
        schema: unknown;
      }[] = [];
      const freshReadResults: unknown[] = [];
      const evidence: {
        readId: string;
        input: unknown;
        artifact: EvryReadArtifact;
      }[] = [];
      async function compose(draft: string) {
        let previews = 0;
        const response = await generateEvryModelResponse(
          {
            context: {
              latestRequest: sample.request,
              freshReadResults: evidence,
            },
            draft,
            results: evidence.map(({ artifact }) => artifact),
            onPreview: () => {
              previews++;
            },
          },
          () => model
        );
        assert.ok(previews > 0, "Composer must emit a streamed preview.");
        assert.ok(
          sample.label && JSON.stringify(response).includes(sample.label),
          "Answer or result component must use supplied evidence."
        );
        assert.ok(sample.criteria);
        assert.match(
          response.body,
          sample.criteria,
          "Answer must explain selection criteria."
        );
        console.log(
          JSON.stringify({ request: sample.request, response, previews })
        );
      }
      let answered = false;
      for (let step = 0; step < 6; step++) {
        const decision = await generateEvryModelTurn(
          {
            reads,
            context: {
              latestRequest: sample.request,
              conversation: null,
              pageContext: null,
              originalRequestCanBePrepared: false,
              actionPreparationAllowed: false,
              requestedContracts,
              freshReadResults,
              remainingReads: workBudget.remaining().calls,
              workBudget: workBudget.remaining(),
              remainingDiscoveryCalls: 2 - discoveries,
            },
          },
          () => model
        );
        console.log(JSON.stringify({ request: sample.request, decision }));
        if (sample.readId === null) {
          assert.equal(
            decision.kind,
            "reply",
            "Mixed requests must not execute even the allowed fragment."
          );
          answered = true;
          break;
        }
        if (decision.kind === "describe") {
          assert.ok(++discoveries <= 2, "At most two schema discovery rounds.");
          const previousContracts = requestedContracts.length;
          for (const key of decision.ids) {
            assert.ok(
              key.startsWith("read:"),
              "Read request must not discover action contracts."
            );
            const id = key.slice(5);
            const read = modelReads.find((entry) => entry.id === id);
            assert.ok(read, "Only registered read schemas may be discovered.");
            if (requestedContracts.some((contract) => contract.id === id))
              continue;
            requestedContracts.push({
              kind: "read",
              id,
              schema: z.toJSONSchema(read.inputSchema, {
                unrepresentable: "any",
              }),
            });
          }
          assert.ok(
            requestedContracts.length > previousContracts,
            "No repeated schema discovery."
          );
          continue;
        }
        if (decision.kind === "read") {
          // Production's read budget prevents repeated reads and composes from
          // retained evidence. Do not execute a duplicate or fail the selector
          // for a condition the runtime already handles.
          if (!workBudget.claim(decision.id, decision.input)) {
            assert.ok(evidence.length, "Cannot compose without evidence.");
            await compose(
              "Answer from facts already retrieved; no further reads are available."
            );
            answered = true;
            break;
          }
          assert.equal(decision.id, sample.readId);
          if (decision.id === "tasks.query") {
            const input = z.strictObject(tasksQueryShape).parse(decision.input);
            assert.equal(
              input.where.any.length,
              0,
              "No OR branch may broaden today's tasks."
            );
            assert.ok(
              input.where.all.some(
                (filter) => filter.assignment?.kind === "mine"
              )
            );
            assert.ok(
              input.where.all.some(
                (filter) =>
                  filter.due?.kind === "relative" &&
                  filter.due.period === "today"
              )
            );
            assert.ok(
              input.where.all.some(
                (filter) =>
                  filter.status?.length && !filter.status.includes("complete")
              )
            );
            assert.equal(input.query.mode, "list");
          } else {
            const input = peopleQuerySchema.parse(decision.input);
            assert.deepEqual(input.cohort.all?.stages, ["prospect"]);
            assert.equal(input.cohort.all?.followUp, "recorded");
            assert.equal(input.cohort.all?.interview, "not_recorded");
            assert.equal(input.result.mode, "list");
          }
          // Synthetic evidence deliberately matches only the asserted filter.
          assert.ok(sample.label);
          const sourceLink = trustedEvryApplicationSourceLink({
            label: sample.label,
            href: sample.readId === "tasks.query" ? "/tasks" : "/people",
          });
          const artifact = buildEvryReadArtifact({
            title: sample.readId === "tasks.query" ? "Tasks" : "People",
            filters: [],
            exclusions: [],
            sourceLinks: [sourceLink],
            items: [
              {
                id: "90000000-0000-4000-8000-000000000001",
                label: sample.label,
                sourceLink,
                facts:
                  sample.readId === "tasks.query"
                    ? [
                        { label: "Status", value: "Not started" },
                        { label: "Due date", value: "Today" },
                        { label: "Assignee", value: "You" },
                      ]
                    : [
                        { label: "Stage", value: "Prospect" },
                        {
                          label: "Follow-up",
                          value: "Completed follow-up recorded",
                        },
                        { label: "Interview", value: "No interview recorded" },
                      ],
              },
            ],
          });
          workBudget.record(artifact.items.length, artifact);
          evidence.push({
            readId: decision.id,
            input: decision.input,
            artifact,
          });
          freshReadResults.push({
            readId: decision.id,
            input: decision.input,
            ...artifact,
            truncated: false,
          });
          if (!decision.continueReading) {
            await compose(
              "Answer from the retrieved results and explain the actual selection criteria."
            );
            answered = true;
            break;
          }
          continue;
        }
        assert.equal(
          decision.kind,
          "reply",
          "Read question must not prepare a change."
        );
        assert.ok(
          freshReadResults.length,
          "Must read before claiming current facts."
        );
        if (decision.kind === "reply") {
          await compose(decision.body);
        }
        answered = true;
        break;
      }
      assert.ok(answered, "Bounded conversation did not finish.");
      outcomes.push({ request: sample.request, status: "passed" });
    }
  } finally {
    console.log(
      JSON.stringify({
        calls,
        reservedUsd,
        estimatedActualUsd,
        budgetUsd,
        outcomes,
        applicationReadsExecuted: 0,
        effectsExecuted: 0,
        pricing: "Repository benchmark rates, not a provider invoice.",
        scope:
          "Live model and production schemas with synthetic evidence, not deployed browser validation.",
      })
    );
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : "Live smoke failed; no automatic retry. Provider details withheld."
  );
  process.exitCode = 1;
});
