import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { neonConfig } from "@neondatabase/serverless";
import { regressions } from "@/lib/evry/eve/evals/catalog";
import { runEvalSuite } from "@/lib/evry/eve/evals/runner";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createCompiledEveEvalRunner } from "@/lib/evry/eve/evals/http/compiled-adapter";
import type { CompiledFixtureRequest } from "@/lib/evry/eve/evals/http/process-contract";

test(
  "production eval adapter grades actual compiled HTTP results against SQL, without claiming model quality",
  {
    skip: process.env.EVRY_EVE_HTTP_PROOF !== "1",
    timeout: 180_000,
  },
  async () => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const previousDatabase = process.env.DATABASE_URL;
    const previousResend = process.env.RESEND_API_KEY;
    const previousEndpoint = neonConfig.fetchEndpoint;
    let executed = 0;
    let narrow = true;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_compiled_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      const scenario = regressions.find(
        (entry) => entry.id === "regression-followup-priority"
      );
      assert.ok(scenario);
      const filters = {
        assignment: { kind: "mine" },
        due: { kind: "relative", period: "today" },
        status: ["not_started", "in_progress", "blocked"],
      };
      const model = (): CompiledFixtureRequest["model"] => ({
        mode: "scripted",
        responses: [
          {
            toolCalls: [
              {
                id: "adapter-today",
                name: "tasks_query",
                input: { where: { all: [filters] }, query: { mode: "list" } },
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "adapter-today-present",
                name: "present_result",
                input: { reference: "adapter-today" },
              },
            ],
          },
          { text: "Here are your tasks due today." },
          {
            toolCalls: [
              {
                id: "adapter-priority",
                name: "tasks_query",
                input: {
                  where: {
                    all: [filters, ...(narrow ? [{ priority: ["high"] }] : [])],
                  },
                  query: { mode: "list" },
                },
              },
            ],
          },
          {
            toolCalls: [
              {
                id: "adapter-priority-present",
                name: "present_result",
                input: { reference: "adapter-priority" },
              },
            ],
          },
          { text: "Here is the high-priority task." },
        ],
      });
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        captureMode: "isolated_http",
        runProduction: createCompiledEveEvalRunner({
          compiledEntry: resolve(".output/server/index.mjs"),
          databaseUrl: stack.databaseUrl,
          proxyUrl: stack.proxyUrl,
          prices: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            maxInputBytes: 500_000,
            maxOutputTokens: 1_000,
          },
          model,
          onOutcome(outcome) {
            executed++;
            assert.equal(outcome.runtimeProof?.modelCalls, 6);
            assert.deepEqual(outcome.runtimeProof?.turnInputs, scenario.turns);
            assert.deepEqual(
              outcome.hostCapture.calls.map((call) => call.name),
              ["tasks.query", "tasks.query"]
            );
            assert.deepEqual(outcome.hostCapture.presented, [
              "adapter-today",
              "adapter-priority",
            ]);
            assert.equal(outcome.costUsd, 0);
            assert.equal(outcome.judge, null);
          },
        }),
      });
      const run = () =>
        runEvalSuite({
          scenarios: [scenario],
          adapter,
          budgetUsd: 1,
          maxCaseCostUsd: 1,
          caseTimeoutMs: 120_000,
        });
      const correct = await run();
      assert.equal(
        executed,
        1,
        "The suite must actually invoke the compiled HTTP runner"
      );
      assert.deepEqual(correct.results[0]?.failures, ["quality_not_reviewed"]);
      assert.equal(correct.results[0]?.observation?.facts.total, 1);
      assert.equal(correct.results[0]?.observation?.toolCallCount, 2);
      assert.deepEqual(correct.results[0]?.observation?.effects, {
        domainWrites: 0,
        outboundMessages: 0,
      });
      assert.ok(
        correct.results[0]?.observation?.safety.every((proof) => proof.passed)
      );
      assert.equal(
        correct.summary.passed,
        false,
        "Scripted results cannot pass the agent-quality gate"
      );

      narrow = false;
      const incorrect = await run();
      assert.equal(executed, 2);
      assert.ok(
        incorrect.results[0]?.failures.includes("fact:taskIds"),
        "Independent SQL expectations catch the omitted priority filter"
      );
      assert.ok(incorrect.results[0]?.failures.includes("fact:total"));
      assert.ok(
        incorrect.results[0]?.failures.includes("quality_not_reviewed")
      );
      assert.equal(incorrect.summary.passed, false);
      assert.equal(incorrect.summary.costUsd, 0);
    } finally {
      neonConfig.fetchEndpoint = previousEndpoint;
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      if (previousResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResend;
      await stack.cleanup();
    }
  }
);
