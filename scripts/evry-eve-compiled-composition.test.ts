import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { z } from "zod";
import { startFixtureStack } from "../src/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "../src/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "../src/lib/evry/eve/evals/fixtures/manifest";
import { capturedReadArtifactSchema } from "../src/lib/evry/eve/evals/fixtures/host-capture";
import { runCompiledEveFixture } from "../src/lib/evry/eve/evals/http/process";

test(
  "compiled composition queues eight production reads and reauthorizes each dispatch without effects or replay work",
  {
    skip: process.env.EVRY_EVE_COMPOSITION_PROOF !== "1",
    timeout: 180_000,
  },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    const store = createFixtureStore(stack.container);
    const m = createFixtureManifest("compiled-composition-queue", 0);
    try {
      store.seed(m);
      const auditStart = store.auditStart();
      const expectedIds = store
        .query(
          `select id from launch_milestones where church_id='${m.ids.plant}' and completed_at is null order by id`
        )
        .map((row) => z.uuid().parse(row.id));
      assert.deepEqual(expectedIds, [m.ids["milestone-open"]]);
      const outcome = await runCompiledEveFixture(
        {
          compiledEntry: resolve(".output/server/index.mjs"),
          databaseUrl: stack.databaseUrl,
          proxyUrl: stack.proxyUrl,
          sessionToken: m.sessionToken,
          actor: { userId: m.ids.actor, plantId: m.ids.plant },
          turns: ["Read the open launch milestones."],
          now: FIXTURE_NOW.toISOString(),
          maxCostUsd: 1,
          verifyReplay: true,
          prices: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            maxInputBytes: 500_000,
            maxOutputTokens: 1_000,
          },
          model: {
            mode: "scripted",
            responses: [
              {
                toolCalls: [
                  {
                    id: "load-launch",
                    name: "load_tools",
                    input: { names: ["launch.query"] },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "eight-reads",
                    name: "code_mode",
                    input: {
                      js: `return await Promise.allSettled(Array.from({length:8}, () => tools['launch.query']({query:{resource:'milestones', completion:'open', limit:50, offset:0}})));`,
                    },
                  },
                ],
              },
              {
                text: "Secure equipment is still open. Nothing has been changed.",
              },
            ],
          },
        },
        AbortSignal.timeout(150_000)
      );
      assert.equal(outcome.runtimeProof?.modelCalls, 3);
      assert.deepEqual(outcome.runtimeProof?.failures, []);
      const part = outcome.messages
        .flatMap((message) => message.parts)
        .find(
          (item) =>
            item.type === "dynamic-tool" && item.toolCallId === "eight-reads"
        );
      assert.ok(
        part?.type === "dynamic-tool" && part.state === "output-available"
      );
      const result = z
        .object({
          data: z.object({
            status: z.literal("completed"),
            calls: z.literal(8),
            output: z
              .array(
                z.object({ status: z.literal("fulfilled"), value: z.unknown() })
              )
              .length(8),
          }),
        })
        .parse(part.output);
      assert.equal(result.data.output.length, 8);
      assert.equal(outcome.hostCapture.calls.length, 8);
      assert.deepEqual(
        outcome.hostCapture.calls.map((call) => call.id).sort(),
        Array.from({ length: 8 }, (_, i) => `eight-reads:tool-${i + 1}`)
      );
      for (const call of outcome.hostCapture.calls) {
        assert.equal(call.name, "launch.query");
        const artifact = capturedReadArtifactSchema.parse(call.output);
        assert.deepEqual(
          artifact.items.map((item) => item.id).sort(),
          expectedIds
        );
      }
      assert.equal(outcome.hostCapture.freshAuthorizations, 8);
      assert.equal(outcome.hostCapture.refusedAuthorizations, 0);
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.deepEqual(store.writesSince(auditStart, m), []);
      assert.equal(outcome.costUsd, 0);
      assert.ok(
        outcome.replay?.matchingTranscript && outcome.replay.stableActivity
      );
    } finally {
      await stack.cleanup();
    }
  }
);

