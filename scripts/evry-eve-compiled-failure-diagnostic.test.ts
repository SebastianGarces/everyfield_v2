import assert from "node:assert/strict";
import { resolve } from "node:path";
import { test } from "node:test";
import { startFixtureStack } from "../src/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "../src/lib/evry/eve/evals/fixtures/store";
import { createFixtureManifest } from "../src/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "../src/lib/evry/eve/evals/http/process";
import { fixtureFailureDiagnosticSchema } from "../src/lib/evry/eve/evals/http/failure-diagnostic";

test(
  "compiled timeout returns strict metadata through failed worker IPC without private inputs",
  {
    skip: process.env.EVRY_EVE_FAILURE_DIAGNOSTIC_PROOF !== "1",
    timeout: 120_000,
  },
  async () => {
    const stack = await startFixtureStack(
      process.env.EVRY_FIXTURE_MIGRATIONS_ROOT ?? process.cwd()
    );
    const store = createFixtureStore(stack.container);
    const manifest = createFixtureManifest("compiled-failure-diagnostic", 0);
    const privatePrompt = "private-diagnostic-prompt-do-not-export";
    try {
      store.seed(manifest);
      const audit = store.auditStart();
      await assert.rejects(
        runCompiledEveFixture(
          {
            compiledEntry: resolve(
              process.env.EVRY_COMPILED_ENTRY ?? ".output/server/index.mjs"
            ),
            databaseUrl: stack.databaseUrl,
            proxyUrl: stack.proxyUrl,
            sessionToken: manifest.sessionToken,
            actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
            turns: [privatePrompt],
            now: manifest.now,
            maxCostUsd: 1,
            // Starts inside the runner after compiled server startup. No model
            // delay hook or provider is needed to force this boundary.
            timeoutMs: 1,
            prices: {
              inputUsdPerMillion: 1,
              outputUsdPerMillion: 2,
              maxInputBytes: 500_000,
              maxOutputTokens: 1_000,
            },
            model: {
              mode: "scripted",
              responses: [{ text: "private-diagnostic-output-do-not-export" }],
            },
          },
          AbortSignal.timeout(90_000)
        ),
        (error) => {
          assert.ok(error instanceof Error);
          assert.match(
            error.message,
            /^Compiled HTTP evaluation failed during /
          );
          const marker = "; diagnostic=";
          const offset = error.message.indexOf(marker);
          assert.ok(
            offset >= 0,
            "the worker must return diagnostic evidence, not only exit"
          );
          const diagnostic = fixtureFailureDiagnosticSchema.parse(
            JSON.parse(error.message.slice(offset + marker.length))
          );
          assert.equal(diagnostic.stop, "timeout");
          assert.ok(diagnostic.elapsedMs >= 1);
          assert.equal(diagnostic.generations, 0);
          assert.equal(diagnostic.capturedCalls, 0);
          assert.equal(diagnostic.outboundMessages, 0);
          assert.equal(diagnostic.costUsd, 0);
          assert.equal(diagnostic.costBasis, "provider_usage");
          assert.deepEqual(diagnostic.lastCalls, []);
          assert.deepEqual(diagnostic.lastGenerations, []);
          for (const privateValue of [
            privatePrompt,
            manifest.sessionToken,
            manifest.ids.actor,
            manifest.ids.plant,
            "private-diagnostic-output-do-not-export",
          ])
            assert.ok(!error.message.includes(privateValue));
          assert.doesNotMatch(
            error.message,
            /Failed query:|params:|stack|toolResults|prompt/
          );
          return true;
        }
      );
      assert.deepEqual(store.writesSince(audit, manifest), []);
    } finally {
      await stack.cleanup();
    }
  }
);
