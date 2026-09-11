import assert from "node:assert/strict";
import { wrapLanguageModel } from "ai";
import { z } from "zod";
import { generateEvryModelTurn } from "@/lib/evry/capabilities/model-turn";
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
  const budgetUsd = 0.25;
  let calls = 0;
  let reservedUsd = 0;
  let estimatedActualUsd = 0;
  const outcomes: { request: string; status: string }[] = [];
  const model = wrapLanguageModel({
    model: provider,
    middleware: {
      specificationVersion: "v3",
      async wrapGenerate({ doGenerate, params }) {
        assert.equal(params.providerOptions?.openai?.store, false);
        assert.equal(params.maxOutputTokens, 1500);
        assert.ok(calls < 10, "Maximum ten calls, no provider retries.");
        const ceiling =
          ((Buffer.byteLength(JSON.stringify(params)) + 4096) *
            candidate.pricePerMillionTokens.input +
            1500 * candidate.pricePerMillionTokens.output) /
          1_000_000;
        assert.ok(
          reservedUsd + ceiling <= budgetUsd,
          "Cost ceiling reached; no call made."
        );
        reservedUsd += ceiling;
        calls++;
        const started = performance.now();
        const result = await doGenerate();
        const input = result.usage.inputTokens;
        const output = result.usage.outputTokens;
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
            call: calls,
            model: EVRY_POLICY_MODEL_ID,
            inputTokens: input.total,
            outputTokens: output.total,
            costUsd,
            latencyMs: Math.round(performance.now() - started),
          })
        );
        return result;
      },
    },
  });
  const reads = PRODUCTION_EVRY_MODEL_READS.map(({ id, inputSchema }) => ({
    id,
    description: inputSchema.description?.slice(0, 500),
  }));
  const cases = [
    {
      request:
        "Give me a list of tasks I have pending for today, not overdue ones.",
      readId: "tasks.query",
      label: "Prepare welcome packets",
      criteria: /today/i,
    },
    {
      request:
        "Which prospects have received follow-up but have not yet been interviewed? Explain why those people were selected.",
      readId: "people.query",
      label: "Alex Sample",
      criteria: /follow.up[\s\S]*interview|interview[\s\S]*follow.up/i,
    },
    {
      request: "Show people needing follow-up and write a sermon about grace.",
      readId: null,
      label: null,
      criteria: null,
    },
  ];
  try {
    for (const sample of cases) {
      const requestedContracts: {
        kind: "read";
        id: string;
        schema: unknown;
      }[] = [];
      const freshReadResults: unknown[] = [];
      let answered = false;
      for (let step = 0; step < 4; step++) {
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
              remainingReads: freshReadResults.length ? 0 : 1,
              remainingDiscoveryCalls: requestedContracts.length ? 0 : 1,
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
          assert.equal(
            requestedContracts.length,
            0,
            "No repeated schema discovery."
          );
          for (const key of decision.ids) {
            assert.ok(
              key.startsWith("read:"),
              "Read request must not discover action contracts."
            );
            const id = key.slice(5);
            const read = PRODUCTION_EVRY_MODEL_READS.find(
              (entry) => entry.id === id
            );
            assert.ok(read, "Only registered read schemas may be discovered.");
            requestedContracts.push({
              kind: "read",
              id,
              schema: z.toJSONSchema(read.inputSchema, {
                unrepresentable: "any",
              }),
            });
          }
          continue;
        }
        if (decision.kind === "read") {
          assert.equal(
            freshReadResults.length,
            0,
            "No duplicate application read."
          );
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
          freshReadResults.push({
            readId: decision.id,
            input: decision.input,
            title: sample.readId === "tasks.query" ? "Tasks" : "People",
            counts: { matched: 1, shown: 1, excluded: 0 },
            filters: decision.input,
            items: [
              {
                id: "90000000-0000-4000-8000-000000000001",
                label: sample.label,
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
            truncated: false,
          });
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
          assert.ok(
            sample.label && decision.body.includes(sample.label),
            "Answer must use supplied evidence."
          );
          assert.ok(sample.criteria);
          assert.match(
            decision.body,
            sample.criteria,
            "Answer must explain selection criteria."
          );
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
