import assert from "node:assert/strict";
import { test } from "node:test";
import { resolve } from "node:path";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";
import { EVE_PROCESSING_LIMIT_SENTINEL } from "@/lib/evry/eve/runtime/processing-budget-policy";

test(
  "compiled production processing guard persists across model steps, parks safely, and only a new retry turn resets it",
  {
    skip: process.env.EVRY_EVE_HTTP_PROOF !== "1",
    timeout: 240_000,
  },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    try {
      const store = createFixtureStore(stack.container);
      for (const limit of ["calls", "input"] as const) {
        for (const retry of [false, true]) {
          process.stdout.write(
            `Processing guard proof: ${limit}, retry=${retry}\n`
          );
          const manifest = createFixtureManifest(
            `processing-${limit}-${retry}`,
            0
          );
          store.seed(manifest);
          const calls = limit === "calls" ? 24 : 20;
          const outcome = await runCompiledEveFixture(
            {
              compiledEntry: resolve(".output/server/index.mjs"),
              databaseUrl: stack.databaseUrl,
              proxyUrl: stack.proxyUrl,
              sessionToken: manifest.sessionToken,
              actor: {
                userId: manifest.ids.actor,
                plantId: manifest.ids.plant,
              },
              turns: retry
                ? ["Investigate", "Please try my last request again."]
                : ["Investigate"],
              now: FIXTURE_NOW.toISOString(),
              maxCostUsd: 100, // Scripted accounting only; provider network is disabled.
              prices: {
                inputUsdPerMillion: 1,
                outputUsdPerMillion: 2,
                maxInputBytes: 2_100_000,
                maxOutputTokens: 1000,
              },
              verifyReplay: true,
              verifyProcessingState: true,
              expectedTurnFailureMessage: EVE_PROCESSING_LIMIT_SENTINEL,
              model: {
                mode: "scripted",
                responses: [
                  ...Array.from({ length: calls }, (_, index) => ({
                    toolCalls: [
                      {
                        id: `bounded-${index}`,
                        name: "load_tools",
                        input: { names: [] },
                      },
                    ],
                    usage: {
                      inputTokens: limit === "input" ? 100_000 : 1,
                      outputTokens: 1,
                    },
                  })),
                  { text: "The new request has a fresh allowance." },
                ],
              },
            },
            AbortSignal.timeout(180_000)
          );
          assert.equal(outcome.runtimeProof?.modelCalls, calls + Number(retry));
          assert.deepEqual(outcome.runtimeProof?.failures, [
            `EVENT_HANDLER_FAILED:${EVE_PROCESSING_LIMIT_SENTINEL}`,
          ]);
          assert.ok(outcome.runtimeProof?.eventTypes.includes("turn.failed"));
          assert.equal(outcome.hostCapture.outboundMessages, 0);
          assert.ok(
            outcome.processingSnapshots?.some(
              (snapshot) =>
                snapshot.modelCalls === calls &&
                snapshot.inputTokens === (limit === "input" ? 2_000_000 : calls)
            ),
            "native serialized checkpoint must retain the exhausted allowance"
          );
          assert.equal(outcome.replay?.stableActivity, true);
          assert.equal(outcome.replay?.stableCapture, true);
          assert.equal(
            outcome.replay?.generationsBefore,
            outcome.replay?.generationsAfter
          );
          assert.equal(
            outcome.replay?.invocationsBefore,
            outcome.replay?.invocationsAfter
          );
          if (retry) assert.match(outcome.answer, /fresh allowance/);
          else assert.doesNotMatch(outcome.answer, /fresh allowance/);
        }
      }
    } finally {
      await stack.cleanup();
    }
  }
);

test(
  "compiled stream failure retains its call reservation without finish and replay cannot spend it again",
  {
    skip: process.env.EVRY_EVE_HTTP_PROOF !== "1",
    timeout: 180_000,
  },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    try {
      const store = createFixtureStore(stack.container);
      for (const retry of [false, true]) {
        const manifest = createFixtureManifest(
          `stream-failure-budget-${retry}`,
          0
        );
        store.seed(manifest);
        const outcome = await runCompiledEveFixture(
          {
            compiledEntry: resolve(".output/server/index.mjs"),
            databaseUrl: stack.databaseUrl,
            proxyUrl: stack.proxyUrl,
            sessionToken: manifest.sessionToken,
            actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
            turns: retry
              ? ["Investigate", "Please try my last request again."]
              : ["Investigate"],
            now: FIXTURE_NOW.toISOString(),
            maxCostUsd: 5,
            prices: {
              inputUsdPerMillion: 1,
              outputUsdPerMillion: 2,
              maxInputBytes: 500_000,
              maxOutputTokens: 1000,
            },
            expectedTurnFailureMessage: "EVRY_SCRIPTED_STREAM_FAILURE",
            verifyReplay: true,
            verifyRestart: true,
            verifyProcessingState: true,
            model: {
              mode: "scripted",
              responses: [
                { text: "A partial answer.", failStream: true },
                { text: "Retry completed." },
              ],
            },
          },
          AbortSignal.timeout(120_000)
        );
        assert.equal(outcome.runtimeProof?.modelCalls, 1 + Number(retry));
        assert.deepEqual(outcome.runtimeProof?.failures, [
          "MODEL_CALL_FAILED:EVRY_SCRIPTED_STREAM_FAILURE",
        ]);
        assert.ok(
          outcome.processingSnapshots?.some(
            (snapshot) =>
              snapshot.turnId === "turn_0" &&
              snapshot.modelCalls === 1 &&
              snapshot.inputTokens === 0 &&
              snapshot.outputTokens === 0
          ),
          "failed stream reservation must survive in a native turnStep checkpoint"
        );
        assert.equal(outcome.restart?.matchingTranscript, true);
        assert.equal(outcome.restart?.modelCalls, 0);
        assert.equal(outcome.restart?.generations, 0);
        assert.equal(outcome.restart?.outboundMessages, 0);
        assert.equal(outcome.replay?.stableActivity, true);
        assert.equal(outcome.replay?.stableCapture, true);
        if (retry) assert.match(outcome.answer, /Retry completed/);
      }
    } finally {
      await stack.cleanup();
    }
  }
);
