import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { regressions } from "@/lib/evry/eve/evals/catalog";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  weeklyBriefExpectations,
  seedWeeklyBriefFixture,
  seedWeeklyBriefRecordedHistory,
  observedWeeklyBriefFacts,
} from "@/lib/evry/eve/evals/fixtures/weekly-brief";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";

type Variant =
  | "complete"
  | "aggregate"
  | "wrong-count-scope"
  | "partial-milestones"
  | "wrong-milestones"
  | "missing-history-read"
  | "filtered-history";
async function retrieve(
  invoke: (name: string, input: unknown) => Promise<unknown>,
  variant: Variant = "complete"
) {
  const content = async (
    name: string,
    query: Record<string, unknown>,
    partial = false
  ) => {
    let offset = 0;
    for (let page = 0; page < 10; page++) {
      const output = await invoke(name, {
        query: { ...query, limit: 2, offset },
      });
      const filters = z
        .object({
          filters: z.array(z.object({ label: z.string(), value: z.string() })),
        })
        .parse(output).filters;
      const next = filters.find((f) => f.label === "Next offset");
      if (!next || partial) return;
      const parsed = Number(next.value);
      assert.ok(Number.isSafeInteger(parsed) && parsed > offset);
      offset = parsed;
    }
    assert.fail("Fixture content pagination did not finish");
  };
  await content("launch.query", { resource: "status", mode: "list" });
  const aggregate = variant === "aggregate" || variant === "wrong-count-scope";
  if (aggregate) {
    await invoke("launch.query", {
      query: {
        resource: "milestones",
        mode: "count",
        completion: "open",
        ...(variant === "wrong-count-scope" ? { area: "operations" } : {}),
      },
    });
    await invoke("teams.query", {
      request: {
        resource: "roles",
        where: { all: [{ vacant: true }] },
        query: { mode: "count" },
      },
    });
  } else {
    await content(
      "launch.query",
      {
        resource: "milestones",
        mode: "list",
        completion: variant === "wrong-milestones" ? "complete" : "open",
      },
      variant === "partial-milestones"
    );
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const output = await invoke("teams.query", {
        request: {
          resource: "roles",
          where: { all: [{ vacant: true }] },
          query: { mode: "list", limit: 1, cursor },
        },
      });
      const next = z
        .object({
          filters: z.array(z.object({ label: z.string(), value: z.string() })),
        })
        .parse(output)
        .filters.find((f) => f.label === "Next page cursor");
      assert.ok(next);
      if (next.value === "End of results") break;
      assert.ok(next.value !== cursor);
      cursor = next.value;
      if (page === 9) assert.fail("Fixture role pagination did not finish");
    }
  }
  if (variant !== "missing-history-read")
    await content("intelligence.query", {
      resource: "assessments",
      includeFactSnapshot: true,
      ...(variant === "filtered-history"
        ? {
            window: {
              from: "2026-01-01T00:00:00Z",
              until: "2026-01-02T00:00:00Z",
            },
          }
        : {}),
    });
}

function expectedFactsOnly(
  observed: Record<string, unknown>,
  expected: Record<string, unknown>
) {
  return Object.fromEntries(
    Object.keys(expected).map((key) => [key, observed[key]])
  );
}

