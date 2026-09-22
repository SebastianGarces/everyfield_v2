/** Opt-in corpus review against disposable data and the compiled production agent. */
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { neonConfig } from "@neondatabase/serverless";
import { selectCases } from "@/lib/evry/eve/evals/catalog";
import { gradeObservation } from "@/lib/evry/eve/evals/grade";
import { startFixtureStack } from "@/lib/evry/eve/evals/fixtures/stack";
import { createFixtureStore } from "@/lib/evry/eve/evals/fixtures/store";
import { startDocumentFixtureStorage } from "@/lib/evry/eve/evals/fixtures/document-storage";
import { peopleReviewUpload } from "@/lib/evry/eve/evals/fixtures/content-actions";
import { createCompiledEveEvalRunner } from "@/lib/evry/eve/evals/http/compiled-adapter";
import { withLiveReviewBudget } from "./evry-eve-live-budget";

async function main() {
  const ledger = process.env.EVRY_REVIEW_LEDGER;
  const ids = process.env.EVRY_REVIEW_CASES?.split(",").filter(Boolean);
  if (!ledger || !ids?.length || !process.env.OPENAI_API_KEY)
    throw new Error(
      "Requires approved EVRY_REVIEW_LEDGER, explicit EVRY_REVIEW_CASES and server OpenAI key"
    );
  const catalog = selectCases("full");
  const scenarios = ids.map((id) => {
    const scenario = catalog.find((item) => item.id === id);
    if (!scenario) throw new Error(`Unknown corpus case: ${id}`);
    return scenario;
  });
  const buildSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const sourceDiff = execFileSync("git", ["diff", "--stat"], {
    encoding: "utf8",
  });
  const directory = await mkdtemp(join(tmpdir(), "evry-corpus-review-"));
  console.log(
    JSON.stringify({
      event: "review",
      directory,
      buildSha,
      sourceDiff,
      compiledEntrySha256: createHash("sha256")
        .update(readFileSync(resolve(".output/server/index.mjs")))
        .digest("hex"),
    })
  );
  const stack = await startFixtureStack(process.cwd());
  const previousDatabase = process.env.DATABASE_URL;
  const previousResendKey = process.env.RESEND_API_KEY;
  const previousEndpoint = neonConfig.fetchEndpoint;
  let documentStorage:
    | Awaited<ReturnType<typeof startDocumentFixtureStorage>>
    | undefined;
  const previousStorageEnvironment = new Map<string, string | undefined>();
  try {
    if (
      ids.includes("documents-04") ||
      ids.includes("documents-06") ||
      ids.includes("commitments-03")
    ) {
      documentStorage = await startDocumentFixtureStorage({
        allowNativeUploads: ids.includes("documents-06"),
      });
      for (const [name, value] of Object.entries(documentStorage.environment)) {
        previousStorageEnvironment.set(name, process.env[name]);
        process.env[name] = value;
      }
    }
    process.env.DATABASE_URL = stack.databaseUrl;
    // Preparation imports construct the email client. This fixture never needs
    // a real email credential; outbound messages are blocked by the runner.
    process.env.RESEND_API_KEY = "re_eve_fixture_never_sent";
    neonConfig.fetchEndpoint = stack.proxyUrl;
    const { createProductionEveEvalAdapter } =
      await import("@/lib/evry/eve/evals/fixtures/adapter");
    let currentCase = "";
    const compiled = createCompiledEveEvalRunner({
      compiledEntry: resolve(".output/server/index.mjs"),
      databaseUrl: stack.databaseUrl,
      proxyUrl: stack.proxyUrl,
      // Full 1.05M context reserved at worst standard input/cache-write and output prices.
      prices: {
        inputUsdPerMillion: 0.5,
        outputUsdPerMillion: 1.8,
        maxInputBytes: 1_050_000,
        maxOutputTokens: 4096,
      },
      timeoutMs: 240_000,
      model: () => ({ mode: "live", spendingApproved: true }),
    });
    const adapter = createProductionEveEvalAdapter({
      store: createFixtureStore(stack.container),
      buildSha,
      captureMode: "isolated_http",
      prepareDocumentFiles: documentStorage?.prepareFiles,
      preparePeopleCsv: ids.includes("documents-06")
        ? async (manifest) => peopleReviewUpload(manifest)
        : undefined,
      runProduction: (input) =>
        withLiveReviewBudget(ledger, 1, async () => {
          const outcome = await compiled({ ...input, maxCostUsd: 1 });
          await writeFile(
            join(directory, `${currentCase}.runtime.json`),
            JSON.stringify(outcome, null, 2),
            { mode: 0o600 }
          );
          return { result: outcome, costUsd: outcome.costUsd };
        }),
    });
    for (const [index, scenario] of scenarios.entries()) {
      currentCase = `${index}-${scenario.id}`;
      const fixture = await adapter.prepare(scenario);
      if (!fixture) {
        console.log(
          JSON.stringify({
            id: scenario.id,
            status: "blocked",
            reason: "fixture_not_bound",
          })
        );
        continue;
      }
      try {
        const observation = await fixture.run({
          scenario,
          signal: AbortSignal.timeout(260_000),
          maxCostUsd: 1,
        });
        const result = gradeObservation(
          scenario.id,
          fixture.expectations,
          observation
        );
        await writeFile(
          join(directory, `${currentCase}.json`),
          JSON.stringify(
            { scenario, expectations: fixture.expectations, result },
            null,
            2
          ),
          { mode: 0o600 }
        );
        console.log(
          JSON.stringify({
            id: scenario.id,
            status: result.status,
            failures: result.failures,
            costUsd: result.observation?.costUsd,
            latency: result.observation?.latency,
          })
        );
      } finally {
        await fixture.cleanup();
      }
    }
  } finally {
    neonConfig.fetchEndpoint = previousEndpoint;
    if (previousDatabase === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousDatabase;
    if (previousResendKey === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = previousResendKey;
    try {
      await documentStorage?.cleanup();
    } finally {
      for (const [name, value] of previousStorageEnvironment) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await stack.cleanup();
    }
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
