import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { neonConfig } from "@neondatabase/serverless";
import { addCalendarDays } from "@/lib/datetime";
import {
  SESSION_EXPIRED_DIGEST,
  UNAUTHORIZED_MESSAGE,
} from "@/lib/auth/unauthorized";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "@/lib/evry/eve/evals/fixtures/manifest";
import type { CapturedCall } from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  assessmentEvidenceFixtureIds,
  assessmentEvidenceId,
  seedAssessmentEvidenceFixture,
  assessmentEvidenceTruth,
  assessmentEvidenceText,
  assessmentEvidenceExpectations,
  observedAssessmentEvidenceFacts,
} from "@/lib/evry/eve/evals/fixtures/assessment-evidence";

type Variant =
  | "complete"
  | "partial"
  | "excerpt"
  | "latest-only"
  | "keyword"
  | "score-cutoff"
  | "wrong-window"
  | "wrong-date-basis";
type Strategy =
  | "plant"
  | "attendees"
  | "split-latest"
  | "batched-people"
  | "bounded-latest";
const artifact = z.object({
  kind: z.literal("read"),
  counts: z.object({ matched: z.number() }),
  items: z.array(
    z.object({
      id: z.string(),
      facts: z.array(z.object({ label: z.string(), value: z.string() })),
    })
  ),
  filters: z.array(z.object({ label: z.string(), value: z.string() })),
});
const required = (
  observed: Record<string, unknown>,
  expected: Record<string, unknown>
) => Object.fromEntries(Object.keys(expected).map((k) => [k, observed[k]]));

/** Scripted tool use only. Every ID and continuation comes from production reads. */
async function retrieve(
  caseId: string,
  invoke: (name: string, input: unknown) => Promise<unknown>,
  strategy: Strategy,
  variant: Variant,
  omitLimit = false
) {
  let cohort: Record<string, unknown> = {},
    day: string | undefined;
  if (caseId === "assessments-05") {
    const meetings = artifact.parse(
      await invoke("meetings.query", {
        where: {
          all: [
            { types: ["orientation"], statuses: ["completed"], timing: "past" },
          ],
        },
        query: { mode: "list", sort: "date", direction: "desc", limit: 10 },
      })
    );
    assert.equal(
      meetings.items.length,
      1,
      "Fixture has one unambiguous completed orientation"
    );
    const meeting = meetings.items[0];
    day = z
      .string()
      .parse(meeting.facts.find((f) => f.label === "Local start")?.value)
      .slice(0, 10);
    if (strategy === "attendees")
      cohort = { all: { attendance: { meetingIds: [meeting.id] } } };
  }
  let queries: Record<string, unknown>[] =
    (strategy === "split-latest" || strategy === "bounded-latest") && day
      ? [
          {
            dates: {
              ...(strategy === "bounded-latest"
                ? { from: addCalendarDays(new Date(`${day}T00:00:00Z`), -60) }
                : {}),
              through: addCalendarDays(
                new Date(`${day}T00:00:00Z`),
                variant === "wrong-window" ? -2 : -1
              ),
            },
            latestPerPerson: true,
          },
          {
            dates: {
              from: addCalendarDays(new Date(`${day}T00:00:00Z`), 1),
              ...(strategy === "bounded-latest"
                ? { through: addCalendarDays(new Date(`${day}T00:00:00Z`), 30) }
                : {}),
            },
            latestPerPerson: true,
          },
        ]
      : [{}];
  if (strategy === "batched-people") {
    const people: string[] = [];
    let afterId: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = artifact.parse(
        await invoke("people.query", {
          cohort: {},
          result: { mode: "list", limit: 50, ...(afterId ? { afterId } : {}) },
        })
      );
      people.push(...result.items.map((item) => item.id));
      const next = result.filters.find(
        (f) => f.label === "Next page cursor"
      )?.value;
      assert.ok(next);
      if (next === "End of results") break;
      assert.ok(page < 19);
      afterId = next;
    }
    queries = [];
    for (let at = 0; at < people.length; at += 2)
      queries.push({
        cohort: { all: { personIds: people.slice(at, at + 2) } },
      });
  }
  const initial: { id: string; next: number }[] = [];
  for (const query of queries) {
    let afterId: string | undefined;
    for (let page = 0; page < 20; page++) {
      const result = artifact.parse(
        await invoke("people.history.query", {
          resource: {
            kind: "assessments",
            ...(variant === "score-cutoff" ? { maximumScore: 12 } : {}),
          },
          cohort,
          ...query,
          ...(variant === "keyword" ? { text: "concern" } : {}),
          ...(variant === "latest-only" ? { latestPerPerson: true } : {}),
          ...(variant === "wrong-date-basis"
            ? { dateBasis: "created_at", dates: { from: day ?? "2026-09-01" } }
            : {}),
          result: {
            mode: "list",
            ...(omitLimit ? {} : { limit: 7 }),
            ...(afterId ? { afterId } : {}),
          },
        })
      );
      for (const item of result.items) {
        const next = item.facts.find(
          (f) => f.label === "Next content offset"
        )?.value;
        if (next) initial.push({ id: item.id, next: Number(next) });
      }
      const cursor = result.filters.find(
        (f) => f.label === "Next page cursor"
      )?.value;
      assert.ok(cursor);
      if (cursor === "End of results" || variant === "partial") break;
      assert.notEqual(cursor, afterId);
      afterId = cursor;
      assert.ok(
        page < 19,
        "Record pagination must finish within the fixture bound"
      );
    }
  }
  if (variant === "excerpt") return;
  for (const entry of initial) {
    let offset = entry.next;
    for (let n = 0; n < 20; n++) {
      const result = artifact.parse(
        await invoke("people.history.query", {
          resource: { kind: "assessments" },
          recordIds: [entry.id],
          contentOffset: offset,
          result: { mode: "list", limit: 7 },
        })
      );
      assert.equal(result.items.length, 1);
      const next = result.items[0].facts.find(
        (f) => f.label === "Next content offset"
      )?.value;
      if (!next) break;
      assert.equal(Number(next), offset + 240);
      offset = Number(next);
      assert.ok(
        n < 19,
        "Note continuation must finish within the fixture bound"
      );
    }
  }
}

