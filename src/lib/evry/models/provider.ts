import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModel } from "ai";

import type { EvryModelCandidateId } from "./candidates";

/**
 * Selected from the verified 2026-08-28 release benchmark. Keep the provider
 * behind this seam so production never chooses a model from caller input.
 */
export const EVRY_POLICY_MODEL_ID =
  "gpt-5.6-luna" satisfies EvryModelCandidateId;

/** Resolve lazily so imports and provider-free tests do not require a key. */
export function getEvryPolicyModel(): LanguageModel {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_API_KEY is not set — required to classify Evry requests."
    );
  }
  return createOpenAI({ apiKey })(EVRY_POLICY_MODEL_ID);
}
