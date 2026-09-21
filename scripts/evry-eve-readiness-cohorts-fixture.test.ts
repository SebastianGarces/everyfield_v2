import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { questions, regressions } from "@/lib/evry/eve/evals/catalog";
import {
  createFixtureManifest,
  FIXTURE_NOW,
  type FixtureManifest,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { seedHistoricalFixture } from "@/lib/evry/eve/evals/fixtures/historical";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  readinessCohortFixtureIds,
  readinessCohortId,
  seedReadinessCohortFixture,
  readinessCohortExpectations,
  readinessCohortTruth,
  observedReadinessCohortFacts,
} from "@/lib/evry/eve/evals/fixtures/readiness-cohorts";

const mode = process.env.EVRY_EVE_READINESS_COHORT_PROOF;
test(
  "readiness cohort seed, independent truth and optional full production registry proof",
  { skip: mode !== "1" && mode !== "sql", timeout: 240_000 },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const originalFetch = globalThis.fetch;
    const previous = {
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
    };
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_readiness_fixture_never_send";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error(
            "Readiness proof allows only its isolated database proxy"
          );
        }
        return originalFetch(input, init);
      };
      // SQL-only mode does not import or replace the conflicted production service.
      const production =
        mode === "1"
          ? await Promise.all([
              import("@/lib/evry/eve/capabilities/registry"),
              import("@/lib/evry/eligibility/viewer"),
              import("@/lib/evry/eligibility/capabilities"),
              import("@/lib/auth/session-scope"),
            ])
          : null;
      const store = createFixtureStore(stack.container);
      for (const caseId of readinessCohortFixtureIds)
        await t.test(caseId, async () => {
          // Keep standalone seed checks isolated from adapter-owned repetition 0.
          const m = createFixtureManifest(caseId, 1000);
          store.seed(m);
          // Match the adapter's family order, including shared interview distractors.
          seedHistoricalFixture(m, store);
          seedReadinessCohortFixture(m, store);
          const expected = readinessCohortExpectations(m, store);
          assert.ok(expected);
          const truth = readinessCohortTruth(m, store);
          assert.deepEqual(
            truth.openWithoutCompleted,
            [
              m.ids["prospect-new"],
              m.ids["prospect-rsvp-only"],
              ...(caseId === "interviews-06" ? [] : [m.ids["core-jordan"]]),
            ].sort()
          );
          assert.deepEqual(
            truth.orientation,
            [m.ids["prospect-new"], m.ids["prospect-rsvp-only"]].sort()
          );
          assert.deepEqual(
            [...new Set(truth.sundayTasks.map((v) => v.person))].sort(),
            [
              m.ids["prospect-new"],
              m.ids["core-alex"],
              m.ids["core-jordan"],
            ].sort()
          );
          assert.equal(
            truth.sundayTasks.find(
              (v) => v.id === readinessCohortId(m, "open-new")
            )?.owner,
            m.ids["other-actor"]
          );
          assert.equal(
            truth.sundayTasks.find((v) => v.person === m.ids["core-alex"])
              ?.owner,
            m.ids.actor
          );
          assert.ok(!truth.twice.includes(m.ids["prospect-rsvp-only"]));
          assert.ok(!truth.twice.includes(m.ids["prospect-interviewed"]));
          if (caseId === "interviews-06") {
            assert.ok(
              !truth.interviewPool.includes(m.ids["core-alex"]),
              "Historical interview must remain visible"
            );
            assert.equal(
              store.query(
                `select status from persons where id='${m.ids["core-alex"]}'`
              )[0]?.status,
              "prospect",
              "Preserve historical stage distractor"
            );
            assert.equal(
              store.query(
                `select count(*)::int n from meeting_attendance where church_id='${m.ids.plant}' and meeting_id='${m.ids["meeting-one"]}' and person_id in ('${m.ids["prospect-new"]}','${m.ids["prospect-interviewed"]}') and status='attended'`
              )[0]?.n,
              2,
              "Historical attendance pairs remain unchanged"
            );
          }
          assert.ok(
            !truth.orientation.includes(m.ids["core-alex"]),
            "A stage alone is not a signed commitment"
          );
          assert.ok(!truth.orientation.includes(m.ids["prospect-attended"]));
          assert.ok(
            store
              .foreignRecordIds(m)
              .includes(readinessCohortId(m, "foreign-open"))
          );
          if (!production) return;

          const [
            { createEveToolRegistry },
            { requireEvryPlantViewerForSession },
            { authorizeEvryReadCapabilityForSession },
            { withAuthenticatedSessionId },
          ] = production;
          const actor = await requireEvryPlantViewerForSession(m.sessionId);
          const scenario = [...questions, ...regressions].find(
            (c) => c.id === caseId
          );
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
              const result = await authorizeEvryReadCapabilityForSession(
                identity,
                m.sessionId
              );
              assert.ok(result, identity);
              authorized++;
              return result;
            },
          });
          const run = async (
            wrong: boolean,
            adapterRun?: {
              registry: typeof registry;
              manifest: FixtureManifest;
              onPresentResult(callId: string): void;
            }
          ) => {
            const proofManifest = adapterRun?.manifest ?? m;
            const proofTruth = adapterRun
              ? readinessCohortTruth(proofManifest, store)
              : truth;
            return withAuthenticatedSessionId(
              proofManifest.sessionId,
              async () => {
                const calls: CapturedCall[] = [];
                const presented = new Set<string>();
                const before = store.auditStart();
                const invoke = async (
                  name: string,
                  input: unknown,
                  present = false
                ) => {
                  const id = `readiness-${calls.length}`;
                  const output = await (
                    adapterRun?.registry ?? registry
                  ).invoke(name, input, {
                    callId: id,
                  });
                  calls.push({ id, name, input, output });
                  if (present) {
                    presented.add(id);
                    adapterRun?.onPresentResult(id);
                  }
                  return capturedReadArtifactSchema.parse(output);
                };
                type Row = ReturnType<
                  typeof capturedReadArtifactSchema.parse
                >["items"][number];
                const value = (row: Row, label: string) =>
                  row.facts?.find((f) => f.label === label)?.value;
                const people = async (cohort: object) => {
                  const rows: Row[] = [];
                  let afterId: string | undefined;
                  for (let n = 0; n < 10; n++) {
                    const page = await invoke(
                      "people.query",
                      {
                        cohort,
                        result: {
                          mode: "list",
                          limit: 20,
                          ...(afterId ? { afterId } : {}),
                        },
                      },
                      true
                    );
                    rows.push(...page.items);
                    if (rows.length >= page.counts.matched) return rows;
                    assert.ok(page.items.length);
                    afterId = page.items.at(-1)!.id;
                  }
                  throw new Error("Fixture exceeded bounded people pagination");
                };
                if (
                  caseId === "cross-04" ||
                  caseId === "regression-pagination"
                ) {
                  const stages =
                    caseId === "regression-pagination"
                      ? { stages: ["prospect"] }
                      : {};
                  await invoke("people.query", {
                    cohort: { all: { interview: "not_recorded", ...stages } },
                    result: { mode: "list", limit: 20 },
                  });
                  const all = {
                    ...stages,
                    interview: "not_recorded",
                    attendance: { minimumMeetings: 2 },
                  };
                  const first = await invoke(
                    "people.query",
                    { cohort: { all }, result: { mode: "list", limit: 20 } },
                    true
                  );
                  const second = await invoke(
                    "people.query",
                    {
                      cohort: {
                        all: wrong
                          ? { ...stages, attendance: { minimumMeetings: 2 } }
                          : all,
                      },
                      result: {
                        mode: "list",
                        limit: 20,
                        afterId: first.items.at(-1)!.id,
                      },
                    },
                    true
                  );
                  if (!wrong) {
                    assert.equal(first.counts.matched, proofTruth.twice.length);
                    assert.deepEqual(
                      [...first.items, ...second.items].map((r) => r.id),
                      proofTruth.twice.slice(0, 40)
                    );
                    assert.ok(proofTruth.twice.length > 50);
                  }
                } else if (caseId === "notes-03") {
                  await invoke(
                    "people.history.query",
                    {
                      resource: { kind: "follow_up", state: "open" },
                      cohort: wrong
                        ? {}
                        : { all: { followUp: "not_recorded" } },
                      result: { mode: "list", limit: 50 },
                    },
                    true
                  );
                } else if (caseId === "orientations-02") {
                  const rows = await people({
                    all: {
                      ...(wrong
                        ? { stages: ["launch_team"] }
                        : {
                            commitment: {
                              existence: "recorded",
                              types: ["launch_team"],
                            },
                          }),
                      attendance: {
                        maximumMeetings: 0,
                        meetingTypes: ["orientation"],
                      },
                    },
                  });
                  if (!wrong)
                    assert.deepEqual(
                      rows.map((r) => r.id).sort(),
                      proofTruth.orientation
                    );
                } else if (caseId === "meetings-04") {
                  const meetings = await invoke("meetings.query", {
                    where: {
                      all: [
                        {
                          date: {
                            kind: "range",
                            from: "2026-09-20",
                            through: "2026-09-20",
                          },
                          statuses: ["completed"],
                        },
                      ],
                    },
                    query: { mode: "list" },
                  });
                  const attendees = await invoke("attendance.query", {
                    meetingIds: meetings.items.map((r) => r.id),
                    statuses: ["attended"],
                    result: { mode: "list", limit: 50 },
                  });
                  const personIds = [
                    ...new Set(
                      attendees.items.flatMap(
                        (r) => value(r, "person_id") ?? []
                      )
                    ),
                  ];
                  const completed = await invoke("people.history.query", {
                    resource: { kind: "follow_up", state: "completed" },
                    cohort: { all: { personIds } },
                    ...(!wrong
                      ? { dates: { from: "2026-09-20", through: "2026-09-20" } }
                      : {}),
                    result: { mode: "list", limit: 50 },
                  });
                  const completedPeople = new Set(
                    completed.items.flatMap((r) => value(r, "person_id") ?? [])
                  );
                  const pending = personIds.filter(
                    (id) => !completedPeople.has(id)
                  );
                  const tasks = await invoke(
                    "tasks.query",
                    {
                      where: {
                        all: [
                          {
                            category: ["follow_up"],
                            status: ["not_started", "in_progress", "blocked"],
                            linked: { kind: "person", ids: pending },
                          },
                        ],
                      },
                      query: { mode: "list" },
                    },
                    true
                  );
                  assert.ok(tasks.items.length);
                  await invoke(
                    "people.get_many",
                    { resource: "person", ids: pending },
                    true
                  );
                } else {
                  // One defensible example, not a mandated recommendation policy.
                  const pool = await people({
                    all: { interview: "not_recorded" },
                  });
                  assert.deepEqual(
                    pool.map((r) => r.id).sort(),
                    proofTruth.interviewPool
                  );
                  if (wrong && caseId === "interviews-06")
                    await invoke("attendance.query", {
                      rsvp: ["confirmed"],
                      statuses: ["absent"],
                      result: { mode: "list", limit: 50 },
                    });
                  else {
                    const twice = await people({
                      all: {
                        interview: "not_recorded",
                        attendance: { minimumMeetings: 2 },
                      },
                    });
                    assert.deepEqual(
                      twice.map((r) => r.id).sort(),
                      proofTruth.twice
                    );
                  }
                  await invoke("people.history.query", {
                    resource: { kind: "follow_up", state: "completed" },
                    result: { mode: "list", limit: 50 },
                  });
                  if (caseId === "cross-02") {
                    const orientation = await people({
                      // This negative loses recorded orientation absence. Its
                      // interview evidence remains valid; no attendance policy
                      // is imposed on the open-ended recommendation question.
                      all: wrong
                        ? { stages: ["launch_team"] }
                        : {
                            commitment: {
                              existence: "recorded",
                              types: ["launch_team"],
                            },
                            attendance: {
                              maximumMeetings: 0,
                              meetingTypes: ["orientation"],
                            },
                          },
                    });
                    if (!wrong)
                      assert.deepEqual(
                        orientation.map((r) => r.id).sort(),
                        proofTruth.orientation
                      );
                    assert.ok(
                      proofTruth.twice.some((id) =>
                        proofTruth.orientation.includes(id)
                      ),
                      "Separate suggestions retain an overlapping person"
                    );
                  }
                }
                assert.deepEqual(
                  store.writesSince(before, proofManifest),
                  [],
                  "Readiness review must not write application data"
                );
                for (const foreign of store.foreignRecordIds(proofManifest))
                  assert.ok(
                    !JSON.stringify(calls.map((c) => c.output)).includes(
                      foreign
                    ),
                    "Foreign fixture record escaped"
                  );
                return {
                  calls,
                  result: observedReadinessCohortFacts(
                    caseId,
                    calls,
                    presented
                  ),
                };
              }
            );
          };
          const good = await run(false);
          for (const [key, expectedValue] of Object.entries(expected.facts))
            assert.deepEqual(
              good.result.facts[key],
              expectedValue,
              `${caseId}: ${key}`
            );
          for (const required of expected.requiredEvidence)
            assert.ok(
              good.result.evidence.includes(required),
              `${caseId}: ${required}`
            );
          const wrong = await run(true);
          assert.ok(
            Object.entries(expected.facts).some(
              ([key, v]) => !isDeepStrictEqual(wrong.result.facts[key], v)
            ) ||
              expected.requiredEvidence.some(
                (v) => !wrong.result.evidence.includes(v)
              ),
            `${caseId}: wrong production query must fail grading`
          );
          assert.equal(
            authorized,
            good.calls.length + wrong.calls.length,
            "Every registry read refreshes authority"
          );

          // Exercise the actual fixture adapter, including all shared family
          // seeds, trusted capture, independent expectations and grading.
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          const adapterManifest = createFixtureManifest(caseId, 0);
          let wrongAdapterQuery = false;
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction(context) {
              assert.deepEqual(
                context.scenario.turns,
                scenario.turns,
                "Adapter must preserve the original user turns"
              );
              assert.equal(context.actor.plantId, adapterManifest.ids.plant);
              await run(wrongAdapterQuery, {
                registry: context.registry,
                manifest: adapterManifest,
                onPresentResult: context.onPresentResult,
              });
              return {
                answer:
                  "Scripted production-tool fixture, not a model-quality judgment.",
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
          assert.ok(fixture, `${caseId} must be bound by the real adapter`);
          try {
            assert.deepEqual(
              fixture.expectations,
              readinessCohortExpectations(adapterManifest, store)
            );
            const observe = async () =>
              observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0,
                })
              );
            const goodObservation = await observe();
            assert.deepEqual(
              gradeObservation(caseId, fixture.expectations, goodObservation)
                .failures,
              ["quality_not_reviewed"]
            );
            assert.deepEqual(goodObservation.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            assert.equal(goodObservation.costUsd, 0);
            wrongAdapterQuery = true;
            const wrongObservation = await observe();
            const failures = gradeObservation(
              caseId,
              fixture.expectations,
              wrongObservation
            ).failures;
            assert.ok(failures.includes("quality_not_reviewed"));
            assert.ok(
              failures.some(
                (failure) =>
                  failure.startsWith("fact:") ||
                  failure.startsWith("missing_evidence:")
              ),
              `${caseId}: actual adapter must reject the wrong query`
            );
            assert.deepEqual(wrongObservation.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
          } finally {
            await fixture.cleanup?.();
          }
        });
      assert.equal(outbound, 0);
      t.diagnostic(
        mode === "sql"
          ? "SQL seed/truth only; production registry execution explicitly NOT tested"
          : "Production registry reads and wrong-query controls verified; no model-quality claim"
      );
    } finally {
      globalThis.fetch = originalFetch;
      neonConfig.fetchEndpoint = previous.endpoint;
      if (previous.database === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = previous.database;
      if (previous.resend === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = previous.resend;
      await stack.cleanup();
    }
  }
);
