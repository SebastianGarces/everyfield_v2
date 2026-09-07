import assert from "node:assert/strict";
import { wrapLanguageModel } from "ai";
import { z } from "zod";
import { generateEvryModelTurn } from "@/lib/evry/capabilities/model-turn";
import { PRODUCTION_EVRY_MODEL_READS } from "@/lib/evry/capabilities/production";
import {
  getEvryPolicyModel,
  EVRY_POLICY_MODEL_ID,
} from "@/lib/evry/models/provider";
import {
  calculateEvryModelCostUsd,
  evryModelCandidate,
} from "@/lib/evry/models/candidates";

// Opt-in live proof. No application reads, plans, messages or effects are executed.
// node --import tsx --env-file=.env.local scripts/evry-conversation-model-smoke.ts --live
async function main() {
  assert.ok(
    process.argv.includes("--live"),
    "Pass --live to allow three paid model calls."
  );
  const candidate = evryModelCandidate(EVRY_POLICY_MODEL_ID);
  assert.ok(candidate);
  const provider = getEvryPolicyModel();
  assert.ok(
    typeof provider !== "string" && provider.specificationVersion === "v3"
  );
  const budgetUsd = 0.05;
  let reservedUsd = 0;
  let estimatedActualUsd = 0;
  let calls = 0;
  const model = wrapLanguageModel({
    model: provider,
    middleware: {
      specificationVersion: "v3",
      async wrapGenerate({ doGenerate, params }) {
        assert.equal(params.providerOptions?.openai?.store, false);
        assert.equal(params.tools?.length ?? 0, 0);
        assert.ok(++calls <= 3, "No extra paid retries");
        // UTF-8 bytes plus overhead conservatively bound input tokens; ignore caching.
        const ceiling =
          ((Buffer.byteLength(JSON.stringify(params)) + 4096) *
            candidate.pricePerMillionTokens.input +
            1500 * candidate.pricePerMillionTokens.output) /
          1_000_000;
        assert.ok(
          reservedUsd + ceiling <= budgetUsd,
          "Live smoke cost ceiling exceeded"
        );
        reservedUsd += ceiling;
        const result = await doGenerate();
        const input = result.usage.inputTokens;
        const output = result.usage.outputTokens;
        assert.ok(
          input.total !== undefined && output.total !== undefined,
          "Provider must report usage"
        );
        const costUsd = calculateEvryModelCostUsd({
          candidate,
          inputUncachedTokens:
            input.noCache ?? input.total - (input.cacheRead ?? 0),
          inputCacheReadTokens: input.cacheRead ?? 0,
          inputCacheWriteTokens: input.cacheWrite ?? 0,
          outputTokens: output.total,
        });
        estimatedActualUsd += costUsd;
        console.log(
          JSON.stringify({
            call: calls,
            inputTokens: input.total,
            outputTokens: output.total,
            costUsd,
          })
        );
        return result;
      },
    },
  });
  const reads = PRODUCTION_EVRY_MODEL_READS.map(({ id, inputSchema }) => ({
    id,
    schema: z.toJSONSchema(inputSchema, { unrepresentable: "any" }),
  }));
  const cases = [
    { request: "what can you do for me?", expected: "reply" },
    {
      request: "please give me a list of people that need follow up",
      expected: "read",
    },
    {
      request: "Show people needing follow-up and write a sermon about grace",
      expected: "reply",
    },
  ] as const;
  for (const sample of cases) {
    const started = performance.now();
    const decision = await generateEvryModelTurn(
      {
        reads,
        context: {
          latestRequest: sample.request,
          conversation: null,
          pageContext: null,
          originalRequestCanBePrepared: false,
        },
      },
      () => model
    );
    assert.equal(decision.kind, sample.expected, sample.request);
    if (decision.kind === "read") {
      assert.equal(decision.id, "tasks.follow-up-ownership");
      assert.deepEqual(decision.input, { section: "contacts", cursor: null });
    }
    console.log(
      JSON.stringify({
        request: sample.request,
        decision,
        latencyMs: Math.round(performance.now() - started),
      })
    );
  }
  console.log(
    JSON.stringify({
      status: "passed",
      calls,
      estimatedActualUsd,
      reservedUsd,
      budgetUsd,
      pricing: "repository benchmark rates, not a provider invoice",
    })
  );
}

main().catch((error: unknown) => {
  // Do not print provider errors, headers or environment values.
  console.error(
    error instanceof assert.AssertionError
      ? error.message
      : "Live model smoke failed; no automatic retry."
  );
  process.exitCode = 1;
});
