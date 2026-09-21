import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  readPreparedTaskCleanupFacts,
  seedTaskCleanupFixture,
  taskCleanupExpectations,
  taskCleanupId,
  taskCleanupPlanReference,
  taskCleanupTruth,
} from "@/lib/evry/eve/evals/fixtures/task-cleanup";

type Variant =
  | "correct"
  | "first-page"
  | "wrong-owner"
  | "title-heuristic"
  | "wrong-date"
  | "unshown"
  | "stale-review";
const variants: readonly Variant[] = [
  "correct",
  "first-page",
  "wrong-owner",
  "title-heuristic",
  "wrong-date",
  "unshown",
  "stale-review",
];
const prompt =
  "Move my overdue tasks to Friday, but leave launch milestones alone.";

/** Strategy consumes real tool outputs. The expected IDs and date never enter it. */
async function prepareCleanup(
  invoke: (name: string, input: unknown) => Promise<unknown>,
  variant: Variant
) {
  const calendar = z
    .object({ status: z.literal("resolved"), calendarDate: z.string().date() })
    .parse(
      await invoke("calendar.resolve", {
        date:
          variant === "wrong-date"
            ? { kind: "absolute", date: "2026-10-02" }
            : { kind: "weekday", weekday: 5, occurrence: "upcoming" },
      })
    );
  const selected: string[] = [];
  let offset = 0;
  for (let page = 0; page < 30; page++) {
    const result = capturedReadArtifactSchema.parse(
      await invoke("tasks.query", {
        where: {
          all: [
            {
              ...(variant === "wrong-owner"
                ? {}
                : { assignment: { kind: "mine" } }),
              due: { kind: "relative", period: "overdue" },
              ...(variant === "title-heuristic"
                ? {}
                : { launchMilestone: false }),
            },
          ],
        },
        query: {
          mode: "list",
          sort: "due",
          direction: "asc",
          limit: 2,
          cursor: offset === 0 ? null : String(offset),
        },
      })
    );
    selected.push(
      ...result.items
        .filter(
          (row) =>
            variant !== "title-heuristic" ||
            !row.label.toLowerCase().includes("launch milestone")
        )
        .map((row) => row.id)
    );
    offset += result.items.length;
    if (variant === "first-page" || offset === result.counts.matched) break;
    assert.ok(
      result.items.length > 0 && offset < result.counts.matched,
      "Actual page must advance toward its reported total"
    );
  }
  assert.ok(selected.length > 0 && selected.length <= 50);
  await invoke("actions.prepare", {
    request: {
      operation: "tasks.bulk.reschedule",
      arguments: { taskIds: selected, dueDate: calendar.calendarDate },
    },
  });
  return selected;
}

