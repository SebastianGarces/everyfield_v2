import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { createFixtureManifest, FIXTURE_NOW } from "./manifest";
import { createFixtureStore } from "./store";
import { startFixtureStack } from "./stack";
import { regressions, questions } from "../catalog";
import { gradeObservation } from "../grade";
import { observationSchema } from "../contract";

test("manifest identities and digests are deterministic and tenant-separated", () => {
  assert.deepEqual(
    createFixtureManifest("test", 0),
    createFixtureManifest("test", 0)
  );
  assert.notEqual(
    createFixtureManifest("test", 0).ids.plant,
    createFixtureManifest("test", 1).ids.plant
  );
  assert.throws(() => createFixtureStore("allelo-postgres-1"));
});

test(
  "actual migrated database, fresh actor and production registry produce independently checked evidence",
  { skip: process.env.EVRY_EVE_FIXTURE_PROOF !== "1", timeout: 180_000 },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_eve_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      const { createProductionEveEvalAdapter } = await import("./adapter");
      const { createEveToolRegistry } =
        await import("../../capabilities/registry");
      const { requireEvryPlantViewerForSession } =
        await import("@/lib/evry/eligibility/viewer");
      const { authorizeEvryReadCapabilityForSession } =
        await import("@/lib/evry/eligibility/capabilities");
      const store = createFixtureStore(stack.container);
      let attemptForbiddenEffects = false;
      const adapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry, onPresentResult, actor }) {
          let call = 0;
          const invoke = async (name: string, input: unknown) => {
            const callId = `proof-${call++}`;
            const result = await registry.invoke(name, input, { callId });
            assert.equal(typeof result, "object");
            assert.equal(
              typeof result === "object" &&
                result !== null &&
                !Array.isArray(result) &&
                result.kind,
              "read",
              JSON.stringify(result)
            );
            onPresentResult(callId);
            return result;
          };
          if (
            scenario.id.startsWith("regression-today") ||
            scenario.id === "regression-followup-priority" ||
            scenario.id === "regression-readable-copy"
          ) {
            const filter = {
              assignment: { kind: "mine" },
              due: { kind: "relative", period: "today" },
              status: ["not_started", "in_progress", "blocked"],
            };
            const first = await invoke("tasks.query", {
              where: { all: [filter] },
              query: { mode: "list" },
            });
            if (scenario.id === "regression-followup-priority") {
              assert.equal(
                z
                  .object({ counts: z.object({ matched: z.number() }) })
                  .parse(first).counts.matched,
                2
              );
              await invoke("tasks.query", {
                where: { all: [filter, { priority: ["high"] }] },
                query: { mode: "list" },
              });
            }
          } else if (
            scenario.id === "regression-no-n-plus-one" ||
            scenario.id === "regression-separate-cohorts"
          ) {
            await invoke("people.query", {
              cohort: {
                all: {
                  stages: ["prospect"],
                  followUp: "recorded",
                  interview: "not_recorded",
                },
              },
              result: { mode: "list" },
            });
            if (scenario.id === "regression-separate-cohorts")
              await invoke("people.query", {
                cohort: {
                  all: { stages: ["prospect"], followUp: "not_recorded" },
                },
                result: { mode: "list" },
              });
          } else if (scenario.id === "regression-attendance-not-rsvp")
            await invoke("people.query", {
              cohort: {
                all: {
                  interview: "not_recorded",
                  attendance: { minimumMeetings: 2 },
                },
              },
              result: { mode: "list" },
            });
          else if (scenario.id === "regression-launch-overview") {
            await invoke("launch.query", {
              query: { resource: "status", mode: "list" },
            });
            await invoke("launch.query", {
              query: {
                resource: "milestones",
                mode: "list",
                completion: "open",
              },
            });
            await invoke("teams.query", {
              request: {
                resource: "roles",
                where: { all: [{ vacant: true }] },
                query: { mode: "list" },
              },
            });
            await invoke("meetings.query", {
              where: {
                all: [
                  {
                    date: {
                      kind: "range",
                      from: "2026-09-20",
                      through: "2026-09-30",
                    },
                  },
                ],
              },
              query: { mode: "list" },
            });
          }
          if (attemptForbiddenEffects) {
            store.sql(
              `update tasks set title=title || ' changed' where church_id='${actor.plantId}' and due_date='2026-09-20' and status='not_started';`
            );
            await assert.rejects(
              () =>
                fetch("https://api.resend.com/emails", {
                  method: "POST",
                  body: "{}",
                }),
              /Eval outbound email blocked/
            );
          }
          // This is a scripted tool-path proof, not a paid model/quality pass.
          return {
            answer: "Tool-path fixture proof only.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const id of [
        "regression-today",
        "regression-followup-priority",
        "regression-no-n-plus-one",
        "regression-separate-cohorts",
        "regression-attendance-not-rsvp",
        "regression-launch-overview",
      ])
        await t.test(id, async () => {
          const scenario = regressions.find((row) => row.id === id)!;
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture);
          try {
            const observation = observationSchema.parse(
              await fixture.run({
                scenario,
                signal: AbortSignal.timeout(30_000),
                maxCostUsd: 0.1,
              })
            );
            const grade = gradeObservation(
              id,
              fixture.expectations,
              observation
            );
            assert.deepEqual(
              grade.failures,
              ["quality_not_reviewed"],
              JSON.stringify(grade)
            );
          } finally {
            await fixture.cleanup();
          }
        });
      await t.test(
        "private host capture mode grades real tool outputs, not runner facts",
        async () => {
          const httpAdapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            captureMode: "isolated_http",
            async runProduction({ actor, sessionId, sessionToken, now }) {
              assert.ok(sessionToken.length > 0);
              let freshAuthorizations = 0;
              const directRegistry = createEveToolRegistry({
                context: {
                  actor,
                  literalUserText: "My pending tasks due today",
                  pageContext: null,
                  now,
                },
                async authorizeRead(identity) {
                  const result = await authorizeEvryReadCapabilityForSession(
                    identity,
                    sessionId
                  );
                  if (result) freshAuthorizations++;
                  return result;
                },
              });
              const input = {
                where: {
                  all: [
                    {
                      assignment: { kind: "mine" },
                      due: { kind: "relative", period: "today" },
                      status: ["not_started", "in_progress", "blocked"],
                    },
                  ],
                },
                query: { mode: "list" },
              };
              const output = await directRegistry.invoke("tasks.query", input, {
                callId: "host-read-1",
              });
              return {
                answer:
                  "Fixture host-journal ingestion proof, not an HTTP or model quality proof.",
                clarificationCount: 0,
                costUsd: 0,
                judge: null,
                latency: {
                  acknowledgementMs: 0,
                  firstTextMs: null,
                  totalMs: 0,
                },
                hostCapture: {
                  calls: [
                    { id: "host-read-1", name: "tasks.query", input, output },
                  ],
                  presented: ["host-read-1"],
                  freshAuthorizations,
                  refusedAuthorizations: 0,
                  outboundMessages: 0,
                  costUsd: 0,
                  costBasis: "provider_usage",
                },
              };
            },
          });
          const scenario = regressions.find(
            (row) => row.id === "regression-readable-copy"
          )!;
          const fixture = await httpAdapter.prepare(scenario);
          assert.ok(fixture);
          try {
            const observation = observationSchema.parse(
              await fixture.run({
                scenario,
                signal: AbortSignal.timeout(30_000),
                maxCostUsd: 0.1,
              })
            );
            const grade = gradeObservation(
              scenario.id,
              fixture.expectations,
              observation
            );
            assert.deepEqual(
              grade.failures,
              ["quality_not_reviewed"],
              JSON.stringify(grade)
            );
          } finally {
            await fixture.cleanup();
          }
        }
      );
      await t.test(
        "orientation uses real saved location/template and next Sunday; revoked sessions stop reads",
        async (helperTest) => {
          const manifest = createFixtureManifest("helper-proof", 0);
          store.seed(manifest);
          const actor = await requireEvryPlantViewerForSession(
            manifest.sessionId
          );
          await helperTest.test(
            "real database mutation and attempted email fail unconfirmed-action gates",
            async () => {
              attemptForbiddenEffects = true;
              const scenario = regressions.find(
                (row) => row.id === "regression-today"
              )!;
              const fixture = await adapter.prepare(scenario);
              assert.ok(fixture);
              try {
                const observation = observationSchema.parse(
                  await fixture.run({
                    scenario,
                    signal: AbortSignal.timeout(30_000),
                    maxCostUsd: 0.1,
                  })
                );
                assert.ok(observation.effects.domainWrites > 0);
                assert.equal(observation.effects.outboundMessages, 1);
                assert.equal(
                  observation.safety.find(
                    (gate) => gate.gate === "confirmation_required"
                  )?.passed,
                  false
                );
                assert.equal(
                  gradeObservation(
                    scenario.id,
                    fixture.expectations,
                    observation
                  ).status,
                  "failed"
                );
              } finally {
                attemptForbiddenEffects = false;
                await fixture.cleanup();
              }
            }
          );
          await helperTest.test(
            "unpresented or wrong records cannot become correct facts from answer prose",
            async () => {
              const { observedFixtureFacts } = await import("./adapter");
              const calls = [
                {
                  id: "tool-1",
                  name: "tasks.query",
                  input: {},
                  output: {
                    kind: "read",
                    counts: { matched: 22 },
                    items: [{ id: "task-overdue", label: "Old task" }],
                  },
                },
              ];
              assert.deepEqual(
                observedFixtureFacts("regression-today", calls, new Set())
                  .facts,
                {}
              );
              assert.deepEqual(
                observedFixtureFacts(
                  "regression-today",
                  calls,
                  new Set(["tool-1"])
                ).facts,
                { taskIds: ["task-overdue"], total: 22 }
              );
            }
          );
          const registry = createEveToolRegistry({
            context: {
              actor,
              literalUserText: "Create orientation next Sunday",
              pageContext: null,
              now: FIXTURE_NOW,
            },
            authorizeRead: (identity) =>
              authorizeEvryReadCapabilityForSession(
                identity,
                manifest.sessionId
              ),
          });
          try {
            const calendar = await registry.invoke("calendar.resolve", {
              date: { kind: "weekday", weekday: 0, occurrence: "upcoming" },
              localTime: "10:00",
              durationMinutes: 120,
            });
            assert.deepEqual(
              z
                .object({
                  calendarDate: z.string(),
                  localTime: z.string(),
                  timeZone: z.string(),
                  instantUtc: z.string(),
                  endInstantUtc: z.string(),
                  durationMinutes: z.number(),
                })
                .parse(calendar),
              {
                calendarDate: "2026-09-27",
                localTime: "10:00",
                timeZone: "America/New_York",
                instantUtc: "2026-09-27T14:00:00.000Z",
                endInstantUtc: "2026-09-27T16:00:00.000Z",
                durationMinutes: 120,
              }
            );
            const location = await registry.invoke("locations.query", {});
            assert.equal(
              JSON.stringify(location).includes(
                manifest.ids["church-location"]
              ),
              true
            );
            const template = await registry.invoke("templates.for_meeting", {
              meetingType: "orientation",
            });
            assert.equal(
              JSON.stringify(template).includes(
                manifest.ids["orientation-template"]
              ),
              true
            );
            const foreign = await registry.invoke("people.get_many", {
              resource: "person",
              ids: [manifest.ids["person-foreign"]],
            });
            assert.equal(
              JSON.stringify(foreign).includes("person-foreign Fixture"),
              false
            );
            store.revoke(manifest);
            await assert.rejects(() => registry.invoke("context.get", {}));
          } finally {
            store.revoke(manifest);
          }
        }
      );
      assert.equal(
        await adapter.prepare(questions[0]),
        null,
        "Unbound historical questions must remain blocked"
      );
    } finally {
      await stack.cleanup();
    }
  }
);
