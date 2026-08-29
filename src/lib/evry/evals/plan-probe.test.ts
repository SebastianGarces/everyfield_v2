import assert from "node:assert/strict";
import test from "node:test";

import { Output } from "ai";

import { RECIPE_IDENTITY } from "@/lib/evry/recipes/fixtures.test-helper";

import {
  compileEvryPlanProbe,
  evryPlanProbeProviderOutputSchema,
} from "./plan-probe";

const OUTPUT = {
  recipeIdentity: RECIPE_IDENTITY,
  meetingId: "10000000-0000-4000-8000-000000000001",
  startsAt: "2026-09-02T14:00:00-04:00",
  audience: "Alex and Beth",
  recipientId: "30000000-0000-4000-8000-000000000001",
  subject: "Vision Meeting",
  body: "Please join us.",
} as const;

test("candidate recipe output compiles into the real confirmation plan", async () => {
  const parsed = evryPlanProbeProviderOutputSchema.parse(OUTPUT);
  const document = await compileEvryPlanProbe(parsed);
  assert.equal(document.recipe?.identity, RECIPE_IDENTITY);
  assert.equal(document.steps.length, 3);
  assert.equal(
    document.confirmation?.title,
    "Create meeting and send invitations"
  );
  assert.deepEqual(
    document.steps.map(({ capabilityIdentity }) => capabilityIdentity),
    document.recipe && [
      "meetings.create",
      "meetings.add-guests",
      "communication.send",
    ]
  );
});

test("candidate recipe output is closed to another recipe or argument", () => {
  assert.equal(
    evryPlanProbeProviderOutputSchema.safeParse({
      ...OUTPUT,
      recipeIdentity: "fixture:other",
    }).success,
    false
  );
  assert.equal(
    evryPlanProbeProviderOutputSchema.safeParse({
      ...OUTPUT,
      hiddenArgument: true,
    }).success,
    false
  );
});

test("the exact provider wire schema contains no tuple-form array items", async () => {
  const responseFormat = await Output.object({
    schema: evryPlanProbeProviderOutputSchema,
  }).responseFormat;
  const serialized = JSON.stringify(responseFormat);
  assert.match(serialized, /"recipientId"/);
  assert.doesNotMatch(serialized, /"items":\s*\[/);
});
