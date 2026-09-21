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
import { projectEveMessage } from "@/components/evry/eve-message-projection";

test(
  "compiled usage limit pauses visibly and resumes only with an explicit continuation",
  { skip: process.env.EVRY_EVE_HTTP_PROOF !== "1", timeout: 900_000 },
  async () => {
    const stack = await startFixtureStack(process.cwd());
    try {
      const store = createFixtureStore(stack.container);
      for (const decision of [null, "continue", "stop"] as const) {
        process.stdout.write(`Lifetime guard proof: ${decision}\n`);
        const manifest = createFixtureManifest(`usage-limit-${decision}`, 0);
        store.seed(manifest);
        const primeTurns = Array.from(
          { length: 80 },
          (_, index) => `Recorded context turn ${index + 1}`
        );
        const outcome = await runCompiledEveFixture(
          {
            compiledEntry: resolve(".output/server/index.mjs"),
            databaseUrl: stack.databaseUrl,
            proxyUrl: stack.proxyUrl,
            sessionToken: manifest.sessionToken,
            actor: { userId: manifest.ids.actor, plantId: manifest.ids.plant },
            turns: decision
              ? [...primeTurns, "Show my tasks", { optionId: decision }]
              : [...primeTurns, "Show my tasks"],
            now: FIXTURE_NOW.toISOString(),
            maxCostUsd: 100, // Scripted usage only; this test never permits paid calls.
            prices: {
              inputUsdPerMillion: 1,
              outputUsdPerMillion: 2,
              maxInputBytes: 500_000,
              maxOutputTokens: 1000,
            },
            timeoutMs: 280_000,
            model: {
              mode: "scripted",
              responses: [
                ...primeTurns.map(() => ({
                  text: "Recorded context checked.",
                  usage: { inputTokens: 500_000, outputTokens: 1 },
                })),
                { text: "Processing resumed after your approval." },
              ],
            },
          },
          AbortSignal.timeout(280_000)
        );
        assert.equal(
          outcome.runtimeProof?.modelCalls,
          decision === "continue" ? 81 : 80
        );
        assert.equal(outcome.hostCapture.outboundMessages, 0);
        if (decision === "continue")
          assert.match(outcome.answer, /resumed after your approval/);
        else if (decision === "stop") {
          const visible = outcome.messages.flatMap(projectEveMessage);
          assert.ok(
            visible.some(
              (part) =>
                part.kind === "text" &&
                part.text.includes("You chose to stop here")
            )
          );
          assert.ok(!visible.some((part) => part.kind === "session-limit"));
        } else {
          // Fixture transcripts preserve the native Eve message parts at this boundary.
          assert.ok(
            outcome.messages
              .flatMap(projectEveMessage)
              .some((part) => part.kind === "session-limit")
          );
        }
      }
    } finally {
      await stack.cleanup();
    }
  }
);
