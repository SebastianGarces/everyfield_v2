import type {
  EvryDetailedConfirmationArtifactDocument,
  EvryDetailedProgressArtifactDocument,
  EvryDetailedReceiptArtifactDocument,
} from "./review";

type PlanIdentity = EvryDetailedConfirmationArtifactDocument["plan"];

export type EvryArtifactInteractionState =
  | Readonly<{
      status: "review";
      confirmation: EvryDetailedConfirmationArtifactDocument;
    }>
  | Readonly<{
      status: "editing";
      invalidatedPlan: PlanIdentity;
    }>
  | Readonly<{ status: "cancelled"; plan: PlanIdentity }>
  | Readonly<{
      status: "executing";
      progress: EvryDetailedProgressArtifactDocument;
    }>
  | Readonly<{
      status: "receipt";
      receipt: EvryDetailedReceiptArtifactDocument;
    }>;

export function beginEvryArtifactEdit(
  state: EvryArtifactInteractionState
): EvryArtifactInteractionState {
  return state.status === "review"
    ? Object.freeze({
        status: "editing" as const,
        invalidatedPlan: state.confirmation.plan,
      })
    : state;
}

function samePlan(left: PlanIdentity, right: PlanIdentity): boolean {
  return left.planId === right.planId && left.fingerprint === right.fingerprint;
}

function sameStepLineage(
  left: readonly Readonly<{ stepId: string }>[],
  right: readonly Readonly<{ stepId: string }>[]
): boolean {
  return (
    left.length === right.length &&
    left.every((step, index) => step.stepId === right[index]?.stepId)
  );
}

/** Editing may only return through a fresh immutable plan identity. */
export function applyFreshEvryConfirmation(
  state: EvryArtifactInteractionState,
  confirmation: EvryDetailedConfirmationArtifactDocument
): EvryArtifactInteractionState {
  if (state.status !== "editing") return state;
  if (samePlan(state.invalidatedPlan, confirmation.plan)) {
    throw new Error("An edited Evry plan requires a fresh confirmation");
  }
  return Object.freeze({ status: "review" as const, confirmation });
}

export function cancelEvryArtifactReview(
  state: EvryArtifactInteractionState
): EvryArtifactInteractionState {
  return state.status === "review"
    ? Object.freeze({
        status: "cancelled" as const,
        plan: state.confirmation.plan,
      })
    : state;
}

export type EvryExecutionStart = Readonly<{
  state: EvryArtifactInteractionState;
  shouldExecute: boolean;
}>;

/** One synchronous transition closes the double-click execution window. */
export function beginEvryArtifactExecution(
  state: EvryArtifactInteractionState,
  progress: EvryDetailedProgressArtifactDocument
): EvryExecutionStart {
  if (
    state.status !== "review" ||
    !samePlan(state.confirmation.plan, progress.plan) ||
    !sameStepLineage(state.confirmation.steps, progress.steps)
  ) {
    return Object.freeze({ state, shouldExecute: false });
  }
  return Object.freeze({
    state: Object.freeze({ status: "executing" as const, progress }),
    shouldExecute: true,
  });
}

export function finishEvryArtifactExecution(
  state: EvryArtifactInteractionState,
  receipt: EvryDetailedReceiptArtifactDocument
): EvryArtifactInteractionState {
  if (state.status !== "executing") return state;
  if (!samePlan(state.progress.plan, receipt.plan)) {
    throw new Error("An Evry receipt must match the executing plan");
  }
  if (!sameStepLineage(state.progress.steps, receipt.steps)) {
    throw new Error("An Evry receipt must match the disclosed plan steps");
  }
  return Object.freeze({ status: "receipt" as const, receipt });
}
