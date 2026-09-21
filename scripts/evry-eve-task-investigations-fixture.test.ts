import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { taskInvestigationFixtureIds } from "@/lib/evry/eve/evals/fixtures/task-investigations";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { observationSchema } from "@/lib/evry/eve/evals/contract";

test(
  "task investigations match independent SQL truth, including related pages and account resolution",
  {
    skip: process.env.EVRY_EVE_TASK_INVESTIGATIONS_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const previousDatabase = process.env.DATABASE_URL;
    const previousResend = process.env.RESEND_API_KEY;
    const previousEndpoint = neonConfig.fetchEndpoint;
    const originalFetch = globalThis.fetch;
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_fixture_no_delivery";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only the isolated fixture proxy is allowed");
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let wrong = false;
      let truncated = false;
      let batched = true;
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry }) {
          let serial = 0;
          const invoke = async (name: string, input: unknown) =>
            capturedReadArtifactSchema.parse(
              await registry.invoke(name, input, {
                callId: `investigation-${serial++}`,
              })
            );
          const pending = { status: ["not_started", "in_progress", "blocked"] };
          const accounts: string[] = [];
          if (scenario.id === "tasks-11") {
            for (const search of ["Alex", "Jordan"]) {
              const result = await invoke("tasks.assignees.search", {
                search,
                limit: 50,
              });
              assert.equal(
                result.items.length,
                1,
                "Only an eligible local account can resolve each name"
              );
              accounts.push(...result.items.map((item) => item.id));
            }
          }
          const filter =
            scenario.id === "tasks-02"
              ? {
                  ...pending,
                  assignment: { kind: "mine" },
                  due: wrong
                    ? { kind: "relative", period: "this_week" }
                    : { kind: "range", from: null, through: "2026-09-20" },
                }
              : scenario.id === "tasks-04"
                ? wrong
                  ? { status: ["blocked"] }
                  : { incompletePrerequisites: true }
                : scenario.id === "tasks-09"
                  ? { due: { kind: "undated" }, ...(wrong ? pending : {}) }
                  : {
                      ...pending,
                      due: { kind: "relative", period: "this_week" },
                      assignment: {
                        kind: "accounts",
                        ids: wrong ? accounts.slice(0, 1) : accounts,
                      },
                    };
          const taskIds: string[] = [];
          let offset = 0;
          for (;;) {
            const page = await invoke("tasks.query", {
              where: { all: [filter] },
              query: { mode: "list", limit: 2, cursor: String(offset) },
            });
            taskIds.push(...page.items.map((item) => item.id));
            offset += page.items.length;
            if (offset >= page.counts.matched || !page.items.length) break;
          }
          if (scenario.id === "tasks-04" || scenario.id === "tasks-09") {
            const section =
              scenario.id === "tasks-04" ? "dependencies" : "checklist";
            const totalLabel =
              section === "dependencies"
                ? "Prerequisite total"
                : "Checklist total";
            // Exercise batch reads and continuation independently of the UI card
            // size. A second strategy partitions the same evidence by parent.
            for (const batch of batched
              ? [taskIds]
              : taskIds.map((id) => [id])) {
              let remaining = batch;
              let relatedOffset = 0;
              while (remaining.length) {
                const result = await invoke("tasks.get_many", {
                  ids: remaining,
                  sections: [section],
                  relatedLimit: 1,
                  relatedOffset,
                });
                relatedOffset++;
                remaining = result.items
                  .filter((item) => {
                    const total = Number(
                      item.facts?.find((f) => f.label === totalLabel)?.value
                    );
                    assert.ok(Number.isSafeInteger(total));
                    return relatedOffset < total;
                  })
                  .map((item) => item.id);
                if (truncated) break;
              }
            }
          }
          return {
            answer: "Scripted tool proof, not a model response.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const id of taskInvestigationFixtureIds)
        await t.test(id, async () => {
          const scenario = questions.find((q) => q.id === id);
          assert.ok(scenario);
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture);
          try {
            const run = () =>
              fixture.run({
                scenario,
                signal: AbortSignal.timeout(30_000),
                maxCostUsd: 0.1,
              });
            const good = observationSchema.parse(await run());
            const grade = gradeObservation(id, fixture.expectations, good);
            assert.deepEqual(
              grade.failures,
              ["quality_not_reviewed"],
              JSON.stringify({
                grade,
                expected: fixture.expectations,
                actual: good.facts,
              })
            );
            assert.deepEqual(good.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            if (id === "tasks-04" || id === "tasks-09") {
              batched = false;
              const partitioned = gradeObservation(
                id,
                fixture.expectations,
                await run()
              );
              assert.deepEqual(
                partitioned.failures,
                ["quality_not_reviewed"],
                JSON.stringify(partitioned)
              );
              batched = true;
            }
            wrong = true;
            const bad = gradeObservation(id, fixture.expectations, await run());
            assert.ok(
              bad.failures.some((f) => f.startsWith("fact:")),
              JSON.stringify(bad)
            );
            wrong = false;
            if (id === "tasks-04" || id === "tasks-09") {
              truncated = true;
              const partial = gradeObservation(
                id,
                fixture.expectations,
                await run()
              );
              assert.ok(
                partial.failures.includes(
                  "missing_evidence:complete-task-investigation"
                ),
                JSON.stringify(partial)
              );
            }
            assert.equal(outbound, 0);
          } finally {
            wrong = false;
            truncated = false;
            batched = true;
            await fixture.cleanup();
          }
        });
    } finally {
      globalThis.fetch = originalFetch;
      neonConfig.fetchEndpoint = previousEndpoint;
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      if (previousResend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previousResend;
      await stack.cleanup();
    }
  }
);
