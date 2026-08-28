#!/usr/bin/env tsx

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evryBenchmarkCallBudgets,
  evryModelBenchmarkMarkdown,
  runEvryModelBenchmark,
} from "@/lib/evry/evals/benchmark";
import {
  assertEvryAbsoluteSafetyGates,
  type EvryEvalProof,
  type EvryEvalProofResult,
} from "@/lib/evry/evals/contracts";
import {
  assertEvryEvalProofResults,
  evryEvalProofResult,
  evrySafetyGateResults,
} from "@/lib/evry/evals/proofs";
import {
  assertEvryEvalRegistryComplete,
  EVRY_EVAL_PROOFS,
} from "@/lib/evry/evals/registry";
import { EVRY_POLICY_EVAL_FIXTURES } from "@/lib/evry/evals/policy/fixtures";
import { EVRY_MODEL_CANDIDATES } from "@/lib/evry/models/candidates";
import { EVRY_POLICY_MODEL_ID } from "@/lib/evry/models/provider";

const LIVE_DATABASE_ENVIRONMENT = Object.freeze({
  LIVE_DB_NETWORK: "everyfield-evry-benchmark",
  LIVE_DB_PG_CONTAINER: "everyfield-evry-benchmark-pg",
  LIVE_DB_PROXY_CONTAINER: "everyfield-evry-benchmark-proxy",
  LIVE_DB_PG_PORT: "55433",
  LIVE_DB_PROXY_PORT: "4445",
});

type CliOptions = Readonly<{
  live: boolean;
  proofsOnly: boolean;
  maximumCostUsd: number | null;
  outputDirectory: string;
}>;

function parseCli(argv: readonly string[]): CliOptions {
  let live = false;
  let proofsOnly = false;
  let maximumCostUsd: number | null = null;
  let outputDirectory = path.resolve(".lavish", "evry-model-benchmark");

  for (const argument of argv) {
    if (argument === "--") continue;
    if (argument === "--live") {
      live = true;
      continue;
    }
    if (argument === "--proofs-only") {
      proofsOnly = true;
      continue;
    }
    if (argument.startsWith("--max-cost-usd=")) {
      maximumCostUsd = Number(argument.slice("--max-cost-usd=".length));
      continue;
    }
    if (argument.startsWith("--output-dir=")) {
      outputDirectory = path.resolve(argument.slice("--output-dir=".length));
      continue;
    }
    throw new Error(`Unknown benchmark argument: ${argument}`);
  }

  if (!live && !proofsOnly) {
    throw new Error(
      "Pass --proofs-only, or opt into provider access with --live and --max-cost-usd=<amount>"
    );
  }
  if (live && (maximumCostUsd === null || maximumCostUsd <= 0)) {
    throw new Error("--max-cost-usd must be a positive finite amount");
  }
  if (maximumCostUsd !== null && !Number.isFinite(maximumCostUsd)) {
    throw new Error("--max-cost-usd must be a positive finite amount");
  }
  return Object.freeze({
    live,
    proofsOnly,
    maximumCostUsd,
    outputDirectory,
  });
}

function parseLocalLangfuseEnvironment(contents: string): Readonly<{
  baseUrl: string;
  publicKey: string;
  secretKey: string;
}> {
  const values = new Map<string, string>();
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator < 1) throw new Error("Invalid local Langfuse environment");
    values.set(line.slice(0, separator), line.slice(separator + 1));
  }
  const port = values.get("LANGFUSE_WEB_HOST_PORT") ?? "";
  const publicKey = values.get("LANGFUSE_INIT_PROJECT_PUBLIC_KEY") ?? "";
  const secretKey = values.get("LANGFUSE_INIT_PROJECT_SECRET_KEY") ?? "";
  if (!/^\d{4,5}$/.test(port)) throw new Error("Invalid Langfuse port");
  if (!/^pk-lf-[a-z0-9]+$/i.test(publicKey)) {
    throw new Error("Invalid Langfuse public key");
  }
  if (!/^sk-lf-[a-z0-9]+$/i.test(secretKey)) {
    throw new Error("Invalid Langfuse secret key");
  }
  return Object.freeze({
    baseUrl: `http://127.0.0.1:${port}`,
    publicKey,
    secretKey,
  });
}

