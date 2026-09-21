import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { z } from "zod";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { staffingFixtureIds } from "@/lib/evry/eve/evals/fixtures/staffing";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { observationSchema } from "@/lib/evry/eve/evals/contract";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";

test(
  "staffing questions use production tools against independent SQL truth",
  { skip: process.env.EVRY_EVE_STAFFING_PROOF !== "1", timeout: 180_000 },
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
            "Staffing fixture allows only its disposable database proxy"
          );
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      let wrong = false;
      let wrongDisplay = false;
      const adapter = createProductionEveEvalAdapter({
        store: createFixtureStore(stack.container),
        buildSha: "0".repeat(40),
        async runProduction({ scenario, registry, onPresentResult }) {
          let calls = 0;
          const invoke = async (
            name: string,
            input: unknown,
            present = false
          ) => {
            const callId = `staffing-${calls++}`;
            const artifact = capturedReadArtifactSchema.parse(
              await registry.invoke(name, input, { callId })
            );
            if (present) onPresentResult(callId);
            return artifact;
          };
          if (scenario.id === "people-06") {
            let afterId: string | undefined;
            let shown = 0;
            for (;;) {
              const page = await invoke(
                "people.query",
                {
                  cohort: {
                    all: {
                      tags: {
                        names: ["worship", "hospitality"],
                        ...(!wrong ? { noneNames: ["inactive"] } : {}),
                      },
                    },
                  },
                  result: {
                    mode: "list",
                    limit: 2,
                    ...(afterId ? { afterId } : {}),
                  },
                },
                true
              );
              shown += page.items.length;
              if (shown >= page.counts.matched) break;
              assert.ok(page.items.length, "Continuation must make progress");
              afterId = page.items.at(-1)!.id;
            }
            assert.equal(shown, wrong ? 4 : 3);
          }
          if (scenario.id === "roles-03") {
            const found = await invoke("teams.query", {
              request: {
                resource: "roles",
                where: {
                  all: [{ search: wrong ? "Custom hospitality" : "check-in" }],
                },
                query: { mode: "list" },
              },
            });
            assert.equal(found.items.length, 1);
            await invoke(
              "teams.get_many",
              {
                resource: "roles",
                ids: found.items.map((i) => i.id),
                sections: ["requirements"],
              },
              true
            );
          }
          if (scenario.id === "roles-04") {
            const found = await invoke("teams.query", {
              request: {
                resource: "roles",
                where: { all: [{ vacant: false }] },
                query: { mode: "list" },
              },
            });
            assert.equal(found.items.length, 3);
            const roles = await invoke("teams.get_many", {
              resource: "roles",
              ids: found.items
                .filter((item) => !wrong || item.label === "Custom hospitality")
                .map((i) => i.id),
              sections: ["requirements", "roster"],
            });
            const value = (item: (typeof roles.items)[number], label: string) =>
              item.facts?.find((f) => f.label === label)?.value;
            const personId = (item: (typeof roles.items)[number]) =>
              z
                .uuid()
                .parse(
                  value(item, "Assigned person linkage")?.match(
                    /\[([^\]]+)\]$/
                  )?.[1]
                );
            const people = await invoke("people.get_many", {
              resource: "person",
              ids: roles.items.map(personId),
              fields: ["background_check"],
            });
            const peopleById = new Map(people.items.map((i) => [i.id, i]));
            const affected = roles.items.filter((role) =>
              wrong || wrongDisplay
                ? role.label === "Custom hospitality"
                : value(role, "Background check required") === "Yes" &&
                  value(peopleById.get(personId(role))!, "Background check") !==
                    "Cleared"
            );
            assert.equal(affected.length, 1);
            await invoke(
              "teams.get_many",
              {
                resource: "roles",
                ids: affected.map((i) => i.id),
                sections: ["requirements", "roster"],
              },
              true
            );
          }
          return {
            answer: "Scripted production-tool fixture, not a model answer.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      for (const id of staffingFixtureIds)
        await t.test(id, async (t) => {
          const scenario = questions.find((q) => q.id === id);
          assert.ok(scenario);
          const fixture = await adapter.prepare(scenario);
          assert.ok(fixture, `${id} must be bound in the production adapter`);
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
                facts: good.facts,
              })
            );
            assert.deepEqual(good.effects, {
              domainWrites: 0,
              outboundMessages: 0,
            });
            assert.equal(good.costUsd, 0);
            if (id === "roles-04")
              await t.test(
                "wrong display does not falsify retrieved facts or bypass answer review",
                async () => {
                  wrongDisplay = true;
                  try {
                    const shownWrong = await run();
                    assert.deepEqual(shownWrong.facts, good.facts);
                    assert.notDeepEqual(
                      shownWrong.exposedRecordIds,
                      good.exposedRecordIds
                    );
                    assert.deepEqual(
                      gradeObservation(id, fixture.expectations, shownWrong)
                        .failures,
                      ["quality_not_reviewed"]
                    );
                    assert.equal(
                      shownWrong.judge,
                      null,
                      "Correct retrieval is not a judgment that the displayed answer is grounded"
                    );
                  } finally {
                    wrongDisplay = false;
                  }
                }
              );
            await t.test(
              "incorrect exclusion or name-based role policy fails SQL facts",
              async () => {
                wrong = true;
                try {
                  const bad = gradeObservation(
                    id,
                    fixture.expectations,
                    await run()
                  );
                  assert.ok(
                    bad.failures.some((f) => f.startsWith("fact:")),
                    JSON.stringify(bad)
                  );
                  assert.ok(bad.failures.includes("quality_not_reviewed"));
                } finally {
                  wrong = false;
                }
              }
            );
            assert.equal(outboundAttempts, 0);
          } finally {
            await fixture.cleanup();
          }
        });
    } finally {
      globalThis.fetch = originalFetch;
      await stack.cleanup();
    }
  }
);
