import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { z } from "zod";
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
  foundationalRequestIds,
  foundationalQuestions,
} from "@/lib/evry/eve/evals/fixtures/foundational-requests";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";
import type { ProductionEvalRunner } from "@/lib/evry/eve/evals/fixtures/adapter";

test(
  "foundational originals use real launch relations, saved feedback review and compiled capability response",
  {
    skip: process.env.EVRY_EVE_FOUNDATIONAL_REQUESTS_PROOF !== "1",
    timeout: 300_000,
  },
  async (t) => {
    assert.ok(
      process.env.EVRY_EVE_COMPILED_ENTRY,
      "Capability smoke must traverse an actual compiled model turn"
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
          throw new Error("External fetch prohibited in foundational fixture");
        }
        return previous.fetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      const store = createFixtureStore(stack.container);
      let variant:
          | "correct"
          | "broad"
          | "missing-page"
          | "wrong-cohort"
          | "unshown"
          | "wrong-operation"
          | "stale-review"
          | "unnecessary-question" = "correct",
        serial = 0;
      const runProduction: ProductionEvalRunner = async ({
        scenario,
        registry,
        actor,
        sessionId,
        sessionToken,
        now,
        onPresentResult,
      }) => {
        const id = foundationalRequestIds.find((id) => id === scenario.id);
        assert.ok(id);
        assert.deepEqual(
          scenario.turns,
          [foundationalQuestions[id]],
          "The original request has no hidden follow-up or answer hint"
        );
        if (id === "regression-capabilities") {
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
                responses:
                  variant === "unnecessary-question"
                    ? [
                        {
                          toolCalls: [
                            {
                              id: "question",
                              name: "ask_question",
                              input: {
                                prompt: "Which feature are you asking about?",
                                allowFreeform: true,
                              },
                            },
                          ],
                        },
                      ]
                    : [
                        {
                          text: "I can help you find people, review tasks and meetings, and prepare changes for your confirmation.",
                        },
                      ],
              },
            },
            AbortSignal.timeout(65_000)
          );
          assert.deepEqual(outcome.runtimeProof?.failures, []);
          assert.ok(
            outcome.runtimeProof?.modelRequests?.length,
            "Actual model adapter was invoked; scripted prose is only a transport proof, not quality evidence"
          );
          assert.deepEqual(
            outcome.runtimeProof?.questionAnswers,
            [],
            "No canned answer to an arbitrary clarification"
          );
          assert.equal(outcome.judge, null);
          return outcome;
        }
        const calls: CapturedCall[] = [];
        const invoke = async (name: string, input: unknown) => {
          const callId = `foundational-${serial++}`;
          let output: unknown;
          if (variant === "stale-review" && name === "actions.prepare") {
            // The repository deliberately owns its creation clock; a supplied
            // preparation-context date does not control immutable plan expiry.
            t.mock.timers.enable({
              apis: ["Date"],
              now: now.getTime() - 86_400_000,
            });
            try {
              output = await registry.invoke(name, input, { callId });
            } finally {
              t.mock.timers.reset();
            }
          } else output = await registry.invoke(name, input, { callId });
          calls.push({ id: callId, name, input, output });
          return output;
        };
        if (id === "launch-02") {
          let offset = 0,
            total: number;
          do {
            const output = capturedReadArtifactSchema.parse(
              await invoke("launch.query", {
                query: {
                  resource: "milestones",
                  completion:
                    variant === "wrong-cohort"
                      ? "complete"
                      : variant === "broad"
                        ? "any"
                        : "open",
                  blockedByOverdueTask: variant !== "broad",
                  limit: 1,
                  offset,
                },
              })
            );
            total = output.counts.matched;
            if (variant === "correct")
              assert.equal(
                total,
                2,
                "Real reader must reject future/today/completed/deleted/unlinked and foreign distractors"
              );
            onPresentResult(calls.at(-1)!.id);
            offset += output.items.length;
            assert.ok(
              output.items.length > 0 || offset === total,
              "Do not loop over an incomplete production page"
            );
            if (variant === "missing-page") break;
          } while (offset < total);
        } else {
          if (variant === "wrong-operation") {
            const people = capturedReadArtifactSchema.parse(
              await invoke("people.query", {
                cohort: { all: { search: "Alex" } },
                result: { mode: "list", limit: 20 },
              })
            );
            assert.ok(people.items[0]);
            await invoke("actions.prepare", {
              request: {
                operation: "people.add_note",
                arguments: {
                  personId: people.items[0].id,
                  note: "Task filtering is confusing.",
                },
              },
            });
          } else
            await invoke("actions.prepare", {
              request: {
                operation: "feedback.submit",
                arguments: {
                  category: "suggestion",
                  description: "Task filtering is confusing.",
                  pageUrl: null,
                },
              },
            });
          const prepared = calls.at(-1)!;
          assert.ok(
            typeof prepared.output === "object" &&
              prepared.output !== null &&
              "activePlan" in prepared.output,
            "Must exercise a real saved preparation"
          );
          if (variant !== "unshown") onPresentResult(prepared.id);
          if (variant === "stale-review") {
            const { activePlan } = z
              .object({
                activePlan: z.object({
                  mode: z.literal("set"),
                  plan: z.object({
                    planId: z.uuid(),
                    fingerprint: z.string().regex(/^[a-f0-9]{64}$/),
                  }),
                }),
              })
              .parse(prepared.output);
            const [stored] = z
              .tuple([
                z.object({
                  created_ms: z.coerce.number(),
                  expired: z.literal(true),
                  positive_lifetime: z.literal(true),
                }),
              ])
              .parse(
                store.query(
                  `select extract(epoch from created_at)*1000 as created_ms, expires_at <= '${now.toISOString()}'::timestamptz as expired, expires_at > created_at as positive_lifetime from evry_action_plans where id='${activePlan.plan.planId}' and fingerprint='${activePlan.plan.fingerprint}' and church_id='${actor.plantId}' and actor_user_id='${actor.userId}'`
                )
              );
            assert.equal(
              stored.created_ms,
              now.getTime() - 86_400_000,
              "Actual immutable plan creation, not context.now, must use the earlier fixture instant"
            );
          }
        }
        return {
          eveSessionId: sessionId,
          answer: "Scripted production capability proof; quality not reviewed.",
          clarificationCount: 0,
          costUsd: 0,
          judge: null,
          latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
        };
      };
      const registryAdapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        runProduction,
      });
      const compiledAdapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        captureMode: "isolated_http",
        runProduction,
      });
      for (const id of foundationalRequestIds)
        await t.test(id, async (t) => {
          const scenario = [...questions, ...regressions].find(
            (q) => q.id === id
          )!;
          const variants =
            id === "launch-02"
              ? (["correct", "broad", "missing-page", "wrong-cohort"] as const)
              : id === "notifications-04"
                ? ([
                    "correct",
                    "unshown",
                    "wrong-operation",
                    "stale-review",
                  ] as const)
                : (["correct", "unnecessary-question"] as const);
          for (const mode of variants)
            await t.test(mode, async () => {
              variant = mode;
              const fixture = await (
                id === "regression-capabilities"
                  ? compiledAdapter
                  : registryAdapter
              ).prepare(scenario);
              assert.ok(fixture);
              try {
                const observation = observationSchema.parse(
                  await fixture.run({
                    scenario,
                    signal: AbortSignal.timeout(80_000),
                    maxCostUsd: 1,
                  })
                );
                const failures = gradeObservation(
                  id,
                  fixture.expectations,
                  observation
                ).failures;
                assert.deepEqual(observation.effects, {
                  domainWrites: 0,
                  outboundMessages: 0,
                });
                assert.equal(observation.judge, null);
                if (mode === "correct" || mode === "broad")
                  assert.deepEqual(
                    failures,
                    ["quality_not_reviewed"],
                    JSON.stringify(observation.facts)
                  );
                else
                  assert.ok(
                    failures.some((f) => f.startsWith("fact:")),
                    `${id}/${mode}: ${JSON.stringify(failures)}`
                  );
              } finally {
                await fixture.cleanup();
              }
            });
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
