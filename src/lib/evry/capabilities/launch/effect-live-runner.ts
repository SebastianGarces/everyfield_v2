import path from "node:path";

export const LAUNCH_EFFECT_LIVE_PROOF_PHASES = [
  "production",
  "adapter",
] as const;

export type LaunchEffectLiveProofPhase =
  (typeof LAUNCH_EFFECT_LIVE_PROOF_PHASES)[number];

/** Bound one independent proof family, never their aggregate runtime. */
export const LAUNCH_EFFECT_LIVE_PROOF_PHASE_TIMEOUT_MS = 420_000;

export function launchEffectLiveProofArguments(input: {
  cwd: string;
  phase: LaunchEffectLiveProofPhase;
}): string[] {
  return [
    "--no-warnings",
    "--import",
    "tsx",
    "--import",
    "./scripts/live-db-endpoint.ts",
    path.join(
      input.cwd,
      "src/lib/evry/capabilities/launch/effect-live-proof.ts"
    ),
    input.phase,
  ];
}

export function launchEffectLiveProofPhaseMarker(
  phase: LaunchEffectLiveProofPhase
): string {
  return `EVRY_LAUNCH_EFFECT_PHASE=${phase}:passed`;
}
