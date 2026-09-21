import assert from "node:assert/strict";
import { test } from "node:test";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";

test(
  "compiled small-context production agent retains failed compaction and permits explicit Retry",
  { skip: !process.env.EVRY_COMPACTION_FIXTURE_ENTRY, timeout: 360_000 },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    try {
      const store = createFixtureStore(stack.container);
      for (const kind of ["provider", "budget"] as const)
        for (const retry of [false, true]) {
          const manifest = createFixtureManifest(
            `compaction-${kind}-${retry}`,
            0
          );
          store.seed(manifest);
          const prompt =
            "Review the recorded information and remember this request for a retry.";
          const warm = Array.from({ length: 12 }, (_, index) => ({
            text: "The recorded information remains available for review. ".repeat(
              100
            ),
            toolCalls: [
              {
                id: `review-${index}`,
                name: "load_tools",
                input: { names: [] },
              },
            ],
            usage: {
              inputTokens: 2000 + index * 1000,
              outputTokens: kind === "budget" ? 4000 : 1000,
            },
          }));
          const summaries =
            kind === "provider"
              ? [
                  {
                    text: "Summary failed.",
                    failGenerate: true,
                    usage: { inputTokens: 14000, outputTokens: 1 },
                  },
                ]
              : Array.from({ length: 2 }, () => ({
                  text: "Supported fact. ".repeat(1900),
                  usage: { inputTokens: 14000, outputTokens: 8000 },
                }));
          const failure =
            kind === "provider"
              ? "EVRY_SCRIPTED_COMPACTION_FAILURE"
              : "EVRY_PROCESSING_LIMIT_REACHED";
          const result = await runCompiledEveFixture(
            {
              compiledEntry: process.env.EVRY_COMPACTION_FIXTURE_ENTRY!,
              databaseUrl: stack.databaseUrl,
              proxyUrl: stack.proxyUrl,
              sessionToken: manifest.sessionToken,
              actor: {
                userId: manifest.ids.actor,
                plantId: manifest.ids.plant,
              },
              turns: retry
                ? [prompt, "Please try my last request again."]
                : [prompt],
              now: FIXTURE_NOW.toISOString(),
              maxCostUsd: 100,
              prices: {
                inputUsdPerMillion: 1,
                outputUsdPerMillion: 2,
                maxInputBytes: 1_000_000,
                maxOutputTokens: 8000,
              },
              verifyReplay: true,
              verifyRestart: true,
              verifyProcessingState: true,
              expectedTurnFailureMessage: failure,
              model: {
                mode: "scripted",
                responses: [
                  ...warm,
                  ...summaries,
                  {
                    text: "The original request was: " + prompt,
                    usage: { inputTokens: 14000, outputTokens: 50 },
                  },
                  {
                    text: "Retry completed with the original request retained.",
                    usage: { inputTokens: 5000, outputTokens: 50 },
                  },
                ],
              },
            },
            AbortSignal.timeout(180_000)
          );
          process.stdout.write(
            JSON.stringify({
              kind,
              retry,
              calls: result.runtimeProof?.modelCalls,
              failures: result.runtimeProof?.failures,
              snapshots: result.processingSnapshots,
            }) + "\n"
          );
          assert.deepEqual(result.runtimeProof?.failures, [
            `COMPACTION_FAILED:${failure}`,
          ]);
          assert.equal(result.hostCapture.outboundMessages, 0);
          assert.equal(result.hostCapture.calls.length, 0);
          assert.equal(result.replay?.stableActivity, true);
          assert.equal(result.replay?.stableCapture, true);
          assert.equal(result.restart?.matchingTranscript, true);
          assert.equal(result.restart?.modelCalls, 0);
          assert.equal(result.restart?.capturedCalls, 0);
          assert.equal(result.restart?.outboundMessages, 0);
          assert.ok(
            result.messages.some((message) =>
              JSON.stringify(message).includes(prompt)
            )
          );
          const stoppedCalls = kind === "provider" ? 13 : 14;
          assert.equal(
            result.runtimeProof?.modelCalls,
            stoppedCalls + (retry ? 2 : 0)
          );
          if (retry) {
            assert.match(result.answer, /Retry completed/);
            assert.equal(
              result.runtimeProof?.modelRequests?.[stoppedCalls]
                ?.retainedOriginalRequest,
              true
            );
          }
          if (kind === "budget")
            assert.ok(
              result.processingSnapshots?.some(
                (state) =>
                  state.turnId === "turn_0" &&
                  state.outputTokens === 64000 &&
                  state.modelCalls === 14
              )
            );
        }
    } finally {
      await stack.cleanup();
    }
  }
);
