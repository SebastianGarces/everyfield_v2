import assert from "node:assert/strict";
import { test } from "node:test";
import { neonConfig } from "@neondatabase/serverless";
import { questions } from "@/lib/evry/eve/evals/catalog";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  seedLaunchReviewFixture,
  launchReviewTruth,
} from "@/lib/evry/eve/evals/fixtures/launch-review";
import { capturedReadArtifactSchema } from "@/lib/evry/eve/evals/fixtures/host-capture";
import { observationSchema } from "@/lib/evry/eve/evals/contract";

test(
  "launch overview uses task statuses and meaningful future-launch evidence through production tools",
  { skip: process.env.EVRY_EVE_LAUNCH_REVIEW_PROOF !== "1", timeout: 180_000 },
  async () => {
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
            "Launch proof allows only its disposable database proxy"
          );
        }
        return originalFetch(input, init);
      };
      const { createProductionEveEvalAdapter } =
        await import("@/lib/evry/eve/evals/fixtures/adapter");
      const base = createFixtureStore(stack.container);
      let truth: ReturnType<typeof launchReviewTruth> | undefined;
      const store = {
        ...base,
        seed(m: Parameters<typeof base.seed>[0]) {
          base.seed(m);
          seedLaunchReviewFixture(m, base);
          truth = launchReviewTruth(m, base);
        },
      };
      const adapter = createProductionEveEvalAdapter({
        store,
        buildSha: "0".repeat(40),
        async runProduction({ registry, onPresentResult }) {
          assert.ok(truth);
          let ordinal = 0;
          const invoke = async (name: string, input: unknown) => {
            const callId = `launch-proof-${ordinal++}`;
            const output = capturedReadArtifactSchema.parse(
              await registry.invoke(name, input, { callId })
            );
            onPresentResult(callId);
            return output;
          };
          const status = await invoke("launch.query", {
            query: { resource: "status" },
          });
          assert.deepEqual(status.items[0].facts?.slice(0, 2), [
            { label: "Launch date", value: "Oct 11, 2026" },
            { label: "Milestone progress", value: "4 of 9 complete" },
          ]);
          assert.equal(
            status.items[0].facts?.some((f) => f.label === "Attendance"),
            false
          );
          assert.match(
            status.items[0].facts?.find((f) => f.label === "Launch-day results")
              ?.value ?? "",
            /not preparation requirements/
          );
          const all = await invoke("launch.query", {
            query: {
              resource: "milestone_tasks",
              completion: "open",
              limit: 50,
            },
          });
          assert.equal(
            all.counts.matched,
            14,
            "Open milestone alone must not be mistaken for 13 open tasks"
          );
          const open = await invoke("launch.query", {
            query: {
              resource: "milestone_tasks",
              completion: "open",
              taskStatuses: ["not_started", "in_progress", "blocked"],
              limit: 50,
            },
          });
          const taskIds = open.items
            .map((i) => i.facts?.find((f) => f.label === "Task ID")?.value)
            .sort();
          assert.deepEqual(taskIds, truth.openTaskIds);
          assert.equal(open.counts.matched, 13);
          for (const mode of ["list", "count"] as const) {
            const allTasks = await invoke("tasks.query", {
              where: { all: [{ launchMilestone: true }] },
              query: { mode, ...(mode === "list" ? { limit: 50 } : {}) },
            });
            const openTasks = await invoke("tasks.query", {
              where: {
                all: [
                  {
                    launchMilestone: true,
                    status: ["not_started", "in_progress", "blocked"],
                  },
                ],
              },
              query: { mode, ...(mode === "list" ? { limit: 50 } : {}) },
            });
            assert.equal(allTasks.counts.matched, 14);
            assert.equal(openTasks.counts.matched, 13);
            if (mode === "list")
              assert.deepEqual(
                openTasks.items.map((i) => i.id).sort(),
                truth.openTaskIds
              );
          }
          return {
            answer: "Scripted production-tool proof, not a live model answer.",
            clarificationCount: 0,
            costUsd: 0,
            judge: null,
            latency: { acknowledgementMs: 0, firstTextMs: null, totalMs: 0 },
          };
        },
      });
      const scenario = questions.find((q) => q.id === "launch-01");
      assert.ok(scenario);
      const fixture = await adapter.prepare(scenario);
      assert.ok(fixture);
      try {
        const observed = observationSchema.parse(
          await fixture.run({
            scenario,
            signal: AbortSignal.timeout(30_000),
            maxCostUsd: 0.1,
          })
        );
        assert.deepEqual(observed.effects, {
          domainWrites: 0,
          outboundMessages: 0,
        });
        assert.equal(observed.costUsd, 0);
        assert.equal(outboundAttempts, 0);
      } finally {
        await fixture.cleanup();
      }
    } finally {
      globalThis.fetch = originalFetch;
      await stack.cleanup();
    }
  }
);
