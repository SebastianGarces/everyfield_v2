import assert from "node:assert/strict";
import { wrapLanguageModel } from "ai";
import { generateEvryModelTurn } from "@/lib/evry/capabilities/model-turn";
import { generateEvryModelResponse } from "@/lib/evry/capabilities/model-response";
import { PRODUCTION_EVRY_MODEL_READS } from "@/lib/evry/capabilities/production";
import { EVRY_READ_WORKFLOWS } from "@/lib/evry/recipes/read-workflows";
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
import { z } from "zod";

// Opt-in, synthetic evidence only. Exercises real planner/composer boundaries,
// not application readers, authorization, database writes, or end-to-end chat.
// node --env-file=.env.local --import tsx scripts/evry-answer-coverage-smoke.ts --live
async function main() {
  assert.ok(
    process.argv.includes("--live"),
    "Pass --live to permit paid checks."
  );
  const candidate = evryModelCandidate(EVRY_POLICY_MODEL_ID);
  const provider = getEvryPolicyModel();
  assert.ok(
    candidate &&
      typeof provider !== "string" &&
      provider.specificationVersion === "v3"
  );
  const partialOnly = process.argv.includes("--partial-only");
  const budgetUsd = partialOnly ? 0.01 : 0.1;
  let calls = 0;
  let reservedUsd = 0;
  let costUsd = 0;
  const model = wrapLanguageModel({
    model: provider,
    middleware: {
      specificationVersion: "v3",
      async transformParams({ params }) {
        const ceiling =
          ((Buffer.byteLength(JSON.stringify(params)) + 4096) *
            candidate.pricePerMillionTokens.input +
            (params.maxOutputTokens ?? 3000) *
              candidate.pricePerMillionTokens.output) /
          1_000_000;
        assert.ok(
          calls < 10 && reservedUsd + ceiling <= budgetUsd,
          "Paid check budget reached before call."
        );
        assert.equal(params.providerOptions?.openai?.store, false);
        calls++;
        reservedUsd += ceiling;
        return params;
      },
      async wrapGenerate({ doGenerate }) {
        const result = await doGenerate();
        costUsd += calculateEvryModelCostUsd({
          candidate,
          inputUncachedTokens:
            result.usage.inputTokens.noCache ??
            result.usage.inputTokens.total ??
            0,
          inputCacheReadTokens: result.usage.inputTokens.cacheRead ?? 0,
          inputCacheWriteTokens: 0,
          outputTokens: result.usage.outputTokens.total ?? 0,
        });
        console.log(
          JSON.stringify({
            phase: "usage",
            calls,
            costUsd,
            reservedUsd,
            budgetUsd,
          })
        );
        return result;
      },
      async wrapStream({ doStream }) {
        const result = await doStream();
        return {
          ...result,
          stream: result.stream.pipeThrough(
            new TransformStream({
              transform(chunk, controller) {
                if (chunk.type === "finish") {
                  costUsd += calculateEvryModelCostUsd({
                    candidate,
                    inputUncachedTokens:
                      chunk.usage.inputTokens.noCache ??
                      chunk.usage.inputTokens.total ??
                      0,
                    inputCacheReadTokens:
                      chunk.usage.inputTokens.cacheRead ?? 0,
                    inputCacheWriteTokens: 0,
                    outputTokens: chunk.usage.outputTokens.total ?? 0,
                  });
                  console.log(
                    JSON.stringify({
                      phase: "usage",
                      calls,
                      costUsd,
                      reservedUsd,
                      budgetUsd,
                    })
                  );
                }
                controller.enqueue(chunk);
              },
            })
          ),
        };
      },
    },
  });
  const catalog = {
    reads: PRODUCTION_EVRY_MODEL_READS.map((read) => ({
      id: read.id,
      description: read.inputSchema.description,
    })),
    recipes: EVRY_READ_WORKFLOWS.map((recipe) => ({
      id: recipe.id,
      description: recipe.description,
      schema: z.toJSONSchema(recipe.inputSchema, { unrepresentable: "any" }),
    })),
  };
  const questions = [
    { request: "Can you let me know where we are on launch?", overview: true },
    { request: "What is our launch date?", overview: false },
    {
      request: "How is our team's workload looking, and what needs attention?",
      overview: true,
    },
    {
      request: "Which prospects should we interview next and why?",
      overview: true,
    },
    {
      request:
        "Compare our volunteer handbook document with the wiki onboarding guidance. What is missing?",
      overview: true,
    },
    {
      request: "Only high priority",
      overview: false,
      previousRequest: "My pending tasks due today, excluding overdue",
    },
  ];
  for (const sample of partialOnly ? [] : questions) {
    const decision = await generateEvryModelTurn(
      {
        ...catalog,
        context: {
          latestRequest: sample.request,
          conversation: { previousRequest: sample.previousRequest },
          workBudget: { calls: 8, rows: 200, durationMs: 90000 },
        },
      },
      () => model
    );
    console.log(
      JSON.stringify({ phase: "planning", request: sample.request, decision })
    );
    assert.ok(
      decision.kind === "read" ||
        decision.kind === "recipe" ||
        decision.kind === "describe",
      "A current-record question must select evidence, not answer from memory."
    );
    assert.equal(
      decision.reviewEvidence === true,
      sample.overview,
      sample.request
    );
  }
  const artifact = (title: string, facts: { label: string; value: string }[]) =>
    buildEvryReadArtifact({
      title,
      filters: [],
      exclusions: [],
      sourceLinks: [],
      items: [
        {
          id: "00000000-0000-4000-8000-000000000001",
          label: title,
          facts,
          sourceLink: trustedEvryApplicationSourceLink({
            label: "Launch",
            href: "/launch",
          }),
        },
      ],
    });
  const status = artifact("Launch Sunday", [
    { label: "Target date", value: "2026-10-11" },
    { label: "Attendance", value: "Not recorded" },
  ]);
  const milestones = artifact("Open milestones", [
    { label: "Count", value: "5" },
    {
      label: "Work",
      value:
        "Promotion plan, partner announcements, ministry training and pre-launch services",
    },
  ]);
  const roles = artifact("Open ministry roles", [
    { label: "Count", value: "32" },
  ]);
  const tasks = artifact("Launch task blockers", [
    { label: "Blocked tasks", value: "0" },
  ]);
  const meetings = artifact("Upcoming preparation", [
    {
      label: "Meeting",
      value:
        "Next steps orientation on September 19, with 3 unchecked preparation items",
    },
  ]);
  if (!partialOnly) {
    const review = await generateEvryModelTurn(
      {
        ...catalog,
        context: {
          latestRequest: questions[0].request,
          requiresEvidenceReview: true,
          freshReadResults: [
            {
              readId: "launch.query",
              input: { query: { resource: "status" } },
              artifact: status,
            },
          ],
          workBudget: { calls: 7, rows: 199, durationMs: 80000 },
        },
      },
      () => model
    );
    console.log(
      JSON.stringify({ phase: "date-only-evidence-review", decision: review })
    );
    assert.ok(
      review.kind === "read" ||
        review.kind === "recipe" ||
        review.kind === "describe",
      "A date alone cannot complete a launch progress overview."
    );
  }
  for (const mode of (["overview", "date", "partial"] as const).filter(
    (mode) => !partialOnly || mode === "partial"
  )) {
    const results =
      mode === "date"
        ? [status]
        : mode === "partial"
          ? [status, milestones, tasks, meetings]
          : [status, milestones, roles, tasks, meetings];
    const output = await generateEvryModelResponse(
      {
        context: {
          latestRequest:
            mode === "date" ? questions[1].request : questions[0].request,
          requiresEvidenceReview: mode !== "date",
          referenceDate: "2026-09-18",
          freshReadResults: results.map((artifact) => ({ artifact })),
          unavailableReads:
            mode === "partial"
              ? [{ readId: "teams.query", input: { resource: "roles" } }]
              : [],
        },
        draft:
          "Answer from the available evidence. Do not assume missing records mean zero.",
        results,
      },
      () => model
    );
    console.log(
      JSON.stringify({
        phase: "answer",
        mode,
        body: output.body,
        cards: output.artifacts.length,
      })
    );
    assert.match(output.body, /October 11|Oct\.? 11|2026-10-11/);
    assert.doesNotMatch(
      output.body,
      /nextCursor|no next page|all matching records|readId|not_started/
    );
    if (mode === "date")
      assert.ok(
        output.body.split(/\s+/).length <= 70,
        "A date lookup should stay focused."
      );
    else {
      assert.match(output.body, /5|five/i);
      assert.match(output.body, /orientation|next steps/i);
      if (mode === "overview") assert.match(output.body, /32|thirty.two/i);
      else {
        assert.doesNotMatch(output.body, /32|thirty.two/i);
        assert.match(output.body, /roles|staffing|ministry/i);
        assert.match(
          output.body,
          /unavailable|couldn.t|could not|can.t|cannot|unable|not available|not.*retriev/i
        );
      }
    }
  }
  console.log(
    JSON.stringify({ status: "passed", calls, costUsd, reservedUsd, budgetUsd })
  );
}

main().catch(() => {
  console.error(
    "Answer coverage smoke failed. Inspect synthetic outputs above; no automatic retry."
  );
  process.exitCode = 1;
});
