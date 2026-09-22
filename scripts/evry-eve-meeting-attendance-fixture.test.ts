import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  meetingAttendanceFixtureIds,
  meetingAttendanceId,
  seedMeetingAttendanceFixture,
  seedMeetingAttendanceUnknownVariant,
  meetingAttendanceExpectations,
  observedMeetingAttendanceFacts,
} from "@/lib/evry/eve/evals/fixtures/meeting-attendance";

const readSchema = capturedReadArtifactSchema.extend({
  filters: z.array(z.object({ label: z.string(), value: z.string() })),
});
type Read = z.infer<typeof readSchema>;
const value = (r: Read["items"][number], key: string) =>
  r.facts?.find((f) => f.label === key)?.value;
const next = (r: Read) =>
  r.filters.find((f) => f.label === "Next page cursor")?.value;

/** Uses only real returned records and cursors, never manifest IDs or expected SQL. */
async function retrieve(
  caseId: string,
  invoke: (name: string, input: unknown) => Promise<unknown>,
  strategy: "list" | "aggregate" | "completed-prefix" = "list"
) {
  const orientation = caseId === "orientations-01",
    broad = strategy === "aggregate";
  const where = {
    all: [
      {
        ...(strategy === "completed-prefix"
          ? {}
          : { timing: orientation ? "upcoming" : "past" }),
        ...(!broad
          ? {
              ...(caseId !== "meetings-03"
                ? { types: [orientation ? "orientation" : "vision_meeting"] }
                : {}),
              statuses: orientation
                ? ["planning", "ready", "in_progress", "completed"]
                : ["completed"],
            }
          : {}),
      },
    ],
  };
  let cursor: string | undefined;
  const meetings: Read["items"] = [];
  for (let page = 0; page < 20; page++) {
    const response = readSchema.parse(
      await invoke("meetings.query", {
        where,
        query: {
          mode: "list",
          sort: "date",
          direction: orientation ? "asc" : "desc",
          limit: orientation && !broad ? 1 : 3,
          ...(cursor ? { cursor } : {}),
        },
      })
    );
    meetings.push(...response.items);
    const continuation = next(response);
    if (
      continuation === "End of results" ||
      (!broad &&
        (orientation || (caseId === "meetings-06" && meetings.length >= 6)))
    )
      break;
    assert.ok(continuation);
    cursor = continuation;
    assert.ok(page < 19, "Meeting pagination must terminate");
  }
  if (orientation) return;
  const selected = meetings
    .filter(
      (r) =>
        value(r, "Status") === "Completed" &&
        (caseId === "meetings-03" || value(r, "Type") === "Vision Meeting")
    )
    .slice(0, caseId === "meetings-06" ? 6 : undefined);
  const ids = selected
    .filter((r) => /^\d+$/.test(value(r, "Actual attendance") ?? ""))
    .map((r) => r.id);
  if (caseId === "meetings-06" && ids.length === 0) return;
  assert.ok(ids.length);
  const scope = {
    meetingIds: ids,
    ...(caseId === "meetings-06"
      ? { statuses: ["attended"] }
      : { statuses: ["absent"], rsvp: ["confirmed"] }),
  };
  if (strategy === "aggregate" && caseId === "meetings-06") {
    await invoke("attendance.query", {
      ...scope,
      result: { mode: "group", by: "meeting" },
    });
    await invoke("attendance.query", { ...scope, result: { mode: "count" } });
  } else {
    let afterId: string | undefined;
    for (let page = 0; page < 20; page++) {
      const response = readSchema.parse(
        await invoke("attendance.query", {
          ...scope,
          result: { mode: "list", limit: 3, ...(afterId ? { afterId } : {}) },
        })
      );
      const continuation = next(response);
      if (continuation === "End of results") break;
      assert.ok(continuation);
      afterId = continuation;
      assert.ok(page < 19, "Attendance pagination must terminate");
    }
  }
}

