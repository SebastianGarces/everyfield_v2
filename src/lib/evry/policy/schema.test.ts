import assert from "node:assert/strict";
import { test } from "node:test";

import { EVRY_SETTINGS_CATALOG } from "./inventory";
import {
  EVRY_POLICY_CLASSIFICATIONS,
  evryPolicyModelOutputSchema,
} from "./schema";

test("the model schema accepts exactly the seven closed decisions", () => {
  const settingsSectionId = EVRY_SETTINGS_CATALOG[0]?.id;
  assert.ok(settingsSectionId, "the generated Settings catalog is non-empty");

  const parsed = EVRY_POLICY_CLASSIFICATIONS.map((classification) =>
    evryPolicyModelOutputSchema.parse({
      decision:
        classification === "settings"
          ? { classification, settingsSectionId }
          : { classification },
    })
  );

  assert.deepEqual(
    parsed.map(({ decision }) => decision.classification),
    EVRY_POLICY_CLASSIFICATIONS
  );
});

test("Settings ids come from the generated inventory", () => {
  for (const { id } of EVRY_SETTINGS_CATALOG) {
    assert.equal(
      evryPolicyModelOutputSchema.safeParse({
        decision: { classification: "settings", settingsSectionId: id },
      }).success,
      true,
      id
    );
  }

  assert.equal(
    evryPolicyModelOutputSchema.safeParse({
      decision: {
        classification: "settings",
        settingsSectionId: "made-up-section",
      },
    }).success,
    false
  );
});

test("the structured output refuses extra, missing, and cross-class fields", () => {
  const cases = [
    {
      decision: { classification: "settings" },
    },
    {
      decision: {
        classification: "application_read",
        settingsSectionId: "notifications",
      },
    },
    {
      decision: { classification: "unrelated", explanation: "harmless" },
    },
    {
      decision: { classification: "unrelated" },
      explanation: "also harmless",
    },
    {
      decision: { classification: "another_class" },
    },
  ];

  for (const value of cases) {
    assert.equal(
      evryPolicyModelOutputSchema.safeParse(value).success,
      false,
      JSON.stringify(value)
    );
  }
});
