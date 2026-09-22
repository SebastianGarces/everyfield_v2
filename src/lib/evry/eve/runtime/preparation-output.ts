import { z } from "zod";
import { evryConversationArtifactDocumentSchema } from "@/lib/evry/conversations/artifacts";
import { evryConversationPlanIdentitySchema } from "@/lib/evry/conversations/contract";
import type { EveJsonValue } from "../capabilities/registry";

const preparedResultSchema = z.object({
  activePlan: z.object({
    mode: z.literal("set"),
    plan: evryConversationPlanIdentitySchema,
  }),
  artifacts: z.array(evryConversationArtifactDocumentSchema),
});

/** Called only after the registry has retained the original review and audit data. */
export function preparationModelOutput(result: EveJsonValue): EveJsonValue {
  const parsed = preparedResultSchema.safeParse(result);
  if (!parsed.success) return result;
  const { plan } = parsed.data.activePlan;
  const review = parsed.data.artifacts.find(
    (artifact) =>
      artifact.kind === "confirmation" &&
      artifact.plan.planId === plan.planId &&
      artifact.plan.fingerprint === plan.fingerprint
  );
  if (!review || review.kind !== "confirmation") return result;
  return {
    status: "awaiting_confirmation",
    message:
      "The review is displayed automatically. Nothing has been changed or sent. The user must confirm using the review controls; do not add a result marker.",
    review: {
      title: review.title,
      ...("steps" in review
        ? {
            steps: review.steps.map((step) => ({
              title: step.title,
              counts: step.counts.map((count) => ({ ...count })),
              exclusions: step.exclusions.map((exclusion) => ({
                ...exclusion,
              })),
            })),
          }
        : {}),
      consequences: [...review.consequences],
    },
  };
}