test(
  "original assessment concerns and orientation comparisons use production reads and independent SQL truth",
  {
    skip: process.env.EVRY_EVE_ASSESSMENT_EVIDENCE_PROOF !== "1",
    timeout: 240_000,
  },
  async (t) => {
    const stack = await startFixtureStack(process.cwd());
    const previous = {
      database: process.env.DATABASE_URL,
      resend: process.env.RESEND_API_KEY,
      endpoint: neonConfig.fetchEndpoint,
      fetch: globalThis.fetch,
      tz: process.env.TZ,
    };
    let external = 0;
    try {
      process.env.DATABASE_URL = stack.databaseUrl;
      process.env.RESEND_API_KEY = "re_isolated_never_send";
      process.env.TZ = "Pacific/Honolulu";
      neonConfig.fetchEndpoint = stack.proxyUrl;
      globalThis.fetch = async (input, init) => {
        const url = new URL(
          input instanceof Request ? input.url : String(input)
        );
        if (url.origin !== new URL(stack.proxyUrl).origin) {
          external++;
          throw new Error("Only the isolated fixture database is permitted");
        }
        return previous.fetch(input, init);
      };
      const [
        { createEveToolRegistry },
        { requireEvryPlantViewerForSession },
        { authorizeEvryReadCapabilityForSession },
        { withAuthenticatedSessionId },
        { historyContinuationModelOutput, historyContinuationSchema },
      ] = await Promise.all([
        import("@/lib/evry/eve/capabilities/registry"),
        import("@/lib/evry/eligibility/viewer"),
        import("@/lib/evry/eligibility/capabilities"),
        import("@/lib/auth/session-scope"),
        import("@/lib/evry/eve/runtime/history-continuation"),
      ]);
      const store = createFixtureStore(stack.container);
      for (const caseId of assessmentEvidenceFixtureIds) {
        const m = createFixtureManifest(caseId, 700),
          scenario = questions.find((q) => q.id === caseId)!;
        store.seed(m);
        seedAssessmentEvidenceFixture(m, store);
        const truth = assessmentEvidenceTruth(m, store),
          expected = assessmentEvidenceExpectations(m, store);
        assert.ok(truth && expected);
        if (caseId === "assessments-03") {
          assert.equal(
            truth.records.length,
            53,
            "More than a maximum-size tool page"
          );
          assert.equal(truth.concernExemplars.length, 2);
          const concern = truth.records.find(
            (r) => r.id === assessmentEvidenceId(m, "recorded-concern")
          )!;
          assert.equal(
            concern.total,
            20,
            "A real concern is not a low-score synonym"
          );
          assert.ok(Array.from(concern.notes[0]!).length > 480);
          assert.equal(concern.entered, "2026-09-14T03:30:00.123456Z");
          assert.equal(concern.day, "2026-09-10");
        } else {
          assert.equal(truth.records.length, 10);
          assert.equal(truth.orientation?.attendees.length, 4);
          assert.ok(
            !truth.orientation?.attendees.includes(m.ids["prospect-rsvp-only"])
          );
          assert.equal(
            truth.records.filter((r) => r.day === truth.orientation?.day)
              .length,
            1
          );
        }
        const actor = await requireEvryPlantViewerForSession(m.sessionId),
          audit = store.auditStart();
        let authorizations = 0,
          calls: CapturedCall[] = [];
        const registry = createEveToolRegistry({
          context: {
            actor,
            literalUserText: scenario.turns[0]!,
            pageContext: null,
            now: new Date(m.now),
          },
          authorizeRead: (identity) => {
            authorizations++;
            return authorizeEvryReadCapabilityForSession(identity, m.sessionId);
          },
        });
        const invoke = async (name: string, input: unknown) => {
          const id = `assessment-${calls.length}`,
            output = await withAuthenticatedSessionId(m.sessionId, () =>
              registry.invoke(name, input, { callId: id })
            );
          calls.push({ id, name, input, output });
          return output;
        };
        if (caseId === "assessments-03")
          await t.test(
            "typed continuation projects real SQL pages and complete Unicode notes without changing original evidence",
            async () => {
              calls = [];
              const authorizedBefore = authorizations;
              const base = {
                resource: { kind: "assessments" },
                dateBasis: "created_at",
                latestPerPerson: false,
                result: { mode: "list", limit: 50 },
              };
              const projected = async (input: unknown) => {
                // Actual authorized production reader first; this projection is
                // not a compiled bound-registry or live-model proof.
                const original = await invoke("people.history.query", input);
                const frozen = JSON.stringify(original);
                const result = artifact
                  .extend({ continuation: historyContinuationSchema })
                  .parse(
                    historyContinuationModelOutput(
                      input,
                      z.json().parse(original)
                    )
                  );
                assert.equal(JSON.stringify(original), frozen);
                assert.ok(original && typeof original === "object");
                assert.equal(Object.hasOwn(original, "continuation"), false);
                assert.equal(result.continuation.status, "available");
                if (result.continuation.status !== "available") assert.fail();
                return { ...result, continuation: result.continuation };
              };
              const first = await projected(base);
              assert.equal(first.items.length, 50);
              assert.equal(
                first.continuation.nextAfterId,
                first.items.at(-1)?.id
              );
              assert.notEqual(first.continuation.nextAfterId, null);
              const last = await projected({
                ...base,
                result: {
                  ...base.result,
                  afterId: first.continuation.nextAfterId,
                },
              });
              assert.equal(last.items.length, 3);
              assert.equal(last.continuation.nextAfterId, null);
              const pages = [first, last];
              assert.deepEqual(
                pages.flatMap((page) =>
                  page.continuation.records.map(({ id }) => id)
                ),
                truth.records.map(({ id }) => id)
              );
              const complete = new Map<string, string>();
              const continuedOffsets: number[] = [];
              for (const page of pages) {
                for (const record of page.continuation.records) {
                  let content = record.content;
                  assert.equal(content.status, "available");
                  if (content.status !== "available") assert.fail();
                  assert.equal(content.offset, 0);
                  const row = truth.records.find(({ id }) => id === record.id);
                  assert.ok(row);
                  const expectedText = assessmentEvidenceText(row);
                  const characters = Array.from(expectedText);
                  assert.equal(content.totalCharacters, characters.length);
                  const initial = page.items.find(({ id }) => id === record.id);
                  assert.ok(initial);
                  let text = z
                    .string()
                    .parse(
                      initial.facts.find(
                        ({ label }) => label === "Recorded notes"
                      )?.value
                    );
                  assert.equal(text, characters.slice(0, 240).join(""));
                  for (let n = 0; content.nextOffset !== null; n++) {
                    assert.ok(
                      n < 3,
                      "Seeded note must finish within three continuations"
                    );
                    const offset: number = content.nextOffset;
                    continuedOffsets.push(offset);
                    const next = await projected({
                      ...base,
                      recordIds: [record.id],
                      contentOffset: offset,
                    });
                    assert.equal(next.continuation.nextAfterId, null);
                    assert.equal(next.continuation.records.length, 1);
                    assert.equal(next.continuation.records[0].id, record.id);
                    content = next.continuation.records[0].content;
                    if (content.status !== "available") assert.fail();
                    assert.equal(content.offset, offset);
                    assert.equal(content.totalCharacters, characters.length);
                    assert.equal(
                      content.nextOffset,
                      offset + 240 < characters.length ? offset + 240 : null
                    );
                    const chunk = z
                      .string()
                      .parse(
                        next.items[0].facts.find(
                          ({ label }) => label === "Recorded notes"
                        )?.value
                      );
                    assert.equal(
                      chunk,
                      characters.slice(offset, offset + 240).join("")
                    );
                    text += chunk;
                  }
                  assert.equal(text, expectedText);
                  complete.set(record.id, text);
                }
              }
              assert.equal(complete.size, 53);
              assert.deepEqual(continuedOffsets, [240, 480]);
              const unicode = complete.get(
                assessmentEvidenceId(m, "recorded-concern")
              );
              assert.ok(unicode);
              assert.ok(unicode.includes("🙂"));
              assert.ok(unicode.length > Array.from(unicode).length);
              assert.equal(calls.length, 4);
              assert.equal(authorizations - authorizedBefore, calls.length);
              // The established independent observer still sees only original
              // reader outputs and must prove all evidence, unchanged.
              assert.deepEqual(
                required(
                  observedAssessmentEvidenceFacts(caseId, calls, truth).facts,
                  expected.facts
                ),
                expected.facts
              );
              for (const call of calls)
                for (const absent of expected.absentRecordIds)
                  assert.ok(!JSON.stringify(call.output).includes(absent));
              assert.deepEqual(store.writesSince(audit, m), []);
            }
          );
        await t.test(
          `${caseId}: complete authorized history matches stored dates, scores and all notes`,
          async () => {
            for (const strategy of caseId === "assessments-03"
              ? (["plant", "batched-people"] as const)
              : ([
                  "plant",
                  "attendees",
                  "split-latest",
                  "batched-people",
                  "bounded-latest",
                ] as const)) {
              calls = [];
              await retrieve(caseId, invoke, strategy, "complete");
              const got = observedAssessmentEvidenceFacts(caseId, calls, truth);
              assert.deepEqual(
                required(got.facts, expected.facts),
                expected.facts,
                JSON.stringify(got)
              );
              assert.deepEqual(got.evidence, expected.requiredEvidence);
              for (const call of calls)
                for (const absent of expected.absentRecordIds)
                  assert.ok(!JSON.stringify(call.output).includes(absent));
              if (caseId === "assessments-03") {
                assert.ok(
                  calls.filter((c) => c.name === "people.history.query")
                    .length > 8
                );
                assert.ok(
                  calls.some(
                    (c) =>
                      z
                        .object({ contentOffset: z.number().positive() })
                        .safeParse(c.input).success
                  )
                );
              } else {
                assert.equal(
                  z.array(z.string()).parse(got.facts.comparisonMatchedPeople)
                    .length,
                  strategy === "attendees" ? 2 : 3
                );
                assert.deepEqual(got.facts.comparisonBeforeOnlyPeople, [
                  m.ids["prospect-new"],
                ]);
                assert.deepEqual(got.facts.comparisonAfterOnlyPeople, [
                  m.ids["prospect-followed"],
                ]);
                assert.equal(
                  z.array(z.string()).parse(got.facts.sameDayAssessmentIds)
                    .length,
                  strategy === "split-latest" || strategy === "bounded-latest"
                    ? 0
                    : 1
                );
              }
            }
            if (caseId === "assessments-03") {
              calls = [];
              await retrieve(caseId, invoke, "plant", "complete", true);
              assert.deepEqual(
                required(
                  observedAssessmentEvidenceFacts(caseId, calls, truth).facts,
                  expected.facts
                ),
                expected.facts
              );
            }
            assert.ok(authorizations > 0);
            assert.deepEqual(store.writesSince(audit, m), []);
          }
        );
        await t.test(
          `${caseId}: actual incomplete, narrowed and wrong-date reads fail evidence grading`,
          async () => {
            const variants: Variant[] =
              caseId === "assessments-03"
                ? [
                    "partial",
                    "excerpt",
                    "latest-only",
                    "keyword",
                    "score-cutoff",
                  ]
                : [
                    "partial",
                    "latest-only",
                    "wrong-date-basis",
                    "wrong-window",
                  ];
            for (const variant of variants) {
              calls = [];
              await retrieve(
                caseId,
                invoke,
                variant === "wrong-window" ? "bounded-latest" : "plant",
                variant
              );
              assert.notDeepEqual(
                required(
                  observedAssessmentEvidenceFacts(caseId, calls, truth).facts,
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
          `${caseId}: invalid offsets, foreign records and revoked actors are refused`,
          async () => {
            const invalid = await invoke("people.history.query", {
              resource: { kind: "assessments" },
              contentOffset: -1,
              result: { mode: "list" },
            });
            assert.equal(
              z.object({ status: z.string() }).parse(invalid).status,
              "invalid_input"
            );
            const foreign = artifact.parse(
              await invoke("people.history.query", {
                resource: { kind: "assessments" },
                recordIds: [assessmentEvidenceId(m, "foreign")],
                result: { mode: "list" },
              })
            );
            assert.equal(foreign.counts.matched, 0);
            assert.deepEqual(foreign.items, []);
            assert.deepEqual(store.writesSince(audit, m), []);
            store.revoke(m);
            const afterRevoke = store.auditStart();
            await assert.rejects(
              () =>
                invoke("people.history.query", {
                  resource: { kind: "assessments" },
                  result: { mode: "list" },
                }),
              {
                name: "UnauthorizedError",
                message: UNAUTHORIZED_MESSAGE,
                digest: SESSION_EXPIRED_DIGEST,
              }
            );
            assert.deepEqual(store.writesSince(afterRevoke, m), []);
          }
        );
      }
      await t.test(
        "actual adapter preserves original prompts and optional native clarification, grades SQL evidence, and does not fabricate model quality",
        async () => {
          const { createProductionEveEvalAdapter } =
            await import("@/lib/evry/eve/evals/fixtures/adapter");
          let strategy: Strategy = "plant",
            variant: Variant = "complete";
          const sessions = new Set<string>();
          const adapter = createProductionEveEvalAdapter({
            store,
            buildSha: "0".repeat(40),
            async runProduction({ scenario, registry, sessionId }) {
              assert.deepEqual(
                scenario.turns,
                [
                  ...questions.find((q) => q.id === scenario.id)!.turns,
                  ...(scenario.id === "assessments-03"
                    ? [{ respondIfAsked: "The individual 4C assessments." }]
                    : []),
                ]
              );
              sessions.add(sessionId);
              let n = 0;
              await retrieve(
                scenario.id,
                (name, input) =>
                  registry.invoke(name, input, {
                    callId: `assessment-adapter-${n++}`,
                  }),
                strategy,
                variant
              );
              return {
                eveSessionId: sessionId,
                answer:
                  "Scripted assessment data proof. Narrative quality has not been reviewed.",
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
          for (const caseId of assessmentEvidenceFixtureIds) {
            const scenario = questions.find((q) => q.id === caseId)!,
              fixture = await adapter.prepare(scenario);
            assert.ok(
              fixture,
              "Root must wire the assessment-evidence family before running this proof"
            );
            try {
              const strategies: { strategy: Strategy; variant: Variant }[] =
                caseId === "assessments-03"
                  ? [
                      { strategy: "plant", variant: "complete" },
                      { strategy: "batched-people", variant: "complete" },
                      { strategy: "plant", variant: "excerpt" },
                      { strategy: "plant", variant: "keyword" },
                    ]
                  : [
                      { strategy: "plant", variant: "complete" },
                      { strategy: "attendees", variant: "complete" },
                      { strategy: "split-latest", variant: "complete" },
                      { strategy: "batched-people", variant: "complete" },
                      { strategy: "bounded-latest", variant: "complete" },
                      { strategy: "bounded-latest", variant: "wrong-window" },
                      { strategy: "plant", variant: "wrong-date-basis" },
                    ];
              for (const selected of strategies) {
                ({ strategy, variant } = selected);
                const observation = observationSchema.parse(
                  await fixture.run({
                    scenario,
                    signal: AbortSignal.timeout(45_000),
                    maxCostUsd: 0.1,
                  })
                );
                const failures: readonly string[] = gradeObservation(
                  caseId,
                  fixture.expectations,
                  observation
                ).failures;
                assert.equal(observation.judge, null);
                assert.equal(observation.costUsd, 0);
                assert.deepEqual(observation.effects, {
                  domainWrites: 0,
                  outboundMessages: 0,
                });
                if (variant === "complete")
                  assert.deepEqual(
                    failures,
                    ["quality_not_reviewed"],
                    JSON.stringify({ caseId, strategy, variant, failures })
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
          }
          for (const session of sessions)
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
      for (const [key, value] of [
        ["DATABASE_URL", previous.database],
        ["RESEND_API_KEY", previous.resend],
        ["TZ", previous.tz],
      ] as const) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      await stack.cleanup();
    }
  }
);