test(
  "meeting scheduling, finalized no-shows and last-six attendance use production reads and adapter truth",
  {
    skip: process.env.EVRY_EVE_MEETING_ATTENDANCE_PROOF !== "1",
    timeout: 240_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const originalFetch = globalThis.fetch,
      previous = {
        database: process.env.DATABASE_URL,
        resend: process.env.RESEND_API_KEY,
        endpoint: neonConfig.fetchEndpoint,
      };
    let outbound = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_fixture_never_sent";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          outbound++;
          throw new Error("Only isolated database requests allowed");
        }
        return originalFetch(input, init);
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
      for (const caseId of meetingAttendanceFixtureIds)
        for (const variant of [
          "normal",
          ...(caseId === "meetings-06" ? ["unknown", "all-unknown"] : []),
        ])
          await t.test(
            `${caseId}: ${variant} production registry`,
            async () => {
              const m = createFixtureManifest(
                caseId,
                variant === "normal" ? 100 : variant === "unknown" ? 101 : 102
              );
              store.seed(m);
              seedMeetingAttendanceFixture(m, store);
              if (variant !== "normal")
                seedMeetingAttendanceUnknownVariant(
                  m,
                  store,
                  variant === "all-unknown"
                );
              const expected = meetingAttendanceExpectations(m, store)!;
              const audit = store.auditStart();
              let authorized = 0;
              const calls: CapturedCall[] = [];
              const actor = await requireEvryPlantViewerForSession(m.sessionId);
              const registry = createEveToolRegistry({
                context: {
                  actor,
                  literalUserText: questions.find((q) => q.id === caseId)!
                    .turns[0]!,
                  pageContext: null,
                  now: FIXTURE_NOW,
                },
                authorizeRead: async (identity) => {
                  authorized++;
                  return authorizeEvryReadCapabilityForSession(
                    identity,
                    m.sessionId
                  );
                },
              });
              const invoke = async (name: string, input: unknown) => {
                const id = `meeting-${calls.length}`;
                const output = await withAuthenticatedSessionId(
                  m.sessionId,
                  () => registry.invoke(name, input, { callId: id })
                );
                calls.push({ id, name, input, output });
                return output;
              };
              if (caseId === "orientations-01")
                assert.equal(
                  expected.facts.nextOrientationId,
                  meetingAttendanceId(m, "next-orientation")
                );
              if (caseId === "meetings-03")
                assert.deepEqual(expected.facts.noShowPairs, [
                  `${meetingAttendanceId(m, "vision-1")}:${meetingAttendanceId(m, "no-show")}`,
                ]);
              if (caseId === "meetings-06") {
                assert.equal(
                  expected.facts.recordedAttendance,
                  variant === "normal" ? 9 : variant === "unknown" ? 7 : null
                );
                assert.equal(
                  expected.facts.distinctRecordedPeople,
                  variant === "all-unknown" ? null : 4
                );
                if (variant !== "all-unknown")
                  assert.ok(
                    z
                      .array(z.string())
                      .parse(expected.facts.attendanceByMeeting)
                      .includes(`${meetingAttendanceId(m, "vision-0")}:0`)
                  );
                if (variant === "unknown")
                  assert.deepEqual(expected.facts.unknownMeetingIds, [
                    meetingAttendanceId(m, "vision-2"),
                  ]);
              }
              for (const strategy of ["list", "aggregate"] as const) {
                calls.length = 0;
                await retrieve(caseId, invoke, strategy);
                if (caseId === "orientations-01" && strategy === "list") {
                  const first = readSchema.parse(calls[0]!.output);
                  assert.equal(first.items.length, 1);
                  assert.ok(
                    first.counts.matched > 1,
                    "Later qualifying orientation exercises real top-one selection"
                  );
                  assert.equal(next(first), "1");
                }
                const observed = observedMeetingAttendanceFacts(caseId, calls);
                assert.deepEqual(observed.facts, expected.facts);
                assert.deepEqual(observed.evidence, expected.requiredEvidence);
                assert.deepEqual(
                  observed,
                  observedMeetingAttendanceFacts(
                    caseId,
                    calls,
                    new Set(calls.map((c) => c.id))
                  )
                );
                // A new incomplete resource read cannot borrow an older complete page chain.
                const wrong = structuredClone(calls),
                  last = wrong.at(-1)!;
                last.output = { status: "unavailable" };
                assert.notDeepEqual(
                  observedMeetingAttendanceFacts(caseId, wrong).facts,
                  expected.facts
                );
              }
              // Real scope negative, not a forged artifact: the foreign guest cannot be read by ID.
              const foreign = readSchema.parse(
                await invoke("attendance.query", {
                  meetingIds: [meetingAttendanceId(m, "foreign-meeting")],
                  result: { mode: "list" },
                })
              );
              assert.equal(foreign.counts.matched, 0);
              assert.deepEqual(foreign.items, []);
              if (caseId === "meetings-03") {
                calls.length = 0;
                await retrieve(caseId, invoke);
                await invoke("attendance.query", {
                  meetingIds: [
                    meetingAttendanceId(m, "vision-1"),
                    meetingAttendanceId(m, "unfinalized"),
                  ],
                  statuses: ["absent"],
                  rsvp: ["confirmed"],
                  result: { mode: "list" },
                });
                const actual = readSchema.parse(calls.at(-1)!.output);
                assert.ok(
                  actual.items.some(
                    (r) =>
                      value(r, "person_id") ===
                      meetingAttendanceId(m, "unfinalized-guest")
                  ),
                  "Native default-absent control really retrieved"
                );
                assert.notDeepEqual(
                  observedMeetingAttendanceFacts(caseId, calls).facts,
                  expected.facts
                );
              }
              assert.ok(authorized > 1);
              assert.deepEqual(store.writesSince(audit, m), []);
              store.revoke(m);
              await assert.rejects(() =>
                invoke("meetings.query", { query: { mode: "list" } })
              );
              t.diagnostic(
                "Actual registry data agrees with independent SQL; reads do not establish model quality."
              );
            }
          );
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let strategy: "list" | "aggregate" | "completed-prefix" = "list";
      const adapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry }) {
          let sequence = 0;
          await retrieve(
            scenario.id,
            (name, input) =>
              registry.invoke(name, input, {
                callId: `adapter-${sequence++}`,
              }),
            strategy
          );
          return {
            answer: "Scripted data proof; model quality is not reviewed.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      // One adapter owns monotonically increasing fixture repetitions for both strategies.
      for (const selectedStrategy of [
        "list",
        "aggregate",
        "completed-prefix",
      ] as const) {
        strategy = selectedStrategy;
        for (const caseId of meetingAttendanceFixtureIds.filter(
          (id) => strategy !== "completed-prefix" || id === "meetings-06"
        ))
          await t.test(`${caseId}: ${strategy} actual adapter`, async () => {
            const scenario = questions.find((q) => q.id === caseId)!;
            const fixture = await adapter.prepare(scenario);
            assert.ok(fixture, "Adapter binding required");
            try {
              const observation = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0,
                })
              );
              const failures: readonly string[] = gradeObservation(
                caseId,
                fixture.expectations,
                observation
              ).failures;
              assert.deepEqual(failures, ["quality_not_reviewed"]);
              assert.deepEqual(observation.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              assert.equal(observation.costUsd, 0);
              const wrong = structuredClone(observation);
              wrong.facts = {};
              assert.ok(
                gradeObservation(
                  caseId,
                  fixture.expectations,
                  wrong
                ).failures.some(
                  (failure: string) => failure !== "quality_not_reviewed"
                ),
                "Forged observation is only a grader negative, not production evidence"
              );
            } finally {
              await fixture.cleanup();
            }
          });
      }
      assert.equal(outbound, 0);
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
