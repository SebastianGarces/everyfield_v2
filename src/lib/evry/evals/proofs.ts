import type {
  EvryEvalProof,
  EvryEvalProofResult,
  EvrySafetyGateResult,
} from "./contracts";
import { EVRY_ABSOLUTE_SAFETY_GATES } from "./contracts";

type NodeTestSummary = Readonly<{
  tests: number;
  passed: number;
  failed: number;
  cancelled: number;
  skipped: number;
  todo: number;
  durationMs: number;
}>;

function summaryCount(output: string, label: string): number {
  const match = output.match(new RegExp(`^# ${label} (\\d+)$`, "m"));
  if (!match) throw new Error(`Missing node:test ${label} summary`);
  return Number(match[1]);
}

/** Parse node:test TAP's final counters; missing counters fail closed. */
export function parseEvryNodeTestSummary(output: string): NodeTestSummary {
  const duration = output.match(/^# duration_ms ([0-9]+(?:\.[0-9]+)?)$/m);
  if (!duration) throw new Error("Missing node:test duration summary");
  return Object.freeze({
    tests: summaryCount(output, "tests"),
    passed: summaryCount(output, "pass"),
    failed: summaryCount(output, "fail"),
    cancelled: summaryCount(output, "cancelled"),
    skipped: summaryCount(output, "skipped"),
    todo: summaryCount(output, "todo"),
    durationMs: Number(duration[1]),
  });
}

export function evryEvalProofResult(input: {
  proof: EvryEvalProof;
  exitCode: number | null;
  output: string;
}): EvryEvalProofResult {
  const summary = parseEvryNodeTestSummary(input.output);
  const passed =
    input.exitCode === 0 &&
    summary.tests > 0 &&
    summary.passed === summary.tests &&
    summary.failed === 0 &&
    summary.cancelled === 0 &&
    summary.skipped === 0 &&
    summary.todo === 0;
  return Object.freeze({
    proofId: input.proof.id,
    testFile: input.proof.testFile,
    lane: input.proof.lane,
    passed,
    tests: summary.tests,
    skipped: summary.skipped,
    durationMs: summary.durationMs,
  });
}

export function evrySafetyGateResults(input: {
  proofs: readonly EvryEvalProof[];
  results: readonly EvryEvalProofResult[];
}): readonly EvrySafetyGateResult[] {
  const resultById = new Map(
    input.results.map((result) => [result.proofId, result])
  );
  return EVRY_ABSOLUTE_SAFETY_GATES.map((gate) => {
    const proofs = input.proofs.filter(({ safetyGates }) =>
      safetyGates.includes(gate)
    );
    if (proofs.length === 0) {
      throw new Error(`Evry safety gate ${gate} has no executable proof`);
    }
    const results = proofs.map(({ id }) => resultById.get(id));
    return Object.freeze({
      gate,
      passed:
        results.every((result) => result?.passed === true) &&
        results.every((result) => result?.skipped === 0),
      proof: proofs.map(({ testFile }) => testFile).join(", "),
    });
  });
}

export function assertEvryEvalProofResults(
  proofs: readonly EvryEvalProof[],
  results: readonly EvryEvalProofResult[]
): void {
  if (results.length !== proofs.length) {
    throw new Error("Evry benchmark did not execute every registered proof");
  }
  for (const proof of proofs) {
    const matches = results.filter(({ proofId }) => proofId === proof.id);
    if (matches.length !== 1 || !matches[0]?.passed || matches[0].skipped > 0) {
      throw new Error(`Evry executable proof failed or skipped: ${proof.id}`);
    }
  }
}