function mainCheckout(): string {
  const commonDirectory = execFileSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8" }
  ).trim();
  return path.dirname(commonDirectory);
}

async function configureAndCheckLangfuse(): Promise<void> {
  const environmentPath = path.join(mainCheckout(), "ops", "langfuse", ".env");
  const config = parseLocalLangfuseEnvironment(
    readFileSync(environmentPath, "utf8")
  );
  const response = await fetch(
    `${config.baseUrl}/api/public/health?failIfDatabaseUnavailable=true`,
    { signal: AbortSignal.timeout(10_000) }
  );
  if (!response.ok) throw new Error("Local Langfuse is not healthy");

  process.env.LANGFUSE_BASE_URL = config.baseUrl;
  process.env.LANGFUSE_PUBLIC_KEY = config.publicKey;
  process.env.LANGFUSE_SECRET_KEY = config.secretKey;
  process.env.LANGFUSE_TRACING_ENVIRONMENT = "local-eval";
}

function runProof(
  proof: EvryEvalProof,
  environment: NodeJS.ProcessEnv
): EvryEvalProofResult {
  const imports =
    proof.lane === "live_database"
      ? ["--import", "./scripts/live-db-endpoint.ts"]
      : [];
  const result = spawnSync(
    process.execPath,
    [
      "--no-warnings",
      "--experimental-test-module-mocks",
      "--import",
      "tsx",
      ...imports,
      "--test",
      "--test-reporter=tap",
      proof.testFile,
    ],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      env: environment,
      timeout: 180_000,
    }
  );
  if (result.error) throw result.error;
  let proofResult: EvryEvalProofResult;
  try {
    proofResult = evryEvalProofResult({
      proof,
      exitCode: result.status,
      output: result.stdout,
    });
  } catch (error) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
    throw error;
  }
  process.stdout.write(
    `Proof ${proof.id}: ${proofResult.passed ? "pass" : "FAIL"} (${proofResult.tests} tests, ${proofResult.skipped} skipped)\n`
  );
  if (!proofResult.passed) {
    process.stderr.write(result.stdout);
    process.stderr.write(result.stderr);
  }
  return proofResult;
}

