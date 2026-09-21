import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { questions, regressions } from "@/lib/evry/eve/evals/catalog";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  taskCalendarFixtureIds,
  taskCalendarReferenceInstant,
  seedTaskCalendarFixture,
  taskCalendarTruth,
} from "@/lib/evry/eve/evals/fixtures/task-calendar";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { observationSchema } from "@/lib/evry/eve/evals/contract";

test(
  "task calendars and linked assignees through production adapter and native SQL",
  { skip: process.env.EVRY_EVE_TASK_CALENDAR_PROOF !== "1", timeout: 180_000 },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const previousDatabase = process.env.DATABASE_URL,
      previousEndpoint = neonConfig.fetchEndpoint,
      originalFetch = globalThis.fetch;
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
      const store = createFixtureStore(stack.container);
      for (const id of taskCalendarFixtureIds)
        await t.test(id, async () => {
          let wrong:
            | "none"
            | "date"
            | "person-as-account"
            | "one-assignee"
            | "completed"
            | "relative-day" = "none";
          let alternative = false;
          const scenario = [...questions, ...regressions].find(
            (s) => s.id === id
          );
          assert.ok(scenario);
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction(context) {
              assert.deepEqual(context.scenario.turns, scenario.turns);
              assert.equal(
                context.now.toISOString(),
                taskCalendarReferenceInstant(id).toISOString()
              );
              const clock = !alternative
                ? z
                    .object({ today: z.string().date(), timeZone: z.string() })
                    .parse(
                      await context.registry.invoke(
                        "context.get",
                        {},
                        { callId: "clock" }
                      )
                    )
                : z
                    .object({
                      calendarDate: z.string().date(),
                      timeZone: z.string(),
                    })
                    .parse(
                      await context.registry.invoke(
                        "calendar.resolve",
                        {
                          date: {
                            kind: "relative_day",
                            daysFromToday: wrong === "relative-day" ? 1 : 0,
                          },
                        },
                        { callId: "clock" }
                      )
                    );
              assert.equal(clock.timeZone, "America/New_York");
              let filter: object;
              if (id === "regression-multi-assignee") {
                const accounts: string[] = [],
                  persons: string[] = [];
                for (const name of ["Alex", "Jordan"]) {
                  const found = capturedReadArtifactSchema.parse(
                    await context.registry.invoke(
                      alternative ? "people.query" : "tasks.assignees.search",
                      alternative
                        ? {
                            cohort: { all: { search: name } },
                            result: { mode: "list", limit: 50 },
                          }
                        : { search: name, limit: 50 },
                      { callId: `assignee-${name}` }
                    )
                  );
                  assert.equal(
                    found.items.length,
                    alternative && name === "Jordan" ? 2 : 1,
                    "Person resolution includes the unlinked Jordan; the actual assignment join must exclude it"
                  );
                  for (const row of found.items) {
                    if (alternative) {
                      persons.push(row.id);
                      continue;
                    }
                    accounts.push(row.id);
                    persons.push(
                      z
                        .uuid()
                        .parse(
                          row.facts?.find((f) => f.label === "Person ID")?.value
                        )
                    );
                  }
                }
                if (!alternative)
                  assert.deepEqual(
                    persons
                      .map((person, index) => `${person}:${accounts[index]}`)
                      .sort(),
                    taskCalendarTruth(createFixtureManifest(id, 0), store)
                      .links,
                    "The explicit account route preserves independent SQL account/person pairs"
                  );
                const calendar = z
                  .object({
                    dateWindow: z.object({
                      from: z.string().date(),
                      through: z.string().date(),
                    }),
                  })
                  .parse(
                    await context.registry.invoke(
                      "calendar.resolve",
                      { date: { kind: "period", period: "this_week" } },
                      { callId: "week" }
                    )
                  );
                filter = {
                  assignment: {
                    kind: alternative ? "people" : "accounts",
                    ids:
                      alternative || wrong === "person-as-account"
                        ? persons
                        : wrong === "one-assignee"
                          ? accounts.slice(0, 1)
                          : accounts,
                  },
                  ...(wrong === "completed"
                    ? {}
                    : { status: ["not_started", "in_progress", "blocked"] }),
                  ...(wrong === "date"
                    ? {}
                    : { due: { kind: "range", ...calendar.dateWindow } }),
                };
              } else
                filter = {
                  due:
                    wrong === "date"
                      ? {
                          kind: "range",
                          from: context.now.toISOString().slice(0, 10),
                          through: context.now.toISOString().slice(0, 10),
                        }
                      : alternative && "calendarDate" in clock
                        ? {
                            kind: "range",
                            from: clock.calendarDate,
                            through: clock.calendarDate,
                          }
                        : { kind: "relative", period: "today" },
                  ...(wrong === "completed"
                    ? { status: ["not_started", "in_progress", "blocked"] }
                    : {}),
                };
              await context.registry.invoke(
                "tasks.query",
                {
                  where: { all: [filter] },
                  query: { mode: "list", limit: 50 },
                },
                { callId: "tasks" }
              );
              return {
                answer:
                  "Scripted production query, not a model-quality review.",
                clarificationCount: 0,
                costUsd: 0,
                judge: null,
                latency: {
                  acknowledgementMs: 0,
                  firstTextMs: null,
                  totalMs: 0,
                },
              };
            },
          });
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${id} must be adapter-bound`);
          try {
            const observe = async () =>
              observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0,
                })
              );
            const good = await observe();
            assert.deepEqual(
              gradeObservation(id, fixture.expectations, good).failures,
              ["quality_not_reviewed"]
            );
            assert.deepEqual(good.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            alternative = true;
            const composed = await observe();
            assert.deepEqual(
              gradeObservation(id, fixture.expectations, composed).failures,
              ["quality_not_reviewed"],
              "Supported calendar/person composition must pass without redundant context or account lookup"
            );
            assert.deepEqual(composed.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            if (id !== "regression-multi-assignee") {
              wrong = "relative-day";
              const wrongDay = gradeObservation(
                id,
                fixture.expectations,
                await observe()
              );
              assert.ok(wrongDay.failures.includes("fact:taskIds"));
              assert.ok(
                wrongDay.failures.includes(
                  "missing_evidence:church-local-calendar"
                )
              );
            }
            alternative = false;
            for (const negative of id === "regression-multi-assignee"
              ? ([
                  "person-as-account",
                  "one-assignee",
                  "date",
                  "completed",
                ] as const)
              : (["date", "completed"] as const)) {
              wrong = negative;
              const result = gradeObservation(
                id,
                fixture.expectations,
                await observe()
              );
              assert.ok(
                result.failures.includes("fact:taskIds"),
                `${id}: ${negative} must change actual results`
              );
              assert.ok(result.failures.includes("quality_not_reviewed"));
            }
          } finally {
            await fixture.cleanup?.();
          }
        });

      // Same real reads at trusted server-clock boundaries. Calendar expectations
      // come from PostgreSQL, not the production date resolver being tested.
      const { createEveToolRegistry } =
        await import("@/lib/evry/eve/capabilities/registry");
      const { requireEvryPlantViewerForSession } =
        await import("@/lib/evry/eligibility/viewer");
      const { authorizeEvryReadCapabilityForSession } =
        await import("@/lib/evry/eligibility/capabilities");
      const { withAuthenticatedSessionId } =
        await import("@/lib/auth/session-scope");
      const m = createFixtureManifest("edges-02", 1000);
      store.seed(m);
      seedTaskCalendarFixture(m, store);
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      for (const [instant, day] of [
        ["2026-09-20T03:59:59Z", "2026-09-19"],
        ["2026-09-20T04:00:00Z", "2026-09-20"],
        ["2026-03-08T04:30:00Z", "2026-03-07"],
        ["2026-03-08T07:30:00Z", "2026-03-08"],
        ["2026-11-01T05:30:00Z", "2026-11-01"],
        ["2026-11-01T06:30:00Z", "2026-11-01"],
      ])
        await t.test(`server clock ${instant}`, async () => {
          const now = new Date(instant),
            truth = taskCalendarTruth(m, store, now),
            before = store.auditStart();
          assert.equal(truth.day, day);
          let authorizationCount = 0;
          const registry = createEveToolRegistry({
            context: {
              actor,
              now,
              literalUserText:
                "List tasks due today when I am traveling in a different timezone.",
              pageContext: null,
            },
            async authorizeRead(identity) {
              authorizationCount++;
              return authorizeEvryReadCapabilityForSession(
                identity,
                m.sessionId
              );
            },
          });
          await withAuthenticatedSessionId(m.sessionId, async () => {
            const context = z
              .object({ today: z.string(), timeZone: z.string() })
              .parse(
                await registry.invoke("context.get", {}, { callId: "clock" })
              );
            assert.equal(context.today, truth.day);
            assert.equal(context.timeZone, truth.zone);
            const result = capturedReadArtifactSchema.parse(
              await registry.invoke(
                "tasks.query",
                {
                  where: {
                    all: [{ due: { kind: "relative", period: "today" } }],
                  },
                  query: { mode: "list", limit: 50 },
                },
                { callId: "today" }
              )
            );
            assert.deepEqual(
              result.items.map((r) => r.id).sort(),
              truth.taskIds
            );
            assert.equal(result.counts.matched, truth.taskIds.length);
          });
          assert.equal(authorizationCount, 2);
          assert.deepEqual(store.writesSince(before, m), []);
        });
      assert.equal(outbound, 0);
    } finally {
      globalThis.fetch = originalFetch;
      neonConfig.fetchEndpoint = previousEndpoint;
      if (previousDatabase === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previousDatabase;
      await stack.cleanup();
    }
  }
);
