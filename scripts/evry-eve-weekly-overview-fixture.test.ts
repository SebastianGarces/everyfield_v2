import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { addCalendarDays } from "@/lib/datetime";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import type { CapturedCall } from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  seedWeeklyOverviewFixture,
  weeklyOverviewExpectations,
  weeklyOverviewTruth,
  observedWeeklyOverviewFacts,
  weeklyOverviewId,
} from "@/lib/evry/eve/evals/fixtures/weekly-overview";

type Mode = "list" | "count";
type Variant =
  | "complete"
  | "mine"
  | "partial"
  | "wrong-week"
  | "missing-followup"
  | "missing-staffing"
  | "unbounded-count"
  | "broad-list";
async function retrieve(
  invoke: (name: string, input: unknown) => Promise<unknown>,
  window: "calendar" | "rolling",
  mode: Mode,
  variant: Variant = "complete"
) {
  const context = z
    .object({
      today: z.string().date(),
      referenceInstant: z.string(),
      timeZone: z.string(),
    })
    .parse(await invoke("context.get", {}));
  const day = new Date(`${context.today}T00:00:00Z`);
  const from =
    window === "calendar"
      ? addCalendarDays(day, -((day.getUTCDay() + 6) % 7))
      : context.today;
  const date = {
    kind: "range",
    from,
    through: addCalendarDays(new Date(`${from}T00:00:00Z`), 6),
  };
  async function query(
    name: string,
    filter: Record<string, unknown>,
    resource?: string,
    partial = false
  ) {
    let cursor: string | null = null;
    for (let page = 0; page < 25; page++) {
      const input = {
        ...(resource ? { resource } : {}),
        where: { all: [filter] },
        query: mode === "count" ? { mode } : { mode, limit: 2, cursor },
      };
      const output = await invoke(
        name,
        name === "teams.query" ? { request: input } : input
      );
      const parsed = z
        .object({
          kind: z.literal("read"),
          filters: z.array(z.object({ label: z.string(), value: z.string() })),
        })
        .parse(output);
      if (mode === "count" || partial) return;
      const next = parsed.filters.find(
        (f) => f.label === "Next page cursor"
      )?.value;
      assert.ok(next, `${name} must state pagination`);
      if (next === "End of results") return;
      assert.ok(/^\d+$/.test(next) && Number(next) > Number(cursor ?? 0));
      cursor = next;
    }
    assert.fail("Weekly proof exceeded bounded pagination");
  }
  const statuses = ["not_started", "in_progress", "blocked"];
  await query(
    "tasks.query",
    {
      status: statuses,
      ...(variant === "unbounded-count" || variant === "broad-list"
        ? {}
        : { due: date }),
      ...(variant === "mine" ? { assignment: { kind: "mine" } } : {}),
    },
    undefined,
    variant === "partial"
  );
  // When omitting follow-up, use a count for the broad task query above. A
  // complete general task list is itself legitimate follow-up evidence.
  if (variant !== "missing-followup")
    await query("tasks.query", {
      status: statuses,
      ...(variant === "unbounded-count" || variant === "broad-list"
        ? {}
        : { due: date }),
      category: ["follow_up"],
    });
  await query("meetings.query", {
    statuses: ["planning", "ready", "in_progress", "completed"],
    date:
      variant === "wrong-week"
        ? { kind: "range", from: "2025-09-20", through: "2025-09-26" }
        : date,
  });
  if (variant !== "missing-staffing")
    await query("teams.query", { vacant: true }, "roles");
}
const requiredFacts = (
  observed: Record<string, unknown>,
  expected: Record<string, unknown>
) =>
  Object.fromEntries(Object.keys(expected).map((key) => [key, observed[key]]));

