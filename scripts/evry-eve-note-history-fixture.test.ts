import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { addCalendarDays, toCalendarDate } from "@/lib/datetime";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { noteHistoryFixtureIds } from "@/lib/evry/eve/evals/fixtures/note-history";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";

test(
  "original notes questions use authorized history and independent SQL truth",
  { skip: process.env.EVRY_EVE_NOTE_HISTORY_PROOF !== "1", timeout: 180_000 },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const originalFetch = globalThis.fetch;
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_eve_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only isolated fixture database access is allowed");
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let variant:
        | "correct"
        | "broad"
        | "other-person"
        | "old-history"
        | "wall-clock-as-utc"
        | "inclusive-start" = "correct";
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry }) {
          let n = 0;
          let boundary:
            | { local: string; instant: string; today: string }
            | undefined;
          const invoke = async (name: string, input: unknown) => {
            const output = capturedReadArtifactSchema.parse(
              await registry.invoke(name, input, { callId: `notes-${n++}` })
            );
            assert.equal(
              JSON.stringify(output).includes("DO_NOT_EXPOSE_METADATA"),
              false
            );
            assert.equal(
              JSON.stringify(output).includes("internal-native-writer"),
              false
            );
            return output;
          };
          const people =
            scenario.id === "notes-02"
              ? null
              : await invoke("people.query", {
                  cohort: {
                    anyOf: [
                      { search: "Alex" },
                      ...(scenario.id === "notes-01" ||
                      variant === "other-person"
                        ? [{ search: "Casey" }]
                        : []),
                    ],
                  },
                  result: { mode: "list" },
                });
          if (scenario.id === "notes-04") {
            const meeting = await invoke("meetings.query", {
              where: { all: [{ statuses: ["completed"], timing: "past" }] },
              query: {
                mode: "list",
                limit: 1,
                sort: "date",
                direction: "desc",
              },
            });
            assert.equal(meeting.items[0].label, "Orientation Two");
            const local = z
              .string()
              .parse(
                meeting.items[0].facts?.find((f) => f.label === "Local start")
                  ?.value
              )
              .replace(" ", "T");
            const calendar = z
              .object({
                status: z.literal("resolved"),
                instantUtc: z.string().datetime(),
                referenceInstant: z.string().datetime(),
                timeZone: z.string(),
              })
              .parse(
                await registry.invoke(
                  "calendar.resolve",
                  {
                    date: { kind: "absolute", date: local.slice(0, 10) },
                    localTime: local.slice(11, 16),
                  },
                  { callId: `notes-${n++}` }
                )
              );
            assert.equal(
              calendar.timeZone,
              meeting.items[0].facts?.find((f) => f.label === "Timezone")?.value
            );
            boundary = {
              local,
              instant: calendar.instantUtc,
              today: toCalendarDate(
                new Date(calendar.referenceInstant),
                calendar.timeZone
              ),
            };
          }
          const result = await invoke("people.history.query", {
            resource: {
              kind: scenario.id === "notes-04" ? "activities" : "notes",
            },
            ...(people
              ? {
                  cohort: { all: { personIds: people.items.map((i) => i.id) } },
                }
              : {}),
            ...(scenario.id === "notes-01"
              ? { latestPerPerson: variant !== "broad" }
              : {}),
            ...(scenario.id === "notes-02" && variant !== "broad"
              ? { text: "volunteering" }
              : {}),
            ...(boundary
              ? {
                  dates: {
                    from:
                      variant === "old-history"
                        ? addCalendarDays(
                            new Date(
                              `${boundary.local.slice(0, 10)}T00:00:00Z`
                            ),
                            -7
                          )
                        : boundary.local.slice(0, 10),
                    through: boundary.today,
                  },
                }
              : {}),
            result: { mode: "list", limit: 50 },
          });
          if (boundary && variant !== "old-history") {
            const threshold = new Date(
              variant === "wall-clock-as-utc"
                ? `${boundary.local}Z`
                : boundary.instant
            ).getTime();
            const selected = result.items.filter((item) => {
              const recordedUtc = z
                .string()
                .parse(
                  item.facts?.find((f) => f.label === "Recorded at (UTC)")
                    ?.value
                );
              assert.match(
                recordedUtc,
                /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/
              );
              const at = new Date(recordedUtc).getTime();
              return variant === "inclusive-start"
                ? at >= threshold
                : at > threshold;
            });
            assert.ok(selected.length);
            if (variant === "correct")
              assert.ok(
                selected.some((item) =>
                  item.facts?.some(
                    (f) =>
                      f.label === "Recorded at (UTC)" &&
                      f.value === "2026-09-10T18:00:01.123456Z"
                  )
                ),
                "Production timestamp projection preserves all microseconds"
              );
            // Re-read the computed subset through the production tool. The final
            // host evidence, not our answer text, must match independent SQL.
            await invoke("people.history.query", {
              resource: { kind: "activities" },
              recordIds: selected.map((item) => item.id),
              result: { mode: "list", limit: 50 },
            });
          }
          if (scenario.id === "notes-04" && variant === "correct") {
            const change = result.items.find((i) =>
              i.facts?.some(
                (f) =>
                  f.label === "Recorded outcome" && f.value === "Stage changed"
              )
            );
            assert.ok(change);
            assert.deepEqual(
              change.facts?.filter((f) =>
                ["Previous stage", "New stage", "Change reason"].includes(
                  f.label
                )
              ),
              [
                { label: "Previous stage", value: "Prospect" },
                { label: "New stage", value: "Following Up" },
                {
                  label: "Change reason",
                  value: "Requested a personal follow-up after the meeting.",
                },
              ]
            );
          }
          if (scenario.id === "notes-04" && variant === "other-person") {
            const malformed = result.items.find(
              (item) =>
                item.label === "Casey Fixture" &&
                !item.facts?.some((f) => f.label === "Change reason")
            );
            assert.ok(
              malformed,
              "Malformed metadata remains an activity, not an invented transition"
            );
            assert.equal(
              malformed.facts?.some((f) =>
                ["Previous stage", "New stage", "Change reason"].includes(
                  f.label
                )
              ),
              false
            );
          }
          if (scenario.id === "notes-01" && variant === "correct")
            assert.equal(
              result.items[0].facts?.find((f) => f.label === "Recorded by")
                ?.value,
              "Other Member"
            );
          return {
            answer:
              "Unpaid scripted retrieval proof. Human answer quality has not been evaluated.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const id of noteHistoryFixtureIds)
        await t.test(id, async () => {
          const scenario = questions.find((q) => q.id === id)!;
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${id} must be wired`);
          try {
            for (const mode of id === "notes-04"
              ? ([
                  "correct",
                  "other-person",
                  "old-history",
                  "wall-clock-as-utc",
                  "inclusive-start",
                ] as const)
              : (["correct", "broad"] as const)) {
              variant = mode;
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
              assert.deepEqual(observation.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              assert.ok(grade.failures.includes("quality_not_reviewed"));
              if (mode === "correct")
                assert.deepEqual(
                  grade.failures,
                  ["quality_not_reviewed"],
                  JSON.stringify(observation.facts)
                );
              else
                assert.ok(
                  grade.failures.some((f) => f.startsWith("fact:")),
                  `${id}/${mode} must reject incorrect history`
                );
            }
          } finally {
            await fixture.cleanup();
          }
        });
      assert.equal(outbound, 0);
    } finally {
      globalThis.fetch = originalFetch;
      await stack.cleanup();
    }
  }
);
