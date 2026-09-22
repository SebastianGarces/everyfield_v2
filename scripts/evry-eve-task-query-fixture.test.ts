import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { taskQueryFixtureIds } from "@/lib/evry/eve/evals/fixtures/task-queries";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";

test(
  "task question filters and aggregates match independent SQL truth",
  { skip: process.env.EVRY_EVE_TASK_QUERY_PROOF !== "1", timeout: 180_000 },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const previousDatabase = process.env.DATABASE_URL;
    const previousEndpoint = neonConfig.fetchEndpoint;
    const originalFetch = globalThis.fetch;
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
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
      let listStrategy = false;
      let pagedStrategy = false;
      const store = createFixtureStore(stack.container);
      const adapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry, actor }) {
          const pending = { status: ["not_started", "in_progress", "blocked"] };
          const filter =
            scenario.id === "tasks-01"
              ? {
                  ...pending,
                  assignment: { kind: "mine" },
                  ...(wrong
                    ? {}
                    : { due: { kind: "relative", period: "today" } }),
                }
              : scenario.id === "tasks-03"
                ? {
                    ...pending,
                    due: { kind: "relative", period: "overdue" },
                    ...(wrong ? {} : { assignment: { kind: "unassigned" } }),
                  }
                : scenario.id === "tasks-05"
                  ? {
                      ...pending,
                      due: { kind: "relative", period: "overdue" },
                      ...(wrong ? {} : { priority: ["high"] }),
                    }
                  : {
                      status: ["complete"],
                      [wrong ? "due" : "completed"]: {
                        kind: "range",
                        from: "2026-09-07",
                        through: "2026-09-13",
                      },
                    };
          if (pagedStrategy) {
            assert.equal(scenario.id, "tasks-03");
            assert.equal(wrong, false);
            // Independent SQL names the requested cohort, not a count supplied
            // by the production reader or the number of rows in either page.
            const base = `church_id='${actor.plantId}' and deleted_at is null and parent_task_id is null and status in ('not_started','in_progress','blocked')`;
            const truth = store
              .query(
                `select id from tasks where ${base} and assigned_to_id is null and due_date < '2026-09-20' order by title, id`
              )
              .map((row) => z.uuid().parse(row.id));
            assert.equal(truth.length, 3);
            assert.ok(
              store.query(
                `select id from tasks where ${base} and due_date < '2026-09-20'`
              ).length > truth.length,
              "assigned-task distractors must exist"
            );
            assert.ok(
              store.query(
                `select id from tasks where ${base} and assigned_to_id is null`
              ).length > truth.length,
              "non-overdue distractors must exist"
            );
            const pageSchema = capturedReadArtifactSchema.extend({
              counts: z.object({ matched: z.number(), returned: z.number() }),
              filters: z.array(
                z.object({ label: z.string(), value: z.string() })
              ),
            });
            const read = async (cursor?: string) =>
              pageSchema.parse(
                await registry.invoke(
                  "tasks.query",
                  {
                    where: { all: [filter] },
                    query: {
                      mode: "list",
                      limit: 2,
                      sort: "title",
                      direction: "asc",
                      ...(cursor === undefined ? {} : { cursor }),
                    },
                  },
                  {
                    callId:
                      cursor === undefined ? "task-page-one" : "task-page-two",
                  }
                )
              );
            const first = await read();
            assert.equal(first.items.length, 2);
            assert.equal(first.counts.returned, 2);
            assert.equal(first.counts.matched, truth.length);
            assert.notEqual(first.counts.matched, first.items.length);
            const cursor = first.filters.find(
              (field) => field.label === "Next page cursor"
            )?.value;
            assert.equal(cursor, "2");
            const second = await read(cursor);
            assert.equal(second.items.length, 1);
            assert.equal(second.counts.returned, 1);
            assert.equal(second.counts.matched, truth.length);
            assert.equal(
              second.filters.find((field) => field.label === "Next page cursor")
                ?.value,
              "End of results"
            );
            assert.deepEqual(
              [...first.items, ...second.items].map((item) => item.id),
              truth
            );
          } else
            await registry.invoke(
              "tasks.query",
              {
                where: { all: [filter] },
                query:
                  !listStrategy &&
                  (scenario.id === "tasks-05" || scenario.id === "tasks-06")
                    ? {
                        mode: "group",
                        by: scenario.id === "tasks-05" ? "assignee" : "team",
                        limit: 50,
                      }
                    : { mode: "list", limit: 50 },
              },
              { callId: "task-query" }
            );
          return {
            answer: "Scripted tool proof, not a model response.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const id of taskQueryFixtureIds)
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
              JSON.stringify({ grade, expected: fixture.expectations })
            );
            assert.deepEqual(good.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            if (id === "tasks-05") {
              listStrategy = true;
              const listed = gradeObservation(
                id,
                fixture.expectations,
                await run()
              );
              assert.deepEqual(
                listed.failures,
                ["quality_not_reviewed"],
                JSON.stringify(listed)
              );
              listStrategy = false;
            }
            if (id === "tasks-03") {
              pagedStrategy = true;
              const paged = observationSchema.parse(await run());
              assert.deepEqual(
                gradeObservation(id, fixture.expectations, paged).failures,
                ["quality_not_reviewed"]
              );
              assert.deepEqual(paged.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              pagedStrategy = false;
            }
            wrong = true;
            const bad = gradeObservation(id, fixture.expectations, await run());
            assert.ok(
              bad.failures.some((f) => f.startsWith("fact:")),
              JSON.stringify(bad)
            );
            assert.equal(outbound, 0);
          } finally {
            wrong = false;
            listStrategy = false;
            pagedStrategy = false;
            await fixture.cleanup();
          }
        });
    } finally {
      globalThis.fetch = originalFetch;
      neonConfig.fetchEndpoint = previousEndpoint;
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      await stack.cleanup();
    }
  }
);
