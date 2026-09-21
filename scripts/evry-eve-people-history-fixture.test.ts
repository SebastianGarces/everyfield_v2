import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { peopleHistoryFixtureIds } from "@/lib/evry/eve/evals/fixtures/people-history";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";

test(
  "people-history questions use production reads against independent SQL",
  { skip: process.env.EVRY_EVE_PEOPLE_HISTORY_PROOF !== "1", timeout: 180_000 },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const originalFetch = globalThis.fetch;
    let outboundAttempts = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_eve_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outboundAttempts++;
          throw new Error(
            "People history proof only permits the disposable database proxy"
          );
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let wrong = false;
      let aggregateMode: "count" | "group" = "count";
      let boundaryOverride: { from?: string; through?: string } = {};
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry, onPresentResult }) {
          let calls = 0;
          const invoke = async (
            name: string,
            input: unknown,
            present = false
          ) => {
            const callId = `history-${calls++}`;
            const artifact = capturedReadArtifactSchema.parse(
              await registry.invoke(name, input, { callId })
            );
            if (present) onPresentResult(callId);
            return artifact;
          };
          if (scenario.id === "people-03")
            await invoke(
              "people.query",
              {
                cohort: {
                  all: {
                    skill: { categories: ["worship"] },
                    ...(!wrong
                      ? { membership: { existence: "not_recorded" } }
                      : {}),
                  },
                },
                result: { mode: "list" },
              },
              true
            );
          if (
            scenario.id === "interviews-05" ||
            scenario.id === "assessments-01"
          ) {
            const interview = scenario.id === "interviews-05";
            const found = await invoke("people.query", {
              cohort: {
                anyOf: [
                  { search: "Jordan" },
                  ...(interview ? [{ search: "Alex" }] : []),
                ],
              },
              result: { mode: "list" },
            });
            assert.equal(found.items.length, interview ? 2 : 1);
            await invoke(
              "people.history.query",
              {
                resource: { kind: interview ? "interviews" : "assessments" },
                cohort: { all: { personIds: found.items.map((i) => i.id) } },
                latestPerPerson: !wrong,
                result: { mode: "list" },
              },
              true
            );
          }
          if (scenario.id === "assessments-04") {
            const calendar = z
              .object({
                dateWindow: z.object({
                  from: z.string().date(),
                  through: z.string().date(),
                }),
              })
              .parse(
                await registry.invoke(
                  "calendar.resolve",
                  { date: { kind: "trailing_days", days: 90 } },
                  { callId: `history-${calls++}` }
                )
              );
            await invoke(
              "people.history.query",
              {
                resource: { kind: "assessments" },
                dates: { ...calendar.dateWindow, ...boundaryOverride },
                dateBasis: wrong ? "created_at" : "record_date",
                result:
                  aggregateMode === "count"
                    ? { mode: "count" }
                    : { mode: "group", by: "person" },
              },
              true
            );
          }
          if (scenario.id === "commitments-05")
            await invoke(
              "people.query",
              {
                cohort: {
                  all: {
                    commitment: { existence: "recorded" },
                    attendance: {
                      maximumMeetings: 0,
                      ...(!wrong ? { meetingTypes: ["orientation"] } : {}),
                    },
                  },
                },
                result: { mode: "list" },
              },
              true
            );
          return {
            answer: "Scripted production-tool proof, not a live model answer.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const id of peopleHistoryFixtureIds)
        await t.test(id, async (t) => {
          const scenario = questions.find((q) => q.id === id);
          assert.ok(scenario);
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${id} must have an independent fixture binding`);
          try {
            const run = async () =>
              observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0.1,
                })
              );
            const good = await run();
            const grade = gradeObservation(id, fixture.expectations, good);
            assert.deepEqual(
              grade.failures,
              ["quality_not_reviewed"],
              JSON.stringify({
                grade,
                expected: fixture.expectations.facts,
                observed: good.facts,
              })
            );
            assert.deepEqual(good.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            assert.equal(good.costUsd, 0);
            if (id === "assessments-04")
              await t.test(
                "both aggregate modes use exactly ninety inclusive dates and reject boundary mistakes",
                async () => {
                  try {
                    for (const mode of ["count", "group"] as const) {
                      aggregateMode = mode;
                      boundaryOverride = {};
                      const correct = await run();
                      assert.deepEqual(
                        gradeObservation(id, fixture.expectations, correct)
                          .failures,
                        ["quality_not_reviewed"]
                      );
                      assert.equal(correct.facts.distinctPeople, 4);
                      assert.equal(correct.facts.assessmentRecords, 6);
                      for (const override of [
                        { from: "2026-06-22" },
                        { from: "2026-06-24" },
                        { through: "2026-09-19" },
                        { through: "2026-09-21" },
                      ]) {
                        boundaryOverride = override;
                        const observed = await run();
                        const failures = gradeObservation(
                          id,
                          fixture.expectations,
                          observed
                        ).failures;
                        assert.ok(
                          failures.includes("fact:distinctPeople"),
                          JSON.stringify({
                            mode,
                            override,
                            observed: observed.facts,
                          })
                        );
                        assert.ok(failures.includes("fact:assessmentRecords"));
                        assert.ok(
                          failures.some(
                            (f) =>
                              f === "fact:windowFrom" ||
                              f === "fact:windowThrough"
                          )
                        );
                        assert.deepEqual(observed.effects, {
                          domainWrites: 0,
                          outboundMessages: 0,
                        });
                      }
                    }
                  } finally {
                    aggregateMode = "count";
                    boundaryOverride = {};
                  }
                }
              );
            await t.test(
              "wrong relationship, date basis or latest-record selection fails facts",
              async () => {
                wrong = true;
                try {
                  const bad = gradeObservation(
                    id,
                    fixture.expectations,
                    await run()
                  );
                  assert.ok(
                    bad.failures.some((f) => f.startsWith("fact:")),
                    JSON.stringify(bad)
                  );
                  assert.ok(bad.failures.includes("quality_not_reviewed"));
                } finally {
                  wrong = false;
                }
              }
            );
            assert.equal(outboundAttempts, 0);
          } finally {
            await fixture.cleanup();
          }
        });
    } finally {
      globalThis.fetch = originalFetch;
      await stack.cleanup();
    }
  }
);