function runLiveStack(
  action: "up" | "down",
  environment: NodeJS.ProcessEnv
): void {
  const result = spawnSync("./scripts/live-db-stack.sh", [action], {
    cwd: process.cwd(),
    stdio: "inherit",
    env: environment,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Evry benchmark live database stack ${action} failed`);
  }
}

function runExecutableReleaseGates(): readonly EvryEvalProofResult[] {
  assertEvryEvalRegistryComplete();
  const deterministic = EVRY_EVAL_PROOFS.filter(
    ({ lane }) => lane === "deterministic"
  ).map((proof) => runProof(proof, process.env));
  const stackEnvironment = {
    ...process.env,
    ...LIVE_DATABASE_ENVIRONMENT,
  };
  const liveEnvironment = {
    ...stackEnvironment,
    LIVE_DB_TESTS: "1",
    NEON_HTTP_PROXY_URL: `http://localhost:${LIVE_DATABASE_ENVIRONMENT.LIVE_DB_PROXY_PORT}/sql`,
    DATABASE_URL: `postgresql://postgres:postgres@localhost:${LIVE_DATABASE_ENVIRONMENT.LIVE_DB_PG_PORT}/main`,
    RESEND_API_KEY: "re_ci_placeholder",
  };
  const live: EvryEvalProofResult[] = [];
  runLiveStack("up", stackEnvironment);
  try {
    for (const proof of EVRY_EVAL_PROOFS.filter(
      ({ lane }) => lane === "live_database"
    )) {
      live.push(runProof(proof, liveEnvironment));
    }
  } finally {
    runLiveStack("down", stackEnvironment);
  }
  const results = [...deterministic, ...live];
  assertEvryEvalProofResults(EVRY_EVAL_PROOFS, results);
  return results;
}

function estimatedMaximumCost(
  budgets: Awaited<ReturnType<typeof evryBenchmarkCallBudgets>>
): number {
  return budgets.reduce((total, budget) => total + budget.maximumCostUsd, 0);
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (options.live && !apiKey) {
    throw new Error("OPENAI_API_KEY is required for --live");
  }

  const callBudgets = await evryBenchmarkCallBudgets();
  const estimatedMaximumCostUsd = estimatedMaximumCost(callBudgets);
  if (
    options.maximumCostUsd !== null &&
    estimatedMaximumCostUsd > options.maximumCostUsd
  ) {
    throw new Error(
      `Conservative preflight $${estimatedMaximumCostUsd.toFixed(6)} exceeds --max-cost-usd=$${options.maximumCostUsd.toFixed(6)}`
    );
  }

  process.stdout.write(
    `Preflight: ${EVRY_MODEL_CANDIDATES.length} models × ${EVRY_POLICY_EVAL_FIXTURES.length} fixtures = ${EVRY_MODEL_CANDIDATES.length * EVRY_POLICY_EVAL_FIXTURES.length} calls; conservative ceiling $${estimatedMaximumCostUsd.toFixed(6)}.\n`
  );
  const proofResults = runExecutableReleaseGates();
  const safetyGates = evrySafetyGateResults({
    proofs: EVRY_EVAL_PROOFS,
    results: proofResults,
  });
  assertEvryAbsoluteSafetyGates(safetyGates);
  await configureAndCheckLangfuse();
  if (options.proofsOnly && !options.live) {
    process.stdout.write("PROOFS_ONLY=pass\n");
    return;
  }
  if (!apiKey || options.maximumCostUsd === null) {
    throw new Error("Live benchmark authorization is incomplete");
  }

  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const report = await runEvryModelBenchmark({
    apiKey,
    gitSha,
    productionModelId: EVRY_POLICY_MODEL_ID,
    maximumCostUsd: options.maximumCostUsd,
    callBudgets,
    proofResults,
    safetyGates,
    onCaseComplete({ completed, total, result }) {
      process.stdout.write(
        `[${completed}/${total}] ${result.modelId} ${result.fixtureId}: ${result.passed ? "pass" : "FAIL"} (${Math.round(result.latencyMs)} ms, $${result.usage.costUsd.toFixed(6)})\n`
      );
    },
  });

  const runId = report.generatedAt.replace(/[:.]/g, "-");
  await mkdir(options.outputDirectory, { recursive: true });
  const jsonPath = path.join(
    options.outputDirectory,
    `${runId}.evry-model-benchmark.v2.json`
  );
  const markdownPath = path.join(
    options.outputDirectory,
    `${runId}.evry-model-benchmark.v2.md`
  );
  await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  await writeFile(markdownPath, evryModelBenchmarkMarkdown(report), "utf8");

  process.stdout.write(`REPORT_JSON=${jsonPath}\n`);
  process.stdout.write(`REPORT_MARKDOWN=${markdownPath}\n`);
  process.stdout.write(
    `MEASURED_COST_USD=${report.candidates.reduce((total, candidate) => total + candidate.totalCostUsd, 0).toFixed(6)}\n`
  );
  process.stdout.write(
    `CHEAPEST_QUALIFIED=${report.cheapestQualifiedModelId ?? "none"}\n`
  );
  process.stdout.write(
    `PRODUCTION_SELECTION_MATCH=${report.productionSelectionMatches ? "yes" : "no"}\n`
  );
  if (!report.cheapestQualifiedModelId || !report.productionSelectionMatches) {
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
