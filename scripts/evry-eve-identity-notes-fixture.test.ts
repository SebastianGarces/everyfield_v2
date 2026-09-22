import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { questions, regressions } from "@/lib/evry/eve/evals/catalog";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import {
  capturedReadArtifactSchema,
  type CapturedCall,
} from "@/lib/evry/eve/evals/fixtures/host-capture";
import {
  identityNotesFixtureIds,
  identityNotesQuestions,
  exactIdentityNote,
  identityNotePlanReference,
} from "@/lib/evry/eve/evals/fixtures/identity-notes";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";

test(
  "identity and exact-note originals use production readers, saved plans and native questions",
  { skip: process.env.EVRY_EVE_IDENTITY_NOTES_PROOF !== "1", timeout: 300_000 },
  async (t) => {
    assert.ok(
      process.env.EVRY_EVE_COMPILED_ENTRY,
      "Native ambiguity checks require an actual compiled Eve artifact"
    );
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
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
          throw new Error("External fetch prohibited in identity fixture");
        }
        return previous.fetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      const store = createFixtureStore(stack.container);
      let variant:
          | "correct"
          | "wrong-person"
          | "wrong-note"
          | "unshown"
          | "unrelated-question" = "correct",
        serial = 0;
      const adapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        async runProduction({
          scenario,
          registry,
          actor,
          sessionId,
          sessionToken,
          now,
          onPresentResult,
        }) {
          const caseId = identityNotesFixtureIds.find(
            (id) => id === scenario.id
          );
          assert.ok(caseId);
          assert.deepEqual(
            scenario.turns,
            [identityNotesQuestions[caseId]],
            "No hidden follow-up or modified original request"
          );
          if (caseId !== "notes-05") {
            const prompt =
              variant === "unrelated-question"
                ? "When would you like to schedule this?"
                : "Which Alex do you mean?";
            const options =
              variant === "unrelated-question"
                ? [
                    { id: "tomorrow", label: "Tomorrow" },
                    { id: "friday", label: "Friday" },
                  ]
                : [
                    { id: "morgan", label: "Alex Morgan" },
                    { id: "reed", label: "Alex Reed" },
                  ];
            const outcome = await runCompiledEveFixture(
              {
                compiledEntry: resolve(process.env.EVRY_EVE_COMPILED_ENTRY!),
                databaseUrl: stack.databaseUrl,
                proxyUrl: stack.proxyUrl,
                sessionToken,
                actor: { userId: actor.userId, plantId: actor.plantId },
                turns: [...scenario.turns],
                now: now.toISOString(),
                maxCostUsd: 1,
                prices: {
                  inputUsdPerMillion: 1,
                  outputUsdPerMillion: 2,
                  maxInputBytes: 500_000,
                  maxOutputTokens: 1000,
                },
                model: {
                  mode: "scripted",
                  responses: [
                    {
                      toolCalls: [
                        {
                          id: "load-people",
                          name: "load_tools",
                          input: {
                            names: ["people.query"],
                            preparationOperations: [],
                            mode: "replace",
                          },
                        },
                      ],
                    },
                    {
                      toolCalls: [
                        {
                          id: "find-alex",
                          name: "code_mode",
                          input: {
                            js: "return await tools['people.query']({cohort:{all:{search:'Alex'}},result:{mode:'list',limit:20}});",
                          },
                        },
                      ],
                    },
                    {
                      toolCalls: [
                        {
                          id: "choose-person",
                          name: "ask_question",
                          input: { prompt, options, allowFreeform: true },
                        },
                      ],
                    },
                  ],
                },
              },
              AbortSignal.timeout(65_000)
            );
            assert.deepEqual(outcome.runtimeProof?.failures, []);
            assert.ok(
              outcome.runtimeProof?.eventTypes.includes("input.requested")
            );
            assert.deepEqual(
              outcome.runtimeProof?.questionAnswers,
              [],
              "No response is injected into an arbitrary question"
            );
            assert.equal(outcome.clarificationCount, 1);
            assert.equal(outcome.judge, null);
            return outcome;
          }
          const calls: CapturedCall[] = [];
          const invoke = async (name: string, input: unknown) => {
            const id = `identity-${serial++}`,
              output = await registry.invoke(name, input, { callId: id });
            calls.push({ id, name, input, output });
            return output;
          };
          const people = capturedReadArtifactSchema.parse(
            await invoke("people.query", {
              cohort: {
                all: { search: variant === "wrong-person" ? "Robin" : "Alex" },
              },
              result: { mode: "list", limit: 20 },
            })
          );
          assert.equal(people.items.length, 1);
          await invoke("actions.prepare", {
            request: {
              operation: "people.add_note",
              arguments: {
                personId: people.items[0]!.id,
                note:
                  variant === "wrong-note"
                    ? "Called tomorrow; prefers a morning interview."
                    : exactIdentityNote,
              },
            },
          });
          const review = calls.at(-1)!;
          assert.ok(
            identityNotePlanReference(calls, new Set([review.id])),
            "Wrong selection must still produce a real canonical review"
          );
          if (variant !== "unshown") onPresentResult(review.id);
          return {
            eveSessionId: sessionId,
            answer: "Scripted exact-note proof; model quality not reviewed.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const caseId of identityNotesFixtureIds)
        await t.test(caseId, async (t) => {
          const scenario = [...questions, ...regressions].find(
            (q) => q.id === caseId
          )!;
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture);
          try {
            const modes =
              caseId === "notes-05"
                ? ([
                    "correct",
                    "wrong-person",
                    "wrong-note",
                    "unshown",
                  ] as const)
                : (["correct", "unrelated-question"] as const);
            for (const mode of modes)
              await t.test(mode, async () => {
                variant = mode;
                const observation = observationSchema.parse(
                  await fixture.run({
                    scenario,
                    signal: AbortSignal.timeout(80_000),
                    maxCostUsd: 1,
                  })
                );
                const failures: readonly string[] = gradeObservation(
                  caseId,
                  fixture.expectations,
                  observation
                ).failures;
                assert.deepEqual(observation.effects, {
                  domainWrites: 0,
                  outboundMessages: 0,
                });
                assert.equal(observation.judge, null);
                if (mode === "correct")
                  assert.deepEqual(
                    failures,
                    ["quality_not_reviewed"],
                    JSON.stringify(observation.facts)
                  );
                else
                  assert.ok(
                    failures.some((failure) => failure.startsWith("fact:")),
                    `${caseId}/${mode}: ${JSON.stringify(failures)}`
                  );
              });
          } finally {
            await fixture.cleanup();
          }
        });
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
