import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { seedHistoricalFixture } from "@/lib/evry/eve/evals/fixtures/historical";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  peopleCohortsFixtureIds,
  seedPeopleCohortsFixture,
  peopleCohortsExpectations,
  observedPeopleCohortsFacts,
} from "@/lib/evry/eve/evals/fixtures/people-cohorts";
import type { createEveToolRegistry } from "@/lib/evry/eve/capabilities/registry";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";

/** Scripted caller exercises schemas/SQL, not model quality or a required reasoning policy. */
async function retrieve(
  registry: ReturnType<typeof createEveToolRegistry>,
  caseId: string,
  wrong = false,
  onPresentResult?: (id: string) => void,
  listAggregates = false
) {
  const calls: CapturedCall[] = [];
  const invoke = async (name: string, input: unknown) => {
    const id = `cohorts-${calls.length}`;
    const output = await registry.invoke(name, input, { callId: id });
    calls.push({ id, name, input, output });
    return output;
  };
  const read = async (name: string, input: unknown) =>
    capturedReadArtifactSchema
      .extend({
        filters: z.array(z.object({ label: z.string(), value: z.string() })),
      })
      .parse(await invoke(name, input));
  const list = async (cohort: unknown, onlyFirst = false) => {
    let afterId: string | undefined;
    do {
      const result = await read("people.query", {
        cohort,
        result: { mode: "list", limit: 2, ...(afterId ? { afterId } : {}) },
      });
      onPresentResult?.(calls.at(-1)!.id);
      const cursor = result.filters.find(
        (f) => f.label === "Next page cursor"
      )?.value;
      afterId = cursor && cursor !== "End of results" ? cursor : undefined;
      if (onlyFirst) break;
      assert.ok(
        calls.length < 12,
        "Bounded fixture must not loop indefinitely"
      );
    } while (afterId);
  };
  if (caseId === "people-01") {
    // Two matching people must be shown/clarified; never resolve to the first ID.
    const result = await read("people.query", {
      cohort: { all: { search: "Alex Rivera" } },
      result: { mode: "list", limit: wrong ? 1 : 20 },
    });
    if (!wrong)
      await invoke("people.get_many", {
        resource: "person",
        ids: result.items.map((i) => i.id),
        fields: ["contact", "household"],
      });
  }
  if (caseId === "people-07") await list({}, wrong);
  if (caseId === "people-04")
    await read("people.query", {
      cohort: wrong ? { all: { household: "assigned" } } : {},
      result: { mode: "group", by: "stage" },
    });
  if (caseId === "commitments-02")
    await list({
      all: {
        ...(wrong ? { stages: ["interviewed"] } : { interview: "recorded" }),
        commitment: { existence: "not_recorded" },
      },
    });
  if (caseId === "interviews-04" || caseId === "commitments-04") {
    const period = z
      .object({
        dateWindow: z.object({
          from: z.string().date(),
          through: z.string().date(),
        }),
      })
      .parse(
        await invoke("calendar.resolve", {
          date: { kind: "period", period: "this_month" },
        })
      );
    const today = z.object({ calendarDate: z.string().date() }).parse(
      await invoke("calendar.resolve", {
        date: { kind: "relative_day", daysFromToday: 0 },
      })
    );
    const criteria = {
      resource: {
        kind: caseId === "interviews-04" ? "interviews" : "commitments",
      },
      dateBasis:
        caseId === "interviews-04"
          ? wrong
            ? "created_at"
            : "record_date"
          : wrong
            ? "record_date"
            : "created_at",
      dates: { from: period.dateWindow.from, through: today.calendarDate },
    };
    let afterId: string | undefined;
    do {
      const result = await read("people.history.query", {
        ...criteria,
        result: listAggregates
          ? { mode: "list", limit: 2, ...(afterId ? { afterId } : {}) }
          : {
              mode: "group",
              by: caseId === "interviews-04" ? "author" : "outcome",
            },
      });
      const cursor = result.filters.find(
        (f) => f.label === "Next page cursor"
      )?.value;
      afterId = cursor && cursor !== "End of results" ? cursor : undefined;
      assert.ok(calls.length < 12);
    } while (listAggregates && afterId);
  }
  return calls;
}

