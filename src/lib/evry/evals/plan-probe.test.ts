import assert from "node:assert/strict";
import test from "node:test";

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
  recipientIds: ["30000000-0000-4000-8000-000000000001"],
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
      "action:src/app/(dashboard)/meetings/actions.ts → createMeetingAction",
      "action:src/app/(dashboard)/meetings/actions.ts → addToGuestListAction",
      "action:src/app/(dashboard)/communication/actions.ts → sendMessageAction",
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
