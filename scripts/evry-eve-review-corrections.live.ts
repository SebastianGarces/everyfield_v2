/** Explicitly opt-in, isolated review. Never sends email or touches shared data. */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { projectEveMessage } from "@/components/evry/eve-message-projection";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import {
  createFixtureManifest,
  FIXTURE_NOW,
} from "@/lib/evry/eve/evals/fixtures/manifest";
import { runCompiledEveFixture } from "@/lib/evry/eve/evals/http/process";
import { withLiveReviewBudget } from "./evry-eve-live-budget";
import {
  seedLaunchReviewFixture,
  launchReviewTruth,
} from "@/lib/evry/eve/evals/fixtures/launch-review";

async function review(allowance: number) {
  if (!Number.isFinite(allowance) || allowance <= 0 || allowance > 1)
    throw new Error(
      "Requires an explicitly approved remaining allowance of at most $1"
    );
  const selectedCase = process.env.EVRY_REVIEW_CASE;
  if (
    selectedCase &&
    selectedCase !== "orientation" &&
    selectedCase !== "launch"
  )
    throw new Error("Unknown review case");
  if (!process.env.OPENAI_API_KEY)
    throw new Error("Missing server-side OpenAI key");
  // Verified 2026-09-21: https://developers.openai.com/api/docs/models/gpt-5.6-luna
  // Reserve the ENTIRE 1.05M-token context, not a prompt-byte estimate, at the
  // most expensive standard-context input/cache-write price ($0.50/M). Output
  // uses the long-context rate ($1.80/M). Fixture middleware forces standard tier.
  // Settlement also uses these conservative prices, ignoring cache discounts.
  const prices = {
    inputUsdPerMillion: 0.5,
    outputUsdPerMillion: 1.8,
    maxInputBytes: 1_050_000,
    maxOutputTokens: 4096,
  };
  let remaining = allowance;
  const stack = await startFixtureStack(process.cwd());
  const store = createFixtureStore(stack.container);
  try {
    for (const name of ["orientation", "launch"] as const) {
      if (selectedCase && selectedCase !== name) continue;
      const manifest = createFixtureManifest(`review-corrections-${name}`, 0);
      const i = manifest.ids;
      store.seed(manifest);
      store.sql(
        `update locations set name='Evry Community Center', address='100 Example Lane, Albany, NY 12207' where id='${i["church-location"]}';`
      );
      seedLaunchReviewFixture(manifest, store);
      const truth = launchReviewTruth(manifest, store);
      const before = store.auditStart();
      const ceiling =
        ((prices.maxInputBytes + 4096) * prices.inputUsdPerMillion +
          prices.maxOutputTokens * prices.outputUsdPerMillion) /
        1_000_000;
      if (remaining < ceiling) {
        console.log(JSON.stringify({ event: "budget-stop", name, remaining }));
        break;
      }
      const allocation = remaining;
      // Print before dispatch. If the child exits without usage evidence, stop
      // the whole review and retain its entire allocation, never retry for free.
      console.log(
        JSON.stringify({
          event: "allocate",
          name,
          allocation,
          prices,
          compiledEntrySha256: createHash("sha256")
            .update(readFileSync(resolve(".output/server/index.mjs")))
            .digest("hex"),
        })
      );
      let outcome: Awaited<ReturnType<typeof runCompiledEveFixture>>;
      try {
        outcome = await runCompiledEveFixture(
          {
            compiledEntry: resolve(".output/server/index.mjs"),
            databaseUrl: stack.databaseUrl,
            proxyUrl: stack.proxyUrl,
            sessionToken: manifest.sessionToken,
            actor: { userId: i.actor, plantId: i.plant },
            now: FIXTURE_NOW.toISOString(),
            turns:
              name === "orientation"
                ? [
                    "Can you create an orientation meeting for the core team members next Sunday at 10am at the church location and send out the invites?",
                    "Two hours. Yes, use Evry Community Center and the saved orientation invitation template.",
                  ]
                : ["Can you let me know where we are on launch?"],
            maxCostUsd: allocation,
            prices,
            timeoutMs: 240_000,
            model: { mode: "live", spendingApproved: true },
            verifyReplay: true,
          },
          AbortSignal.timeout(260_000)
        );
      } catch (error) {
        remaining = 0;
        console.log(
          JSON.stringify({
            event: "unsettled-stop",
            name,
            reservedUsd: allocation,
          })
        );
        throw error;
      }
      remaining -= outcome.costUsd;
      const visible = outcome.messages
        .filter((m) => m.role === "assistant")
        .flatMap(projectEveMessage);
      console.log(
        JSON.stringify({
          event: "result",
          name,
          remaining,
          costCeilingUsd: outcome.costUsd,
          basis: outcome.hostCapture.costBasis,
          modelCalls: outcome.hostCapture.modelCalls,
          latency: outcome.latency,
          visible,
          questions: outcome.messages.flatMap((message) =>
            message.parts.flatMap((part) =>
              part.type === "dynamic-tool" && part.toolName === "ask_question"
                ? [
                    {
                      input: part.input,
                      metadata: part.toolMetadata?.eve,
                    },
                  ]
                : []
            )
          ),
          calls: outcome.hostCapture.calls,
          failures: outcome.runtimeProof?.failures,
          truth,
          replay: outcome.replay,
        })
      );
      assert.equal(
        visible.some((p) => p.kind === "session-limit"),
        false,
        `${name} hit the cumulative session limit`
      );
      assert.equal(outcome.hostCapture.outboundMessages, 0);
      assert.equal(
        store.writesSince(before, manifest).length,
        0,
        "Unconfirmed domain writes"
      );
      assert.ok(remaining >= 0);
      if (name === "orientation") {
        const reviews = visible.filter(
          (p) => p.kind === "artifact" && p.artifact.kind === "confirmation"
        );
        assert.equal(
          reviews.length,
          1,
          "Expected one orientation review after two user turns"
        );
        const plans = store.query(
          `select s.status from evry_action_plan_states s where s.church_id='${i.plant}'`
        );
        assert.deepEqual(plans, [{ status: "awaiting_confirmation" }]);
      }
    }
    console.log(
      JSON.stringify({
        event: "finished",
        chargedUpperEstimateUsd: allowance - remaining,
        remaining,
      })
    );
    return { result: undefined, costUsd: allowance - remaining };
  } finally {
    await stack.cleanup();
  }
}
async function main() {
  const ledger = process.env.EVRY_REVIEW_LEDGER;
  if (!ledger)
    throw new Error("An existing approved EVRY_REVIEW_LEDGER is required");
  const allowance = Number(process.env.EVRY_APPROVED_REVIEW_USD);
  return withLiveReviewBudget(ledger, allowance, () => review(allowance));
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