test(
  "tasks-07 real queries and persisted exact review preserve ownership, milestone relations and Friday",
  {
    skip: process.env.EVRY_EVE_TASK_CLEANUP_PROOF !== "1",
    timeout: 240_000,
  },
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
      process.env.RESEND_API_KEY = "re_isolated_no_delivery";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          external++;
          throw new Error("External requests prohibited in task cleanup proof");
        }
        return previous.fetch(input, init);
      };
      const [
        { createEveToolRegistry },
        { createEvePreparation },
        { withAuthenticatedSessionId },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
        { confirmEvryActionPlan },
        { TASK_PLAN_REGISTRY },
      ] = await Promise.all([
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eve/preparation"),
        import("@/lib/auth/session-scope"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
        import("@/lib/evry/plans"),
        import("@/lib/evry/capabilities/tasks/runtime"),
      ]);
      const store = createFixtureStore(stack.container);
      const m = createFixtureManifest("tasks-07", 701);
      store.seed(m);
      seedTaskCleanupFixture(m, store);
      const expected = taskCleanupExpectations(m, store)!;
      const truth = taskCleanupTruth(m, store);
      assert.equal(truth.today, "2026-09-20");
      assert.equal(truth.friday, "2026-09-25");
      assert.deepEqual(
        truth.rows.map((row) => row.id).sort(),
        [
          m.ids["task-overdue"],
          taskCleanupId(m, "ordinary"),
          taskCleanupId(m, "misleading-title"),
        ].sort()
      );
      const actor = await requireEvryPlantViewerForSession(m.sessionId);
      const authorizeRead = (
        identity: Parameters<typeof authorizeEvryReadCapabilityForSession>[0]
      ) => authorizeEvryReadCapabilityForSession(identity, m.sessionId);
      const registry = createEveToolRegistry({
        context: {
          actor,
          literalUserText: prompt,
          pageContext: null,
          now: new Date(m.now),
        },
        authorizeRead,
        preparation: createEvePreparation({
          actor,
          conversationId: randomUUID(),
          userRequestKey: randomUUID(),
          literalUserText: prompt,
          pageContext: null,
          now: new Date(m.now),
          authorizeRead,
        }),
      });
      const audit = store.auditStart();
      const baseline = store.sql(
        `select jsonb_agg(to_jsonb(t) order by t.id)::text from tasks t where church_id in ('${m.ids.plant}','${m.ids["foreign-plant"]}')`
      );
      let serial = 0;
      let correct: CapturedCall[] = [];
      for (const variant of variants)
        await t.test(variant, async () => {
          const calls: CapturedCall[] = [];
          const invoke = async (name: string, input: unknown) => {
            const id = `cleanup-${serial++}`;
            const output = await withAuthenticatedSessionId(m.sessionId, () =>
              registry.invoke(name, input, { callId: id })
            );
            calls.push({ id, name, input, output });
            return output;
          };
          await prepareCleanup(invoke, variant);
          const preparation = calls.at(-1)!;
          assert.ok(
            taskCleanupPlanReference(calls, new Set([preparation.id])),
            `Negative ${variant} must reach a real valid review, not merely schema refusal`
          );
          const presented = new Set(
            variant === "unshown" ? [] : [preparation.id]
          );
          if (variant === "stale-review")
            await invoke("actions.prepare", {
              request: {
                operation: "tasks.bulk.reschedule",
                arguments: { taskIds: [randomUUID()], dueDate: truth.friday },
              },
            });
          const observed = await readPreparedTaskCleanupFacts({
            manifest: m,
            store,
            calls,
            presented,
          });
          if (variant === "correct") {
            assert.deepEqual(observed.facts, expected.facts);
            assert.deepEqual(observed.evidence, expected.requiredEvidence);
            correct = calls;
          } else {
            assert.notDeepEqual(
              observed.facts,
              expected.facts,
              `${variant} cannot satisfy independent cohort/date/review truth`
            );
            if (variant === "first-page")
              assert.equal(observed.facts.selectedTasksWereRead, false);
            if (variant === "unshown" || variant === "stale-review")
              assert.deepEqual(observed.facts, {});
          }
          assert.equal(
            store.sql(
              `select jsonb_agg(to_jsonb(t) order by t.id)::text from tasks t where church_id in ('${m.ids.plant}','${m.ids["foreign-plant"]}')`
            ),
            baseline
          );
          assert.deepEqual(store.writesSince(audit, m), []);
        });
      await t.test(
        "foreign, expired, unshown and cancelled reviews cannot earn facts or authorize the wrong fingerprint",
        async () => {
          const presented = new Set([correct.at(-1)!.id]);
          for (const manifest of [
            { ...m, ids: { ...m.ids, actor: m.ids["other-actor"] } },
            { ...m, ids: { ...m.ids, plant: m.ids["foreign-plant"] } },
            { ...m, now: "2099-01-01T00:00:00.000Z" },
          ])
            assert.deepEqual(
              (
                await readPreparedTaskCleanupFacts({
                  manifest,
                  store,
                  calls: correct,
                  presented,
                })
              ).facts,
              {}
            );
          const ref = taskCleanupPlanReference(correct, presented)!;
          const denied = await withAuthenticatedSessionId(m.sessionId, () =>
            confirmEvryActionPlan({
              actor,
              planId: ref.planId,
              fingerprint: "0".repeat(64),
              decidedAt: new Date(m.now),
              registry: TASK_PLAN_REGISTRY,
            })
          );
          assert.notEqual(denied.status, "confirmed");
          store.sql(
            `update evry_action_plan_states set status='cancelled' where plan_id='${ref.planId}' and church_id='${m.ids.plant}'`
          );
          assert.deepEqual(
            (
              await readPreparedTaskCleanupFacts({
                manifest: m,
                store,
                calls: correct,
                presented,
              })
            ).facts,
            {}
          );
          assert.equal(
            store.sql("select count(*) from evry_plan_confirmations"),
            "0"
          );
          assert.equal(
            store.sql("select count(*) from evry_execution_attempts"),
            "0"
          );
        }
      );
      await t.test(
        "freshly revoked task write permission prevents another review",
        async () => {
          store.sql(`update users set seat='member' where id='${m.ids.actor}'`);
          try {
            const callId = `revoked-${serial++}`;
            const input = {
              request: {
                operation: "tasks.bulk.reschedule",
                arguments: {
                  taskIds: truth.rows.map((row) => row.id),
                  dueDate: truth.friday,
                },
              },
            };
            const output = await withAuthenticatedSessionId(m.sessionId, () =>
              registry.invoke("actions.prepare", input, { callId })
            );
            assert.equal(
              taskCleanupPlanReference(
                [{ id: callId, name: "actions.prepare", input, output }],
                new Set([callId])
              ),
              null
            );
          } finally {
            store.sql(
              `update users set seat='owner' where id='${m.ids.actor}'`
            );
          }
        }
      );
      await t.test(
        "actual evaluation adapter captures queries, preparation and review without inventing model quality",
        async () => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          let variant: Variant = "correct";
          let callNumber = 0;
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({
              scenario,
              registry,
              onPresentResult,
              sessionId,
            }) {
              assert.deepEqual(scenario.turns, [prompt]);
              let lastId = "";
              const invoke = async (name: string, input: unknown) => {
                lastId = `adapter-cleanup-${callNumber++}`;
                return registry.invoke(name, input, { callId: lastId });
              };
              await prepareCleanup(invoke, variant);
              if (variant !== "unshown") onPresentResult(lastId);
              if (variant === "stale-review")
                await invoke("actions.prepare", {
                  request: {
                    operation: "tasks.bulk.reschedule",
                    arguments: {
                      taskIds: [randomUUID()],
                      dueDate: "2026-09-25",
                    },
                  },
                });
              return {
                eveSessionId: sessionId,
                answer: "Scripted review proof; model quality not reviewed.",
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
          const scenario = questions.find((q) => q.id === "tasks-07")!;
          const fixture = await adapter.prepare(scenario);
          assert.ok(
            fixture,
            "Root must bind tasks-07 to the real adapter, including native preparation"
          );
          try {
            for (const mode of variants) {
              variant = mode;
              const result = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0.1,
                })
              );
              const failures: readonly string[] = gradeObservation(
                scenario.id,
                fixture.expectations,
                result
              ).failures;
              assert.deepEqual(result.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              assert.equal(result.judge, null);
              assert.equal(result.costUsd, 0);
              if (mode === "correct")
                assert.deepEqual(
                  failures,
                  ["quality_not_reviewed"],
                  JSON.stringify(result.facts)
                );
              else
                assert.ok(
                  failures.some((failure) => failure.startsWith("fact:")),
                  `${mode}: ${JSON.stringify(failures)}`
                );
            }
          } finally {
            await fixture.cleanup();
          }
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