test(
  "weekly brief retains real current findings without inventing historical readiness",
  { skip: process.env.EVRY_EVE_WEEKLY_BRIEF_PROOF !== "1", timeout: 240_000 },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const previous = {
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
      fetch: globalThis.fetch,
    };
    let external = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_no_send";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          external++;
          throw new Error("External requests prohibited in weekly fixture");
        }
        return previous.fetch(input, init);
      };
      const [
        { createEveToolRegistry },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
        { withAuthenticatedSessionId },
      ] = await Promise.all([
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
        import("@/lib/auth/session-scope"),
      ]);
      const store = createFixtureStore(stack.container),
        m = createFixtureManifest("regression-partial-outage", 500),
        scenario = regressions.find((r) => r.id === m.caseId)!;
      store.seed(m);
      seedWeeklyBriefFixture(m, store);
      const expected = weeklyBriefExpectations(m, store);
      assert.ok(expected);
      assert.equal(expected.facts.historicalComparisonAvailable, false);
      assert.equal(expected.facts.historicalAttendanceCount, null);
      assert.equal(expected.facts.incompleteMilestoneCount, 5);
      assert.equal(expected.facts.openRoleCount, 2);
      assert.equal(expected.facts.launchDate, "2026-10-11");
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      const registry = createEveToolRegistry({
        context: {
          actor,
          literalUserText: scenario.turns[0]!,
          pageContext: null,
          now: new Date(m.now),
        },
        authorizeRead: (identity) =>
          authorizeEvryReadCapabilityForSession(identity, m.sessionId),
      });
      let calls: CapturedCall[] = [];
      const invoke = async (name: string, input: unknown) => {
        const id = `weekly-${calls.length}`;
        const output = await withAuthenticatedSessionId(m.sessionId, () =>
          registry.invoke(name, input, { callId: id })
        );
        calls.push({ id, name, input, output });
        return output;
      };
      const audit = store.auditStart();
      await t.test(
        "production reads all five remaining milestones and two actual vacant roles with no complete own history",
        async () => {
          await retrieve(invoke);
          const observed = observedWeeklyBriefFacts(m.caseId, calls);
          assert.deepEqual(
            expectedFactsOnly(observed.facts, expected.facts),
            expected.facts
          );
          assert.deepEqual(observed.evidence, expected.requiredEvidence);
          for (const call of calls)
            for (const forbidden of expected.absentRecordIds)
              assert.ok(!JSON.stringify(call.output).includes(forbidden));
          assert.equal(
            calls.filter(
              (c) =>
                c.name === "launch.query" &&
                JSON.stringify(c.input).includes('"milestones"')
            ).length,
            3
          );
          assert.equal(calls.filter((c) => c.name === "teams.query").length, 2);
          const history = capturedReadArtifactSchema.parse(
            calls.at(-1)!.output
          );
          assert.equal(history.counts.matched, 0);
        }
      );
      await t.test(
        "actual SQL count queries establish the same totals as complete paged lists",
        async () => {
          calls = [];
          await retrieve(invoke, "aggregate");
          const observed = observedWeeklyBriefFacts(m.caseId, calls);
          assert.deepEqual(
            expectedFactsOnly(observed.facts, expected.facts),
            expected.facts
          );
          assert.deepEqual(observed.evidence, expected.requiredEvidence);
          const counts = calls.filter((call) =>
            JSON.stringify(call.input).includes('"mode":"count"')
          );
          assert.equal(counts.length, 2);
          assert.deepEqual(
            counts.map(
              (call) =>
                z
                  .object({
                    resultMode: z.literal("count"),
                    counts: z.object({ matched: z.number() }),
                  })
                  .parse(call.output).counts.matched
            ),
            [5, 2]
          );
          assert.equal(observed.facts.incompleteMilestoneIds, undefined);
          assert.equal(observed.facts.openRoleTeams, undefined);
        }
      );
      await t.test(
        "partial and wrong milestone results plus missing or filtered history reads cannot earn full evidence",
        async () => {
          for (const variant of [
            "partial-milestones",
            "wrong-milestones",
            "missing-history-read",
            "filtered-history",
            "wrong-count-scope",
          ] as const) {
            calls = [];
            await retrieve(invoke, variant);
            assert.notDeepEqual(
              expectedFactsOnly(
                observedWeeklyBriefFacts(m.caseId, calls).facts,
                expected.facts
              ),
              expected.facts,
              variant
            );
          }
        }
      );
      assert.deepEqual(store.writesSince(audit, m), []);
      await t.test(
        "a real historical zero is available history, never the default missing state",
        async () => {
          seedWeeklyBriefRecordedHistory(m, store);
          const controlExpected = weeklyBriefExpectations(m, store),
            controlAudit = store.auditStart();
          assert.ok(controlExpected);
          calls = [];
          await retrieve(invoke);
          assert.equal(
            controlExpected.facts.historicalComparisonAvailable,
            true
          );
          assert.equal(controlExpected.facts.historicalAttendanceCount, 0);
          assert.deepEqual(
            expectedFactsOnly(
              observedWeeklyBriefFacts(m.caseId, calls).facts,
              controlExpected.facts
            ),
            controlExpected.facts
          );
          assert.deepEqual(store.writesSince(controlAudit, m), []);
          await invoke("intelligence.query", {
            query: {
              resource: "assessments",
              window: {
                from: "2026-01-01T00:00:00Z",
                until: "2026-01-02T00:00:00Z",
              },
              includeFactSnapshot: true,
            },
          });
          assert.equal(
            observedWeeklyBriefFacts(m.caseId, calls).facts
              .historicalComparisonAvailable,
            undefined,
            "An empty filtered refresh must not reuse the older successful snapshot"
          );
        }
      );
      await t.test(
        "actual adapter grades current evidence without cards or manufactured model quality",
        async () => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          let variant: Variant = "complete";
          const sessions: string[] = [];
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({ scenario, registry, sessionId }) {
              sessions.push(sessionId);
              assert.deepEqual(scenario.turns, [
                "Give me our weekly operational brief.",
              ]);
              let n = 0;
              await retrieve(
                (name, input) =>
                  registry.invoke(name, input, {
                    callId: `adapter-weekly-${n++}`,
                  }),
                variant
              );
              return {
                eveSessionId: sessionId,
                answer: "Scripted data-path proof; quality not reviewed.",
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
          assert.ok(fixture);
          try {
            for (const mode of [
              "complete",
              "aggregate",
              "wrong-count-scope",
              "partial-milestones",
              "missing-history-read",
            ] as const) {
              variant = mode;
              const observation = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(45_000),
                  maxCostUsd: 0.1,
                })
              );
              const failures: readonly string[] = gradeObservation(
                scenario.id,
                fixture.expectations,
                observation
              ).failures;
              assert.deepEqual(observation.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              assert.equal(observation.judge, null);
              assert.equal(observation.costUsd, 0);
              if (mode === "complete" || mode === "aggregate")
                assert.deepEqual(
                  failures,
                  ["quality_not_reviewed"],
                  JSON.stringify(observation.facts)
                );
              else
                assert.ok(
                  failures.some((f) => f.startsWith("fact:")),
                  JSON.stringify(failures)
                );
            }
          } finally {
            await fixture.cleanup();
          }
          for (const session of new Set(sessions))
            assert.equal(
              store.sql(`select count(*) from sessions where id='${session}'`),
              "0"
            );
        }
      );
      assert.equal(external, 0);
    } finally {
      globalThis.fetch = previous.fetch;
      neonConfig.fetchEndpoint = previous.endpoint;
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.resend;
      await stack.cleanup();
    }
  }
);
