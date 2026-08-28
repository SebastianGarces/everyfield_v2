import assert from "node:assert/strict";
import { test } from "node:test";

import {
  EVRY_POLICY_CLASSIFICATIONS,
  evryPolicyModelOutputSchema,
} from "@/lib/evry/policy/schema";

import { EVRY_POLICY_EVAL_FIXTURES } from "./fixtures";

test("policy evals cover every class with canonical and paraphrase families", () => {
  for (const classification of EVRY_POLICY_CLASSIFICATIONS) {
    const fixtures = EVRY_POLICY_EVAL_FIXTURES.filter(
      ({ expected }) => expected.classification === classification
    );

    assert.ok(
      fixtures.some(({ family }) => family === "canonical"),
      `${classification}: canonical`
    );
    assert.ok(
      fixtures.some(({ family }) => family === "paraphrase"),
      `${classification}: paraphrase`
    );
  }
});

test("every expected eval decision satisfies the production schema", () => {
  for (const fixture of EVRY_POLICY_EVAL_FIXTURES) {
    assert.equal(
      evryPolicyModelOutputSchema.safeParse({ decision: fixture.expected })
        .success,
      true,
      fixture.id
    );
  }
});

test("the EV-008 literal pair differs by requested work, not protected words", () => {
  const literal = EVRY_POLICY_EVAL_FIXTURES.find(
    ({ id }) => id === "action-literal-prayer-title"
  );
  const generated = EVRY_POLICY_EVAL_FIXTURES.find(
    ({ id }) => id === "theology-write-prayer"
  );

  assert.equal(literal?.expected.classification, "application_action");
  assert.equal(
    generated?.expected.classification,
    "theology_or_spiritual_guidance"
  );
  assert.match(literal?.request ?? "", /Pray/);
  assert.match(generated?.request ?? "", /prayer/);
});

test("every prohibited or non-routable request is a per-candidate safety gate", () => {
  const prohibited = new Set([
    "theology_or_spiritual_guidance",
    "unrelated",
    "mixed",
    "ambiguous",
  ]);
  for (const fixture of EVRY_POLICY_EVAL_FIXTURES) {
    assert.equal(
      fixture.prohibitedRequestSafety,
      prohibited.has(fixture.expected.classification),
      fixture.id
    );
  }
});

test("the canonical meeting action owns the one successful-plan probe", () => {
  assert.deepEqual(
    EVRY_POLICY_EVAL_FIXTURES.filter(({ planProbe }) => planProbe !== null).map(
      ({ id, planProbe }) => ({ id, planProbe })
    ),
    [
      {
        id: "action-create-meeting",
        planProbe: "meeting_invitation_reference",
      },
    ]
  );
});
