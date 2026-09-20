import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { relationalFixtureIds } from "@/lib/evry/eve/evals/fixtures/relational";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";

test(
  "original relational questions use authorized production reads against independent SQL truth",
  { skip: process.env.EVRY_EVE_RELATIONAL_PROOF !== "1", timeout: 180_000 },
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
            "Relational fixture allows only its disposable database proxy"
          );
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let wrong = false;
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry, onPresentResult }) {
          const id = scenario.id;
          let calls = 0;
          const invoke = async (
            name: string,
            input: unknown,
            present = false
          ) => {
            const callId = `relational-${calls++}`;
            const output = await registry.invoke(name, input, { callId });
            const artifact = capturedReadArtifactSchema.parse(output);
            if (present) onPresentResult(callId);
            return artifact.items;
          };
          if (id === "people-05") {
            const groups = await invoke("people.query", {
              cohort: {},
              result: { mode: "group", by: "household" },
            });
            const rivera = groups.find((i) => i.label === "Rivera");
            assert.ok(rivera);
            const groupKey = rivera.facts?.find(
              (f) => f.label === "Group key"
            )?.value;
            const householdId = z
              .uuid()
              .parse(groupKey?.match(/\[([^\]]+)\]$/)?.[1]);
            await invoke(
              "people.query",
              {
                cohort: {
                  all: wrong
                    ? { search: "Rivera" }
                    : { householdIds: [householdId] },
                },
                result: { mode: "list" },
              },
              true
            );
          }
          if (id === "training-02")
            await invoke(
              "training.query",
              {
                request: {
                  resource: "completions",
                  where: {
                    all: wrong
                      ? []
                      : [
                          {
                            completedDate: {
                              kind: "relative",
                              period: "this_month",
                            },
                          },
                        ],
                  },
                  query: { mode: "list" },
                },
              },
              true
            );
          if (id === "commitments-01") {
            const records = await invoke("people.history.query", {
              resource: {
                kind: "commitments",
                types: [wrong ? "core_group" : "launch_team"],
              },
              result: { mode: "list" },
            });
            const personIds = [
              ...new Set(
                records.flatMap(
                  (r) =>
                    r.facts
                      ?.filter((f) => f.label === "person_id")
                      .map((f) => f.value) ?? []
                )
              ),
            ];
            assert.equal(personIds.length, wrong ? 1 : 2);
            if (!wrong)
              assert.equal(
                records.length,
                3,
                "Repeated commitments must not create repeated people"
              );
            await invoke(
              "people.get_many",
              { resource: "person", ids: personIds },
              true
            );
          }
          if (id === "meetings-02") {
            const meetings = await invoke("meetings.query", {
              where: {
                all: [
                  {
                    types: ["vision_meeting"],
                    statuses: ["completed"],
                    date: {
                      kind: "range",
                      from: null,
                      through: "2026-09-20",
                    },
                  },
                ],
              },
              query: {
                mode: "list",
                limit: 2,
                sort: "date",
                direction: "desc",
              },
            });
            assert.equal(meetings.length, 2);
            const cohorts: string[][] = [];
            for (const meeting of meetings) {
              const rows = await invoke("attendance.query", {
                meetingIds: [meeting.id],
                ...(wrong
                  ? { rsvp: ["confirmed"] }
                  : { statuses: ["attended"] }),
                result: { mode: "list" },
              });
              cohorts.push([
                ...new Set(
                  rows.flatMap(
                    (r) =>
                      r.facts
                        ?.filter((f) => f.label === "person_id")
                        .map((f) => f.value) ?? []
                  )
                ),
              ]);
            }
            const previous = new Set(cohorts[1]);
            await invoke(
              "people.get_many",
              {
                resource: "person",
                ids: cohorts[0].filter((id) => !previous.has(id)),
              },
              true
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
      for (const id of relationalFixtureIds)
        await t.test(id, async (t) => {
          const scenario = questions.find((q) => q.id === id);
          assert.ok(scenario);
          const fixture = await adapter.prepare(scenario);
          assert.ok(
            fixture,
            `${id} must be bound in the production eval adapter`
          );
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
                facts: good.facts,
              })
            );
            assert.deepEqual(good.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            assert.equal(good.costUsd, 0);
            await t.test(
              "wrong relationship or filter cannot pass the SQL oracle",
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
                  assert.ok(
                    bad.failures.some((f) => f.startsWith("missing_evidence:")),
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