test(
  "six people cohorts use authorized production queries and independent SQL",
  { skip: process.env.EVRY_EVE_PEOPLE_COHORTS_PROOF !== "1", timeout: 240_000 },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const original = {
      fetch: globalThis.fetch,
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
    };
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_people_cohorts_never_send";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only the owned database proxy is allowed");
        }
        return original.fetch(input, init);
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
      const store = createFixtureStore(stack.container);
      for (const caseId of peopleCohortsFixtureIds)
        await t.test(caseId, async () => {
          const m = createFixtureManifest(caseId, 1000);
          store.seed(m);
          seedHistoricalFixture(m, store);
          seedPeopleCohortsFixture(m, store);
          try {
            const expected = peopleCohortsExpectations(m, store);
            assert.ok(expected);
            const actor = await requireEvryPlantViewerForSession(m.sessionId);
            const scenario = questions.find((q) => q.id === caseId);
            assert.ok(scenario);
            let authorized = 0;
            const registry = createEveToolRegistry({
              context: {
                actor,
                literalUserText: scenario.turns.join("\n"),
                pageContext: null,
                now: FIXTURE_NOW,
              },
              async authorizeRead(identity) {
                const authorization =
                  await authorizeEvryReadCapabilityForSession(
                    identity,
                    m.sessionId
                  );
                assert.ok(authorization);
                authorized++;
                return authorization;
              },
            });
            const before = store.auditStart();
            const goodCalls = await withAuthenticatedSessionId(
              m.sessionId,
              () => retrieve(registry, caseId)
            );
            const good = observedPeopleCohortsFacts(
              caseId,
              goodCalls,
              new Set()
            );
            assert.deepEqual(
              good.facts,
              expected.facts,
              JSON.stringify({
                caseId,
                expected: expected.facts,
                actual: good.facts,
              })
            );
            assert.deepEqual(good.evidence, expected.requiredEvidence);
            if (caseId === "interviews-04" || caseId === "commitments-04") {
              const listed = await withAuthenticatedSessionId(m.sessionId, () =>
                retrieve(registry, caseId, false, undefined, true)
              );
              assert.deepEqual(
                observedPeopleCohortsFacts(caseId, listed, new Set()).facts,
                expected.facts
              );
            }
            assert.ok(authorized > 0);
            for (const foreign of expected.absentRecordIds ?? [])
              assert.ok(
                !JSON.stringify(goodCalls.map((c) => c.output)).includes(
                  foreign
                ),
                `Foreign identity leaked: ${foreign}`
              );
            const badCalls = await withAuthenticatedSessionId(m.sessionId, () =>
              retrieve(registry, caseId, true)
            );
            const bad = observedPeopleCohortsFacts(caseId, badCalls, new Set());
            assert.ok(
              !isDeepStrictEqual(bad.facts, expected.facts),
              `${caseId} wrong plausible query must fail`
            );
            assert.deepEqual(store.writesSince(before, m), []);
          } finally {
            store.revoke(m);
          }
        });
      // Run the real adapter too: this catches shared family seed ordering and grader wiring.
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      const adapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry, onPresentResult }) {
          await retrieve(registry, scenario.id, false, onPresentResult);
          return {
            answer:
              "Scripted production query proof; model quality is not reviewed.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const caseId of peopleCohortsFixtureIds)
        await t.test(`${caseId}: adapter and grade`, async () => {
          const scenario = questions.find((q) => q.id === caseId);
          assert.ok(scenario);
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${caseId} adapter binding required`);
          try {
            const observation = observationSchema.parse(
              await fixture.run({
                scenario,
                signal: AbortSignal.timeout(30_000),
                maxCostUsd: 0,
              })
            );
            assert.deepEqual(
              gradeObservation(caseId, fixture.expectations, observation)
                .failures,
              ["quality_not_reviewed"]
            );
            assert.deepEqual(observation.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
          } finally {
            await fixture.cleanup();
          }
        });
      assert.equal(outbound, 0);
    } finally {
      globalThis.fetch = original.fetch;
      neonConfig.fetchEndpoint = original.endpoint;
      if (original.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original.database;
      if (original.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = original.resend;
      await stack.cleanup();
    }
  }
);
