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
