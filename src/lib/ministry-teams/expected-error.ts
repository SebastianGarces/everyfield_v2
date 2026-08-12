/**
 * An error whose MESSAGE IS USER COPY — written for the planter, thrown by the
 * ministry-teams service when a legible business rule refuses the call
 * ("Person not found", "Training already completed").
 *
 * The action shell (app/(dashboard)/teams/action-shell.ts) surfaces
 * `ExpectedError.message` verbatim and replaces every other throw with the
 * action's generic fallback sentence — so an internal or driver error can
 * never leak its wording to the UI, and a message meant to be read never gets
 * swallowed. Ruled 2026-08-12 (409-6C): this type is the boundary; throwing a
 * plain `Error` means "the planter sees the generic sentence".
 */
export class ExpectedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExpectedError";
  }
}
