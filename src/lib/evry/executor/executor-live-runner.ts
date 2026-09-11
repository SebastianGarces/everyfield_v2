import path from "node:path";

export const EXECUTOR_LIVE_PROOF_PHASES = [
  "replay",
  "communication",
  "authority",
] as const;

export type ExecutorLiveProofPhase =
  (typeof EXECUTOR_LIVE_PROOF_PHASES)[number];

/** Bound one independent proof family, never their aggregate runtime. */
export const EXECUTOR_LIVE_PROOF_PHASE_TIMEOUT_MS = 120_000;

export function parseExecutorLiveProofPhase(
  value: string | undefined
): ExecutorLiveProofPhase {
  if (
    value &&
    EXECUTOR_LIVE_PROOF_PHASES.includes(value as ExecutorLiveProofPhase)
  ) {
    return value as ExecutorLiveProofPhase;
  }
  throw new Error(`Unknown Executor live proof phase: ${String(value)}`);
}

export function executorLiveProofArguments(input: {
  cwd: string;
  phase: ExecutorLiveProofPhase;
}): string[] {
  return [
    "--no-warnings",
    "--experimental-test-module-mocks",
    "--import",
    "tsx",
    "--import",
    "./scripts/live-db-endpoint.ts",
    path.join(input.cwd, "src/lib/evry/executor/executor-live-proof.ts"),
    input.phase,
  ];
}

export function executorLiveProofPhaseMarker(
  phase: ExecutorLiveProofPhase,
  state: "started" | "passed"
): string {
  return `EVRY_EXECUTOR_LIVE_PHASE=${phase}:${state}`;
}