test(
  "cross-01 actual four-domain reads and adapter use independent weekly SQL truth",
  {
    skip: process.env.EVRY_EVE_WEEKLY_OVERVIEW_PROOF !== "1",
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
      process.env.RESEND_API_KEY = "re_isolated_no_send";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          external++;
          throw new Error(
            "External requests prohibited in weekly overview proof"
          );
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
        m = createFixtureManifest("cross-01", 500),
        scenario = questions.find((q) => q.id === "cross-01")!;
      assert.deepEqual(scenario.turns, [
        "Give me a weekly operational brief covering tasks, meetings, follow-up and staffing gaps.",
      ]);
      store.seed(m);
      seedWeeklyOverviewFixture(m, store);
      const expected = weeklyOverviewExpectations(m, store),
        truth = weeklyOverviewTruth(m, store);
      assert.ok(expected);
      assert.equal(truth.roles.filter((r) => r.vacant).length, 2);
      assert.ok(
        truth.roles.some(
          (r) => r.id === weeklyOverviewId(m, "inactive-role") && r.vacant
        )
      );
      assert.ok(
        truth.roles.some(
          (r) => r.id === weeklyOverviewId(m, "occupied-role") && !r.vacant
        )
      );
      assert.ok(
        truth.tasks.some((r) => r.id === m.ids["task-today"] && r.blocked)
      );
      assert.ok(
        truth.tasks.some(
          (r) =>
            r.id === m.ids["task-other-actor"] && r.assignee === "Other Member"
        )
      );
      assert.ok(
        truth.tasks.some(
          (r) =>
            r.id === weeklyOverviewId(m, "unassigned") &&
            r.assignee === "Unassigned"
        )
      );
      assert.ok(
        truth.meetings.some(
          (r) =>
            r.id === weeklyOverviewId(m, "meeting-today") &&
            r.preparation === "No checklist recorded" &&
            r.unchecked === 0
        )
      );
      assert.ok(
        truth.meetings.some(
          (r) =>
            r.id === weeklyOverviewId(m, "meeting-next-week") &&
            r.preparation === "Incomplete" &&
            r.unchecked === 1
        )
      );
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
        const id = `weekly-overview-${calls.length}`;
        const output = await withAuthenticatedSessionId(m.sessionId, () =>
          registry.invoke(name, input, { callId: id })
        );
        calls.push({ id, name, input, output });
        return output;
      };
      const audit = store.auditStart();
      for (const window of ["calendar", "rolling"] as const)
        for (const mode of ["list", "count"] as const)
          await t.test(
            `${window} ${mode} actual query results match every independently seeded domain`,
            async () => {
              calls = [];
              await retrieve(invoke, window, mode);
              const observed = observedWeeklyOverviewFacts(
                m.caseId,
                calls,
                truth
              );
              assert.deepEqual(
                requiredFacts(observed.facts, expected.facts),
                expected.facts,
                JSON.stringify(observed)
              );
              assert.deepEqual(observed.evidence, expected.requiredEvidence);
              assert.equal(observed.facts.openRoleCount, 2);
              for (const call of calls)
                for (const foreign of expected.absentRecordIds)
                  assert.ok(!JSON.stringify(call.output).includes(foreign));
              assert.deepEqual(store.writesSince(audit, m), []);
            }
          );
      await t.test(
        "a complete broad SQL list preserves evidence and labels its counts as retrieval totals",
        async () => {
          calls = [];
          await retrieve(invoke, "rolling", "list", "broad-list");
          const observed = observedWeeklyOverviewFacts(m.caseId, calls, truth);
          assert.deepEqual(
            requiredFacts(observed.facts, expected.facts),
            expected.facts
          );
          assert.equal(
            observed.facts.retrievedOpenTaskCount,
            truth.tasks.filter((row) => row.status !== "complete").length
          );
          assert.equal(
            observed.facts.retrievedOpenFollowupCount,
            truth.tasks.filter(
              (row) => row.status !== "complete" && row.category === "follow_up"
            ).length
          );
          assert.equal(observed.facts.taskCount, undefined);
          assert.equal(observed.facts.followupCount, undefined);
          assert.deepEqual(store.writesSince(audit, m), []);
        }
      );
      await t.test(
        "production narrow, missing-domain, wrong-period and partial reads cannot pass",
        async () => {
          for (const variant of [
            "mine",
            "partial",
            "wrong-week",
            "missing-followup",
            "missing-staffing",
            "unbounded-count",
          ] as const) {
            calls = [];
            await retrieve(
              invoke,
              "rolling",
              variant === "missing-followup" || variant === "unbounded-count"
                ? "count"
                : "list",
              variant
            );
            assert.notDeepEqual(
              requiredFacts(
                observedWeeklyOverviewFacts(m.caseId, calls, truth).facts,
                expected.facts
              ),
              expected.facts,
              variant
            );
          }
          assert.deepEqual(store.writesSince(audit, m), []);
        }
      );
      await t.test(
        "production adapter preserves original prompt, independent facts, no cards and quality-not-reviewed",
        async () => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          let mode: Mode = "list",
            window: "calendar" | "rolling" = "calendar",
            variant: Variant = "complete";
          const sessions: string[] = [];
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({ scenario: bound, registry, sessionId }) {
              assert.deepEqual(bound.turns, scenario.turns);
              sessions.push(sessionId);
              let n = 0;
              await retrieve(
                (name, input) =>
                  registry.invoke(name, input, { callId: `overview-${n++}` }),
                window,
                mode,
                variant
              );
              return {
                eveSessionId: sessionId,
                answer:
                  "Scripted four-domain data proof. Narrative quality is not reviewed.",
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
          assert.ok(
            fixture,
            "Root must wire cross-01 before this production adapter proof"
          );
          try {
            for (const strategy of [
              { mode: "list", window: "calendar", variant: "complete" },
              { mode: "count", window: "rolling", variant: "complete" },
              { mode: "list", window: "rolling", variant: "partial" },
              { mode: "count", window: "rolling", variant: "missing-followup" },
              { mode: "list", window: "rolling", variant: "mine" },
              { mode: "list", window: "rolling", variant: "missing-staffing" },
              { mode: "count", window: "rolling", variant: "unbounded-count" },
              { mode: "list", window: "rolling", variant: "broad-list" },
            ] as const) {
              ({ mode, window, variant } = strategy);
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
              assert.equal(observation.judge, null);
              assert.equal(observation.costUsd, 0);
              assert.deepEqual(observation.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              if (variant === "complete" || variant === "broad-list")
                assert.deepEqual(
                  failures,
                  ["quality_not_reviewed"],
                  JSON.stringify(observation.facts)
                );
              else
                assert.ok(
                  failures.some((failure: string) =>
                    failure.startsWith("fact:")
                  ),
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
