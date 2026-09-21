import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  contentFixtureIds,
  contentWindows,
  missingWikiTopic,
} from "@/lib/evry/eve/evals/fixtures/content";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";

test(
  "content questions use authorized reads against independent SQL truth",
  { skip: process.env.EVRY_EVE_CONTENT_PROOF !== "1", timeout: 180_000 },
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
            "Content fixture permits only its disposable database proxy"
          );
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let wrong = false;
      let wrongBoundary: "start" | "end" | null = null;
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry, onPresentResult }) {
          let calls = 0;
          const invoke = async (
            name: string,
            input: unknown,
            present = true
          ) => {
            const callId = `content-${calls++}`;
            const output = await registry.invoke(name, input, { callId });
            capturedReadArtifactSchema.parse(output);
            if (present) onPresentResult(callId);
            return output;
          };
          if (scenario.id === "communication-07")
            for (const window of [
              contentWindows.month,
              contentWindows.previousMonth,
            ]) {
              const previous = window === contentWindows.previousMonth;
              const output = await invoke("communication.query", {
                query: {
                  resource: wrong ? "messages" : "distinct_recipients",
                  channel: "email",
                  mode: "count",
                  timeField: "sent",
                  statuses: ["sent"],
                  window:
                    previous && wrongBoundary === "end"
                      ? { ...window, until: "2026-08-31T23:59:59-04:00" }
                      : previous && wrongBoundary === "start"
                        ? { ...window, from: "2026-08-01T00:00:00Z" }
                        : window,
                },
              });
              if (previous && wrongBoundary)
                assert.equal(
                  capturedReadArtifactSchema.parse(output).counts.matched,
                  wrongBoundary === "end" ? 1 : 3,
                  "Each bad boundary changes distinct SQL truth, not merely query metadata"
                );
            }
          if (scenario.id === "documents-02")
            await invoke("documents.query", {
              query: {
                resource: "generated",
                ...(wrong ? {} : { templateIds: ["commitment-card"] }),
                window: contentWindows.previousMonth,
              },
            });
          if (scenario.id === "wiki-04") {
            const output = await registry.invoke(
              "context.get",
              {},
              { callId: `content-${calls++}` }
            );
            const { currentPhase } = z
              .object({ currentPhase: z.number().int() })
              .parse(output);
            assert.equal(
              currentPhase,
              2,
              "church row phase, not foreign phase 5 or inferred readiness"
            );
            await invoke("wiki.search", {
              phases: [currentPhase],
              ...(wrong
                ? {}
                : { readingStatuses: ["not_started", "in_progress"] }),
            });
          }
          if (
            ["wiki-01", "wiki-02", "wiki-05", "wiki-07"].includes(scenario.id)
          ) {
            if (!wrong && scenario.id === "wiki-05") {
              const globalOnly = capturedReadArtifactSchema.parse(
                await invoke(
                  "wiki.search",
                  { queries: ["west hall"], limit: 1 },
                  false
                )
              );
              assert.equal(
                globalOnly.counts.matched,
                0,
                "A matching global passage stays suppressed even when its local override does not match, before rank/limit"
              );
            }
            const query =
              scenario.id === "wiki-07"
                ? missingWikiTopic
                : scenario.id === "wiki-02"
                  ? "Vision Meeting"
                  : "orientation";
            const search = await invoke("wiki.search", {
              queries: [
                wrong && scenario.id !== "wiki-02" ? "accounting" : query,
              ],
            });
            if (scenario.id === "wiki-02" || scenario.id === "wiki-05") {
              if (!wrong) {
                const items = capturedReadArtifactSchema.parse(search).items;
                assert.equal(items.length, scenario.id === "wiki-02" ? 2 : 1);
                for (const item of items) {
                  const slug = item.facts?.find(
                    (f) => f.label === "Citation slug"
                  )?.value;
                  assert.ok(slug);
                  let offset = 0;
                  let revision: string | undefined;
                  do {
                    const read = capturedReadArtifactSchema.parse(
                      await invoke(
                        "wiki.read_many",
                        {
                          articles: [
                            { slug, offset, ...(revision ? { revision } : {}) },
                          ],
                          maxCharacters: 500,
                        },
                        false
                      )
                    );
                    assert.equal(read.items.length, 1);
                    const fields = read.items[0]!.facts!;
                    revision = fields.find(
                      (f) => f.label === "Revision"
                    )!.value;
                    const next = fields.find(
                      (f) => f.label === "Next offset"
                    )!.value;
                    if (next === "End of article") break;
                    assert.ok(Number(next) > offset);
                    offset = Number(next);
                  } while (true);
                }
              }
              // Bad variant deliberately searches without reading full content.
            }
          }
          if (scenario.id === "intelligence-04")
            await invoke("intelligence.query", {
              query: {
                resource: "assessments",
                limit: wrong ? 1 : 2,
                includeFactSnapshot: !wrong,
              },
            });
          if (scenario.id === "notifications-02")
            await invoke("notifications.query", {
              unreadOnly: !wrong,
              categories: ["tasks"],
              window: contentWindows.week,
            });
          return {
            answer: "Scripted production-tool fixture, not a model answer.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const id of contentFixtureIds)
        await t.test(id, async () => {
          const scenario = questions.find((q) => q.id === id);
          assert.ok(scenario);
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${id} must be bound`);
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
            const grade = gradeObservation(id, fixture.expectations, good);
            assert.deepEqual(
              grade.failures,
              ["quality_not_reviewed"],
              JSON.stringify({
                grade,
                expected: fixture.expectations.facts,
                actual: good.facts,
              })
            );
            assert.deepEqual(good.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            assert.equal(good.costUsd, 0);
            wrong = true;
            const bad = gradeObservation(id, fixture.expectations, await run());
            assert.ok(
              bad.failures.some((f) => f.startsWith("fact:")),
              JSON.stringify(bad)
            );
            assert.ok(bad.failures.includes("quality_not_reviewed"));
            if (id === "communication-07") {
              wrong = false;
              for (const boundary of ["start", "end"] as const) {
                wrongBoundary = boundary;
                const observation = await run();
                const boundaryGrade = gradeObservation(
                  id,
                  fixture.expectations,
                  observation
                );
                assert.ok(
                  boundaryGrade.failures.includes("fact:lastMonthPeople")
                );
                assert.ok(
                  boundaryGrade.failures.includes(
                    "missing_evidence:distinct-email-months"
                  )
                );
                assert.ok(
                  boundaryGrade.failures.includes("quality_not_reviewed")
                );
                assert.deepEqual(observation.effects, {
                  domainWrites: 0,
                  outboundMessages: 0,
                });
              }
            }
            assert.equal(outboundAttempts, 0);
          } finally {
            wrong = false;
            wrongBoundary = null;
            await fixture.cleanup();
          }
        });
    } finally {
      globalThis.fetch = originalFetch;
      await stack.cleanup();
    }
  }
);
