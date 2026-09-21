import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { engagementFixtureIds } from "@/lib/evry/eve/evals/fixtures/engagement";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";

test(
  "engagement questions use authorized production tools against independent SQL truth",
  { skip: process.env.EVRY_EVE_ENGAGEMENT_PROOF !== "1", timeout: 240_000 },
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
            "Engagement proof only permits its disposable database proxy"
          );
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let mistake = "none";
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        async runProduction({
          scenario,
          registry,
          onPresentResult,
          actor,
          sessionId,
        }) {
          let calls = 0;
          const invoke = async (name: string, input: unknown) => {
            const callId = `engagement-${calls++}`;
            const output = await registry.invoke(name, input, { callId });
            const result = capturedReadArtifactSchema.parse(output);
            onPresentResult(callId);
            return {
              ...result,
              filters: z
                .object({
                  filters: z.array(
                    z.object({ label: z.string(), value: z.string() })
                  ),
                })
                .parse(output).filters,
            };
          };
          const people = async (all: Record<string, unknown>) => {
            let afterId: string | undefined;
            for (let page = 0; page < 10; page++) {
              const output = await invoke("people.query", {
                cohort: { all },
                result: {
                  mode: "list",
                  limit: 2,
                  ...(afterId ? { afterId } : {}),
                },
              });
              const next = output.filters.find(
                (f) => f.label === "Next page cursor"
              )?.value;
              if (!next || next === "End of results") return;
              afterId = next;
            }
            throw new Error("People fixture did not reach its final page");
          };
          const meetings = async (
            filter: Record<string, unknown>,
            topTwo = false
          ) => {
            const ids: string[] = [];
            let cursor: string | undefined;
            for (let page = 0; page < 10; page++) {
              const output = await invoke("meetings.query", {
                where: { all: [filter] },
                query: {
                  mode: "list",
                  sort: "date",
                  direction:
                    topTwo && mistake !== "oldest-first" ? "desc" : "asc",
                  limit: 2,
                  ...(cursor ? { cursor } : {}),
                },
              });
              ids.push(...output.items.map((item) => item.id));
              const next = output.filters.find(
                (f) => f.label === "Next page cursor"
              )?.value;
              if (topTwo || !next || next === "End of results") return ids;
              cursor = next;
            }
            throw new Error("Meeting fixture did not reach its final page");
          };
          if (scenario.id.startsWith("people-")) {
            const cohort = {
              stages: ["prospect"],
              tags: { names: ["volunteer"] },
            };
            if (scenario.id === "people-08") await people(cohort);
            const calendar = z
              .object({
                dateWindow: z.object({ from: z.string(), through: z.string() }),
                timestampWindow: z
                  .object({ from: z.string(), until: z.string() })
                  .optional(),
                referenceInstant: z.string(),
              })
              .parse(
                await registry.invoke(
                  "calendar.resolve",
                  {
                    date:
                      scenario.id === "people-02"
                        ? { kind: "trailing_days", days: 30 }
                        : { kind: "period", period: "this_month" },
                  },
                  { callId: `engagement-${calls++}` }
                )
              );
            let createdFilter: Record<string, unknown> = {
              created: {
                ...calendar.dateWindow,
                ...(mistake === "end-of-today"
                  ? { through: "2026-09-20" }
                  : {}),
                ...(mistake === "shift-start" ? { from: "2026-08-23" } : {}),
                ...(mistake === "shift-end" ? { through: "2026-09-19" } : {}),
              },
            };
            if (
              scenario.id === "people-08" &&
              mistake !== "full-month" &&
              mistake !== "end-of-today"
            ) {
              const period = z
                .object({ from: z.string(), until: z.string() })
                .parse(calendar.timestampWindow);
              createdFilter = {
                createdWindow: {
                  from: period.from,
                  until:
                    mistake === "includes-exact-now"
                      ? new Date(
                          Date.parse(calendar.referenceInstant) + 1
                        ).toISOString()
                      : calendar.referenceInstant,
                },
              };
            }
            await people({
              ...(mistake === "drop-stage" ? {} : { stages: cohort.stages }),
              ...(mistake === "drop-tag" ? {} : { tags: cohort.tags }),
              ...createdFilter,
            });
          }
          if (scenario.id === "meetings-01")
            await meetings({
              date:
                mistake === "shift-start"
                  ? { kind: "range", from: "2026-09-15", through: "2026-09-20" }
                  : mistake === "shift-end"
                    ? {
                        kind: "range",
                        from: "2026-09-14",
                        through: "2026-09-19",
                      }
                    : { kind: "relative", period: "this_week" },
              ...(mistake === "include-cancelled"
                ? {}
                : {
                    statuses: ["planning", "ready", "in_progress", "completed"],
                  }),
            });
          if (scenario.id === "meetings-05") {
            const ids = await meetings({
              ...(mistake === "date-only" || mistake === "include-past"
                ? {}
                : { timing: "upcoming" }),
              ...(mistake === "include-past"
                ? {}
                : {
                    date: { kind: "range", from: "2026-09-20", through: null },
                  }),
              statuses:
                mistake === "include-cancelled"
                  ? ["planning", "ready", "in_progress", "cancelled"]
                  : mistake === "include-past"
                    ? ["planning", "ready", "in_progress", "completed"]
                    : ["planning", "ready", "in_progress"],
              ...(mistake === "no-checklist"
                ? {}
                : { checklist: "incomplete" }),
            });
            if (mistake !== "omit-details")
              await invoke("meetings.get_many", {
                ids,
                sections: ["checklist"],
                relatedLimit: 20,
              });
            if (mistake === "none") {
              const { createEveToolRegistry } =
                await import("@/lib/evry/eve/capabilities/registry");
              const { authorizeEvryReadCapabilityForSession } =
                await import("@/lib/evry/eligibility/capabilities");
              for (const [instant, timing, expected] of [
                [
                  "2026-09-20T16:00:00Z",
                  "upcoming",
                  ["starts-now", "starts-next"],
                ],
                ["2026-09-20T16:00:00.001Z", "upcoming", ["starts-next"]],
                ["2026-09-20T16:00:01.001Z", "upcoming", []],
                ["2026-09-20T16:00:00Z", "past", ["earlier-today"]],
                [
                  "2026-01-10T15:00:00Z",
                  "upcoming",
                  ["winter-now", "winter-next"],
                ],
                ["2026-01-10T15:00:00Z", "past", ["winter-before"]],
              ] as const) {
                const timed = createEveToolRegistry({
                  context: {
                    actor,
                    literalUserText: scenario.turns.join("\n"),
                    pageContext: null,
                    now: new Date(instant),
                  },
                  authorizeRead: (identity) =>
                    authorizeEvryReadCapabilityForSession(identity, sessionId),
                });
                const result = capturedReadArtifactSchema.parse(
                  await timed.invoke(
                    "meetings.query",
                    {
                      where: {
                        all: [
                          {
                            timing,
                            date: { kind: "relative", period: "today" },
                            statuses: ["planning", "ready"],
                          },
                        ],
                      },
                      query: { mode: "list", limit: 20 },
                    },
                    { callId: `clock-${instant}-${timing}` }
                  )
                );
                assert.deepEqual(
                  result.items.map((row) => row.label).sort(),
                  [...expected].sort(),
                  `${instant} ${timing} uses the freshly authorized church timezone`
                );
              }
            }
          }
          if (scenario.id === "meetings-07") {
            const ids = await meetings(
              {
                statuses: ["completed"],
                ...(mistake === "evaluated-only" ? { evaluated: true } : {}),
              },
              true
            );
            if (mistake !== "omit-details")
              await invoke("meetings.get_many", {
                ids,
                sections: ["evaluation"],
              });
          }
          if (scenario.id === "orientations-03")
            await people({
              attendance: {
                minimumMeetings: 1,
                ...(mistake === "any-meeting"
                  ? {}
                  : { meetingTypes: ["orientation"] }),
              },
              ...(mistake === "include-assigned"
                ? {}
                : { membership: { existence: "not_recorded" } }),
              ...(mistake === "stage-is-attendance"
                ? { stages: ["core_group"] }
                : {}),
            });
          return {
            answer: "Scripted production-tool proof, not a model answer.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const id of engagementFixtureIds)
        await t.test(id, async (t) => {
          const scenario = questions.find((q) => q.id === id);
          assert.ok(scenario);
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${id} needs an independent fixture binding`);
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
            assert.deepEqual(
              gradeObservation(id, fixture.expectations, good).failures,
              ["quality_not_reviewed"],
              JSON.stringify({
                expected: fixture.expectations.facts,
                actual: good.facts,
                evidence: good.evidence,
              })
            );
            assert.deepEqual(good.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            assert.equal(good.costUsd, 0);
            const negatives =
              id === "people-02"
                ? ["drop-tag", "drop-stage", "shift-start", "shift-end"]
                : id === "people-08"
                  ? [
                      "drop-tag",
                      "drop-stage",
                      "full-month",
                      "end-of-today",
                      "includes-exact-now",
                    ]
                  : id === "meetings-01"
                    ? ["include-cancelled", "shift-start", "shift-end"]
                    : id === "meetings-05"
                      ? [
                          "date-only",
                          "no-checklist",
                          "include-past",
                          "include-cancelled",
                          "omit-details",
                        ]
                      : id === "meetings-07"
                        ? ["evaluated-only", "oldest-first", "omit-details"]
                        : [
                            "any-meeting",
                            "include-assigned",
                            "stage-is-attendance",
                          ];
            for (const negative of negatives)
              await t.test(`rejects ${negative}`, async () => {
                mistake = negative;
                const bad = gradeObservation(
                  id,
                  fixture.expectations,
                  await run()
                );
                assert.ok(
                  bad.failures.some((f) => f.startsWith("fact:")),
                  JSON.stringify(bad)
                );
                assert.equal(outboundAttempts, 0);
              });
          } finally {
            mistake = "none";
            await fixture.cleanup();
          }
        });
    } finally {
      globalThis.fetch = originalFetch;
      await stack.cleanup();
    }
  }
);
