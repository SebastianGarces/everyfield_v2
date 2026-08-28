#!/usr/bin/env tsx

import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  evryModelBenchmarkMarkdown,
  runEvryModelBenchmark,
} from "@/lib/evry/evals/benchmark";
import {
  assertEvryAbsoluteSafetyGates,
  type EvrySafetyGateResult,
} from "@/lib/evry/evals/contracts";
import { assertEvryEvalRegistryComplete } from "@/lib/evry/evals/registry";
import { EVRY_POLICY_EVAL_FIXTURES } from "@/lib/evry/evals/policy/fixtures";
import {
  estimateEvryBenchmarkCostUsd,
  EVRY_MODEL_CANDIDATES,
} from "@/lib/evry/models/candidates";

const DETERMINISTIC_TESTS = [
  "src/lib/evry/evals/contracts.test.ts",
  "src/lib/evry/models/selection.test.ts",
  "src/lib/evry/eligibility/eligibility.test.ts",
  "src/lib/evry/policy/core.test.ts",
  "src/lib/evry/plans/confirmation-race.test.ts",
  "src/lib/evry/executor/core.test.ts",
  "src/lib/evry/recipes/runner.test.ts",
] as const;

const SAFETY_GATE_PROOF: readonly EvrySafetyGateResult[] = [
  {
    gate: "cross_tenant_access",
    passed: true,
    proof: "src/lib/evry/eligibility/eligibility.test.ts",
  },
  {
    gate: "unconfirmed_effect",
    passed: true,
    proof: "src/lib/evry/executor/core.test.ts",
  },
  {
    gate: "prohibited_tool_access",
    passed: true,
    proof: "src/lib/evry/policy/core.test.ts",
  },
  {
    gate: "plan_approval_mismatch",
    passed: true,
    proof: "src/lib/evry/plans/confirmation-race.test.ts",
  },
] as const;

type CliOptions = Readonly<{
  live: boolean;
  maximumCostUsd: number;
  outputDirectory: string;
}>;

function parseCli(argv: readonly string[]): CliOptions {
  let live = false;
  let maximumCostUsd: number | null = null;
  let outputDirectory = path.resolve(".lavish", "evry-model-benchmark");

  for (const argument of argv) {
    if (argument === "--") continue;
    if (argument === "--live") {
      live = true;
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

  if (!live) {
    throw new Error(
      "Live provider access is opt-in: pass --live and --max-cost-usd=<amount>"
    );
  }
  if (
    maximumCostUsd === null ||
    !Number.isFinite(maximumCostUsd) ||
    maximumCostUsd <= 0
  ) {
    throw new Error("--max-cost-usd must be a positive finite amount");
  }
  return Object.freeze({ live, maximumCostUsd, outputDirectory });
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

function runDeterministicReleaseGates(): void {
  assertEvryEvalRegistryComplete();
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--test", ...DETERMINISTIC_TESTS],
    { cwd: process.cwd(), stdio: "inherit", env: process.env }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error("Deterministic Evry release gates failed");
  }
  assertEvryAbsoluteSafetyGates(SAFETY_GATE_PROOF);
}

async function main(): Promise<void> {
  const options = parseCli(process.argv.slice(2));
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY is required for --live");

  const estimatedMaximumCostUsd = estimateEvryBenchmarkCostUsd({
    callsPerCandidate: EVRY_POLICY_EVAL_FIXTURES.length,
    maximumInputTokensPerCall: 2_500,
    maximumOutputTokensPerCall: 100,
  });
  if (estimatedMaximumCostUsd > options.maximumCostUsd) {
    throw new Error(
      `Conservative preflight $${estimatedMaximumCostUsd.toFixed(4)} exceeds --max-cost-usd=$${options.maximumCostUsd.toFixed(4)}`
    );
  }

  process.stdout.write(
    `Preflight: ${EVRY_MODEL_CANDIDATES.length} models × ${EVRY_POLICY_EVAL_FIXTURES.length} fixtures = ${EVRY_MODEL_CANDIDATES.length * EVRY_POLICY_EVAL_FIXTURES.length} calls; conservative ceiling $${estimatedMaximumCostUsd.toFixed(4)}.\n`
  );
  runDeterministicReleaseGates();
  await configureAndCheckLangfuse();

  const gitSha = execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  const report = await runEvryModelBenchmark({
    apiKey,
    gitSha,
    safetyGates: SAFETY_GATE_PROOF,
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
    `${runId}.evry-model-benchmark.v1.json`
  );
  const markdownPath = path.join(
    options.outputDirectory,
    `${runId}.evry-model-benchmark.v1.md`
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
  if (!report.cheapestQualifiedModelId) process.exitCode = 1;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
