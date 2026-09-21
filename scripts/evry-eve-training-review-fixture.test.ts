import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { trainingReviewFixtureIds } from "@/lib/evry/eve/evals/fixtures/training-review";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";

test(
  "current-role training questions use production requirements and independent SQL",
  {
    skip: process.env.EVRY_EVE_TRAINING_REVIEW_PROOF !== "1",
    timeout: 180_000,
  },
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
          throw new Error("Only isolated database requests allowed");
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let variant:
        | "correct"
        | "all-requirements"
        | "paged"
        | "completed"
        | "optional"
        | "one-person" = "correct";
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry }) {
          let n = 0;
          const invoke = async (name: string, input: unknown) =>
            capturedReadArtifactSchema.parse(
              await registry.invoke(name, input, { callId: `training-${n++}` })
            );
          const people =
            scenario.id === "training-03" || variant === "one-person"
              ? await invoke("people.query", {
                  cohort: {
                    anyOf: [
                      { search: "Alex" },
                      ...(variant === "one-person"
                        ? []
                        : [{ search: "Jordan" }]),
                    ],
                  },
                  result: { mode: "list" },
                })
              : null;
          const personFilter = people
            ? { personIds: people.items.map((i) => i.id) }
            : {};
          const assignments = await invoke("teams.query", {
            request: {
              resource: "assignments",
              where: { all: [{ ...personFilter, statuses: ["active"] }] },
              query: { mode: "list", limit: 50 },
            },
          });
          assert.ok(
            assignments.items.every((i) =>
              i.facts?.some((f) => f.label === "Role ID")
            ),
            "Current role identities must be available for explanations"
          );
          let cursor: string | undefined;
          do {
            const input = {
              request: {
                resource: "requirements",
                where: {
                  all: [
                    {
                      ...personFilter,
                      ...(variant === "all-requirements"
                        ? {}
                        : { completed: variant === "completed" }),
                      ...(variant === "optional" ? { required: false } : {}),
                    },
                  ],
                },
                query: {
                  mode: "list",
                  limit: variant === "paged" ? 1 : 50,
                  ...(cursor ? { cursor } : {}),
                },
              },
            };
            const output = await registry.invoke("training.query", input, {
              callId: `training-${n++}`,
            });
            const { filters } = capturedReadArtifactSchema
              .extend({
                filters: z.array(
                  z.object({ label: z.string(), value: z.string() })
                ),
              })
              .parse(output);
            const next = filters.find(
              (f) => f.label === "Next page cursor"
            )?.value;
            cursor = next && next !== "End of results" ? next : undefined;
          } while (cursor);
          return {
            answer:
              "Scripted SQL-grounded retrieval proof; answer quality not reviewed.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const id of trainingReviewFixtureIds)
        await t.test(id, async () => {
          const scenario = questions.find((q) => q.id === id)!;
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${id} must be wired`);
          try {
            for (const mode of [
              "correct",
              "all-requirements",
              "paged",
              "completed",
              "optional",
              "one-person",
            ] as const) {
              variant = mode;
              const observation = observationSchema.parse(
                await fixture.run({
                  scenario,
                  signal: AbortSignal.timeout(30_000),
                  maxCostUsd: 0.1,
                })
              );
              const failures: readonly string[] = gradeObservation(
                id,
                fixture.expectations,
                observation
              ).failures;
              assert.deepEqual(observation.effects, {
                domainWrites: 0,
                outboundMessages: 0,
              });
              if (["correct", "all-requirements", "paged"].includes(mode))
                assert.deepEqual(
                  failures,
                  ["quality_not_reviewed"],
                  JSON.stringify(observation.facts)
                );
              else {
                assert.ok(
                  failures.some((f) => f.startsWith("fact:")),
                  `${id}/${mode} must fail independent truth`
                );
                assert.ok(failures.includes("quality_not_reviewed"));
              }
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
