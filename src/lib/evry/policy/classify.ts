import { generateText, Output, type LanguageModel } from "ai";

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
  model,
}: {
  literalUserText: string;
  model: LanguageModel;
}): Promise<EvryPolicyDecision> {
  try {
    const result = await generateText({
      model,
      output: Output.object({ schema: evryPolicyProviderOutputSchema }),
      system: EVRY_POLICY_SYSTEM_PROMPT,
      prompt: literalUserText,
      maxRetries: 0,
      providerOptions: { openai: { store: false } },
    });

    return resolveEvryPolicyDecision(
      literalUserText,
      evryPolicyDecisionFromProviderOutput(result.output)
    );
  } catch {
    return failClosedEvryPolicyDecision();
  }
}
