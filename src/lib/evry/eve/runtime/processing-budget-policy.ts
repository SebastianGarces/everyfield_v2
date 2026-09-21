/** Application policy, independent of Eve's context window or lifetime limits. */
export const EVE_PROCESSING_LIMITS = {
  modelCalls: 24,
  inputTokens: 2_000_000,
  outputTokens: 64_000,
  outputTokensPerCall: 8_000,
} as const;
export const EVE_PROCESSING_LIMIT_SENTINEL = "EVRY_PROCESSING_LIMIT_REACHED";
export const EVE_PROCESSING_LIMIT_MESSAGE =
  "Evry stopped this request after an unusually long investigation. Your conversation is saved. Try again, or narrow the request.";

export type EveProcessingBudget = {
  turnId: string;
  modelCalls: number;
  inputTokens: number;
  outputTokens: number;
};
export function freshProcessingBudget(turnId: string): EveProcessingBudget {
  return { turnId, modelCalls: 0, inputTokens: 0, outputTokens: 0 };
}
export function beginProcessingTurn(
  state: EveProcessingBudget,
  turnId: string
) {
  return state.turnId === turnId ? state : freshProcessingBudget(turnId);
}
export function assertProcessingAllowance(state: EveProcessingBudget) {
  if (!state.turnId)
    throw new Error("Evry processing turn was not initialized");
  if (
    state.modelCalls >= EVE_PROCESSING_LIMITS.modelCalls ||
    state.inputTokens >= EVE_PROCESSING_LIMITS.inputTokens ||
    state.outputTokens >= EVE_PROCESSING_LIMITS.outputTokens
  )
    throw new Error(EVE_PROCESSING_LIMIT_SENTINEL);
}
export function reserveProcessingCall(state: EveProcessingBudget) {
  assertProcessingAllowance(state);
  return { ...state, modelCalls: state.modelCalls + 1 };
}
export function processingOutputAllowance(state: EveProcessingBudget) {
  return Math.max(
    1,
    Math.min(
      EVE_PROCESSING_LIMITS.outputTokensPerCall,
      EVE_PROCESSING_LIMITS.outputTokens - state.outputTokens
    )
  );
}