test(
  "compiled composition returns safe schema feedback and corrects launch input without reloading its direct tool",
  {
    skip: process.env.EVRY_EVE_COMPOSITION_PROOF !== "1",
    timeout: 180_000,
  },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    const store = createFixtureStore(stack.container);
    const m = createFixtureManifest("compiled-composition", 0);
    try {
      store.seed(m);
      const auditStart = store.auditStart();
      const expectedIds = store
        .query(
          `select id from launch_milestones where church_id='${m.ids.plant}' and completed_at is null order by id`
        )
        .map((row) => z.uuid().parse(row.id));
      assert.deepEqual(expectedIds, [m.ids["milestone-open"]]);
      const outcome = await runCompiledEveFixture(
        {
          compiledEntry: resolve(".output/server/index.mjs"),
          databaseUrl: stack.databaseUrl,
          proxyUrl: stack.proxyUrl,
          sessionToken: m.sessionToken,
          actor: { userId: m.ids.actor, plantId: m.ids.plant },
          turns: ["Show my open launch milestones."],
          now: FIXTURE_NOW.toISOString(),
          maxCostUsd: 1,
          verifyReplay: true,
          prices: {
            inputUsdPerMillion: 1,
            outputUsdPerMillion: 2,
            maxInputBytes: 500_000,
            maxOutputTokens: 1_000,
          },
          model: {
            mode: "scripted",
            responses: [
              {
                toolCalls: [
                  {
                    id: "load-launch",
                    name: "load_tools",
                    input: { names: ["launch.query"] },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "replace-with-team",
                    name: "load_tools",
                    input: { mode: "replace", names: ["teams.get_many"] },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "flat-launch",
                    name: "code_mode",
                    input: {
                      js: "const r = await tools['launch.query']({resource:'milestones', completion:'open', limit:50, offset:0}); return r;",
                    },
                  },
                ],
              },
              {
                toolCalls: [
                  {
                    id: "wrapped-launch",
                    name: "code_mode",
                    input: {
                      js: "const r = await tools['launch.query']({query:{resource:'milestones', completion:'open', limit:50, offset:0}}); return r;",
                    },
                  },
                ],
              },
              {
                text: "Secure equipment is still open. Nothing has been changed.",
              },
            ],
          },
        },
        AbortSignal.timeout(150_000)
      );

      assert.equal(outcome.runtimeProof?.modelCalls, 5);
      assert.deepEqual(outcome.runtimeProof?.failures, []);
      const requests = outcome.runtimeProof?.modelRequests;
      assert.ok(requests);
      assert.ok(requests[1].tools.includes("launch_query"));
      for (const request of requests.slice(2)) {
        assert.ok(request.tools.includes("teams_get_many"));
        assert.equal(request.tools.includes("launch_query"), false);
      }
      const failed = outcome.messages
        .flatMap((message) => message.parts)
        .find(
          (part) =>
            part.type === "dynamic-tool" && part.toolCallId === "flat-launch"
        );
      assert.ok(
        failed?.type === "dynamic-tool" && failed.state === "output-available"
      );
      const failure = z
        .object({
          data: z.unknown(),
          presentation: z.object({ results: z.array(z.unknown()) }),
        })
        .parse(failed.output);
      assert.deepEqual(failure.data, {
        status: "failed",
        reason: "invalid_input",
        toolName: "launch.query",
        requiredFields: ["query"],
        calls: 0,
      });
      assert.deepEqual(failure.presentation.results, []);
      assert.equal(
        outcome.hostCapture.calls.length,
        1,
        "Rejected input never reaches a host capability"
      );
      const call = outcome.hostCapture.calls[0];
      assert.equal(call.name, "launch.query");
      assert.ok(call.id.startsWith("wrapped-launch:"));
      const artifact = capturedReadArtifactSchema.parse(call.output);
      assert.deepEqual(
        artifact.items.map((item) => item.id).sort(),
        expectedIds
      );
      assert.equal(outcome.hostCapture.freshAuthorizations, 1);
      assert.equal(outcome.hostCapture.refusedAuthorizations, 0);
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.deepEqual(store.writesSince(auditStart, m), []);
      assert.equal(outcome.costUsd, 0);
      assert.ok(
        outcome.replay?.matchingTranscript && outcome.replay.stableActivity
      );
    } finally {
      await stack.cleanup();
    }
  }
);
