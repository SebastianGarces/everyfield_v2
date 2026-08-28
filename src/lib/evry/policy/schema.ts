import { z } from "zod";

import { EVRY_SETTINGS_CATALOG } from "./inventory";

export const EVRY_POLICY_CLASSIFICATIONS = [
  "application_read",
  "application_action",
  "settings",
  "theology_or_spiritual_guidance",
  "unrelated",
  "mixed",
  "ambiguous",
] as const;

export type EvryPolicyClassification =
  (typeof EVRY_POLICY_CLASSIFICATIONS)[number];

const settingsSectionIds = EVRY_SETTINGS_CATALOG.map(({ id }) => id);

if (settingsSectionIds.length === 0) {
  throw new Error(
    "Evry policy requires at least one generated Settings section"
  );
}

/** A Settings id that has crossed the generated-inventory parse boundary. */
export const evrySettingsSectionIdSchema = z
  .enum(settingsSectionIds)
  .brand<"EvrySettingsSectionId">();
export type EvrySettingsSectionId = z.infer<typeof evrySettingsSectionIdSchema>;

const classOnlyDecision = <
  const Classification extends Exclude<EvryPolicyClassification, "settings">,
>(
  classification: Classification
) => z.object({ classification: z.literal(classification) }).strict();

const policyDecisionSchema = z.discriminatedUnion("classification", [
  classOnlyDecision("application_read"),
  classOnlyDecision("application_action"),
  z
    .object({
      classification: z.literal("settings"),
      settingsSectionId: evrySettingsSectionIdSchema,
    })
    .strict(),
  classOnlyDecision("theology_or_spiritual_guidance"),
  classOnlyDecision("unrelated"),
  classOnlyDecision("mixed"),
  classOnlyDecision("ambiguous"),
]);

/**
 * The model may choose one class and, only for Settings, one generated section.
 * There is deliberately no rationale, response copy, tool, or echoed user text
 * in the provider-controlled shape.
 *
 * The outer object keeps the structured-output root an object while the nested
 * discriminated union makes every illegal class/field combination unparseable.
 */
export const evryPolicyModelOutputSchema = z
  .object({ decision: policyDecisionSchema })
  .strict();

export type EvryPolicyModelDecision = z.infer<
  typeof evryPolicyModelOutputSchema
>["decision"];

/**
 * OpenAI strict structured outputs reject nested JSON Schema unions. Keep that
 * provider limitation at this boundary: one flat wire object crosses the API,
 * then the adapter below restores the narrower internal discriminated union.
 */
const evryPolicyProviderDecisionSchema = z
  .object({
    classification: z.enum(EVRY_POLICY_CLASSIFICATIONS),
    settingsSectionId: evrySettingsSectionIdSchema.nullable(),
  })
  .strict()
  .superRefine((decision, context) => {
    const valid =
      decision.classification === "settings"
        ? decision.settingsSectionId !== null
        : decision.settingsSectionId === null;
    if (!valid) {
      context.addIssue({
        code: "custom",
        message: "Settings section must be present only for Settings",
      });
    }
  });

export const evryPolicyProviderOutputSchema = z
  .object({ decision: evryPolicyProviderDecisionSchema })
  .strict();

export function evryPolicyDecisionFromProviderOutput(
  input: unknown
): EvryPolicyModelDecision {
  const { decision } = evryPolicyProviderOutputSchema.parse(input);
  switch (decision.classification) {
    case "settings":
      if (decision.settingsSectionId === null) {
        throw new Error("Settings provider decision is missing its section");
      }
      return {
        classification: decision.classification,
        settingsSectionId: decision.settingsSectionId,
      };
    case "application_read":
    case "application_action":
    case "theology_or_spiritual_guidance":
    case "unrelated":
    case "mixed":
    case "ambiguous":
      return { classification: decision.classification };
  }
}
