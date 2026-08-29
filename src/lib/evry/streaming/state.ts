export const EVRY_ACKNOWLEDGEMENT_BUDGET_MS = 250;

export const EVRY_WORK_PHASES = [
  "idle",
  "reading",
  "planning",
  "confirmation",
  "execution",
  "complete",
  "blocked",
  "failed",
] as const;

type WorkMessage = Readonly<{ message: string }>;

export type EvryWorkState =
  | Readonly<{ phase: "idle" }>
  | (Readonly<{
      phase:
        | "reading"
        | "planning"
        | "confirmation"
        | "execution"
        | "complete"
        | "blocked"
        | "failed";
    }> &
      WorkMessage);

export type EvryWorkPresentation = Readonly<{
  announcement: string;
  assertive: string;
  busy: boolean;
}>;

export function evryWorkPresentation(
  state: EvryWorkState
): EvryWorkPresentation {
  switch (state.phase) {
    case "idle":
      return { announcement: "", assertive: "", busy: false };
    case "reading":
    case "planning":
    case "execution":
      return {
        announcement: state.message,
        assertive: "",
        busy: true,
      };
    case "confirmation":
    case "complete":
      return {
        announcement: state.message,
        assertive: "",
        busy: false,
      };
    case "blocked":
    case "failed":
      return {
        announcement: "",
        assertive: state.message,
        busy: false,
      };
    default: {
      const exhaustive: never = state;
      return exhaustive;
    }
  }
}

export type EvryAcknowledgementMeasurement = Readonly<{
  durationMs: number;
  withinBudget: boolean;
}>;

export type EvrySequencedWorkState = Readonly<{
  requestId: string;
  sequence: number;
  state: EvryWorkState;
}>;

export function beginEvrySequencedWork(
  requestId: string,
  state: EvryWorkState
): EvrySequencedWorkState {
  return { requestId, sequence: 0, state };
}

/** Ignore late or duplicate updates after a newer request/phase owns the UI. */
export function applyEvrySequencedWork(
  current: EvrySequencedWorkState,
  update: EvrySequencedWorkState
): EvrySequencedWorkState {
  return update.requestId === current.requestId &&
    update.sequence > current.sequence
    ? update
    : current;
}

export function measureEvryAcknowledgement(
  submittedAt: number,
  committedAt: number
): EvryAcknowledgementMeasurement {
  const durationMs = committedAt - submittedAt;
  if (!Number.isFinite(durationMs) || durationMs < 0) {
    throw new Error("Evry acknowledgement must not precede submission");
  }
  return {
    durationMs,
    withinBudget: durationMs <= EVRY_ACKNOWLEDGEMENT_BUDGET_MS,
  };
}
