import { generateText, Output, type LanguageModel } from "ai";

import {
  evryModelCandidate,
  evryPolicyProviderOptions,
  EVRY_POLICY_MAX_OUTPUT_TOKENS,
  EVRY_POLICY_TIMEOUT_MS,
} from "@/lib/evry/models/candidates";
import { EVRY_POLICY_MODEL_ID } from "@/lib/evry/models/provider";

import {
  failClosedEvryPolicyDecision,
  resolveEvryPolicyDecision,
  type EvryPolicyDecision,
} from "./core";
import { EVRY_POLICY_SYSTEM_PROMPT } from "./prompt";
import {
  evryPolicyDecisionFromProviderOutput,
  evryPolicyProviderOutputSchema,
} from "./schema";

/**
 * The first working-model output is the policy decision. This call receives no
 * tools and has no supervisor call or retry path; domain work can begin only
 * from the returned continuation branch.
 */
export async function classifyEvryRequest({
  literalUserText,
  getModel,
}: {
  literalUserText: string;
  getModel: () => LanguageModel;
}): Promise<EvryPolicyDecision> {
  try {
    const candidate = evryModelCandidate(EVRY_POLICY_MODEL_ID);
    if (candidate === null) throw new Error("Unknown Evry policy model");
    const result = await generateText({
      model: getModel(),
      output: Output.object({ schema: evryPolicyProviderOutputSchema }),
      system: EVRY_POLICY_SYSTEM_PROMPT,
      prompt: literalUserText,
      maxOutputTokens: EVRY_POLICY_MAX_OUTPUT_TOKENS,
      maxRetries: 0,
      timeout: EVRY_POLICY_TIMEOUT_MS,
      providerOptions: evryPolicyProviderOptions(candidate),
    });

    return resolveEvryPolicyDecision(
      literalUserText,
      evryPolicyDecisionFromProviderOutput(result.output)
    );
  } catch {
    return failClosedEvryPolicyDecision();
  }
}
