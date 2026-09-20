import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { historicalFixtureIds } from "@/lib/evry/eve/evals/fixtures/historical";

test(
  "original question fixtures query real launch, wiki, catalog, roles and refined task data",
  {
    skip: process.env.EVRY_EVE_HISTORICAL_PROOF !== "1",
    timeout: 180_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_eve_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let omitOwnership = false;
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry, onPresentResult }) {
          let index = 0;
          const invoke = async (
            name: string,
            input: unknown,
            present = true
          ) => {
            const callId = `historical-${index++}`;
            const output = await registry.invoke(name, input, { callId });
            assert.equal(
              z.object({ kind: z.string() }).parse(output).kind,
              "read",
              JSON.stringify(output)
            );
            if (present) onPresentResult(callId);
            return output;
          };
          if (scenario.id === "tasks-08") {
            await invoke("tasks.query", {
              where: {
                all: [
                  {
                    assignment: { kind: "mine" },
                    due: { kind: "relative", period: "today" },
                  },
                ],
              },
              query: { mode: "list" },
            });
            await invoke("tasks.query", {
              where: {
                all: [
                  {
                    assignment: { kind: "mine" },
                    due: { kind: "relative", period: "today" },
                    priority: ["high"],
                  },
                ],
              },
              query: { mode: "list" },
            });
            await invoke("tasks.query", {
              where: {
                all: [
                  {
                    ...(omitOwnership ? {} : { assignment: { kind: "mine" } }),
                    due: {
                      kind: "range",
                      from: "2026-09-20",
                      through: "2026-09-21",
                    },
                    priority: ["high"],
                  },
                ],
              },
              query: { mode: "list" },
            });
          }
          if (scenario.id === "roles-01")
            await invoke("teams.query", {
              request: {
                resource: "roles",
                where: { all: [{ vacant: true }] },
                query: { mode: "list" },
              },
            });
          if (scenario.id === "launch-01") {
            await invoke(
              "launch.query",
              { query: { resource: "status", mode: "list" } },
              false
            );
            await invoke("launch.query", {
              query: {
                resource: "milestones",
                completion: "open",
                mode: "list",
              },
            });
          }
          if (scenario.id === "documents-01")
            await invoke("documents.query", {
              query: {
                resource: "templates",
                search: "vision meeting",
                mode: "list",
              },
            });
          if (scenario.id === "wiki-03") {
            const search = await invoke(
              "wiki.search",
              { queries: ["orientation", "vision meeting"] },
              false
            );
            const items = z
              .object({
                items: z.array(
                  z.object({
                    facts: z.array(
                      z.object({ label: z.string(), value: z.string() })
                    ),
                  })
                ),
              })
              .parse(search).items;
            const slugs = [
              ...new Set(
                items.flatMap((i) =>
                  i.facts
                    .filter((f) => f.label === "Citation slug")
                    .map((f) => f.value)
                )
              ),
            ];
            assert.equal(
              slugs.length,
              2,
              "Visible scoped articles exclude global override, draft and foreign rows"
            );
            await invoke(
              "wiki.read_many",
              { articles: slugs.map((slug) => ({ slug })) },
              false
            );
          }
          return {
            answer: "Scripted production-tool fixture, not a model answer.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const id of [...historicalFixtureIds, "wiki-03"])
        await t.test(id, async () => {
          const scenario = questions.find((q) => q.id === id)!;
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture);
          try {
            const run = async () =>
              observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0.1,
                })
              );
            const observation = await run();
            const grade = gradeObservation(
              id,
              fixture.expectations,
              observation
            );
            assert.deepEqual(
              grade.failures,
              ["quality_not_reviewed"],
              JSON.stringify({
                grade,
                facts: observation.facts,
                expected: fixture.expectations.facts,
              })
            );
            if (id === "tasks-08") {
              omitOwnership = true;
              const wrong = gradeObservation(
                id,
                fixture.expectations,
                await run()
              );
              assert.ok(
                wrong.failures.some((failure) => failure.includes("finalIds")),
                JSON.stringify(wrong)
              );
              omitOwnership = false;
            }
          } finally {
            await fixture.cleanup();
          }
        });
      assert.equal(
        await adapter.prepare(questions.find((q) => q.id === "documents-04")!),
        null,
        "Unbound generated-document bytes remain blocked"
      );
    } finally {
      await stack.cleanup();
    }
  }
);
