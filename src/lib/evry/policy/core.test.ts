import assert from "node:assert/strict";
import { test } from "node:test";

import { EVRY_POLICY_EVAL_FIXTURES } from "@/lib/evry/evals/policy/fixtures";

import {
  failClosedEvryPolicyDecision,
  resolveEvryPolicyDecision,
} from "./core";
import { evryPolicyModelOutputSchema } from "./schema";

function fixtureDecision(
  expected: (typeof EVRY_POLICY_EVAL_FIXTURES)[number]["expected"]
) {
  return evryPolicyModelOutputSchema.parse({ decision: expected }).decision;
}

test("every policy fixture resolves to exactly its recorded class", () => {
  for (const fixture of EVRY_POLICY_EVAL_FIXTURES) {
    const result = resolveEvryPolicyDecision(
      fixture.request,
      fixtureDecision(fixture.expected)
    );
    assert.equal(
      result.classification,
      fixture.expected.classification,
      fixture.id
    );
  }
});

test("only application decisions expose a continuation", () => {
  for (const fixture of EVRY_POLICY_EVAL_FIXTURES) {
    const result = resolveEvryPolicyDecision(
      fixture.request,
      fixtureDecision(fixture.expected)
    );
    const allowed =
      fixture.expected.classification === "application_read" ||
      fixture.expected.classification === "application_action";

    assert.equal("continuation" in result, allowed, fixture.id);
    assert.equal("artifact" in result, !allowed, fixture.id);
  }
});

test("allowed continuations preserve literal user text byte for byte", () => {
  const literalUserText =
    "  Create a task named ‘Pray for the launch’\r\n— keep this punctuation.  ";
  const decision = evryPolicyModelOutputSchema.parse({
    decision: { classification: "application_action" },
  }).decision;
  const result = resolveEvryPolicyDecision(literalUserText, decision);

  assert.equal(result.classification, "application_action");
  assert.equal(result.continuation.literalUserText, literalUserText);
});

test("prohibited and unrelated requests receive identical fixed public copy", () => {
  const theology = resolveEvryPolicyDecision(
    "Write a prayer for our launch.",
    evryPolicyModelOutputSchema.parse({
      decision: { classification: "theology_or_spiritual_guidance" },
    }).decision
  );
  const unrelated = resolveEvryPolicyDecision(
    "Make a weekly meal plan.",
    evryPolicyModelOutputSchema.parse({
      decision: { classification: "unrelated" },
    }).decision
  );

  assert.equal("artifact" in theology, true);
  assert.equal("artifact" in unrelated, true);
  if (!("artifact" in theology) || !("artifact" in unrelated)) return;
  assert.deepEqual(theology.artifact, unrelated.artifact);
  assert.doesNotMatch(JSON.stringify(theology.artifact), /prayer/i);
  assert.doesNotMatch(JSON.stringify(unrelated.artifact), /meal plan/i);
});

test("mixed, ambiguous, and provider failure share the fixed refusal shape", () => {
  const mixed = resolveEvryPolicyDecision(
    "Create the meeting and advise my sermon.",
    evryPolicyModelOutputSchema.parse({
      decision: { classification: "mixed" },
    }).decision
  );
  const ambiguous = resolveEvryPolicyDecision(
    "Help me with Friday.",
    evryPolicyModelOutputSchema.parse({
      decision: { classification: "ambiguous" },
    }).decision
  );
  const failure = failClosedEvryPolicyDecision();

  assert.ok("artifact" in mixed);
  assert.ok("artifact" in ambiguous);
  assert.deepEqual(
    Object.keys(mixed.artifact),
    Object.keys(ambiguous.artifact)
  );
  assert.deepEqual(ambiguous.artifact, failure.artifact);
  assert.equal("continuation" in mixed, false);
  assert.equal("continuation" in failure, false);
});

test("Settings produces only a static generated destination", () => {
  const request = "Turn off my digest.";
  const result = resolveEvryPolicyDecision(
    request,
    evryPolicyModelOutputSchema.parse({
      decision: {
        classification: "settings",
        settingsSectionId: "notifications",
      },
    }).decision
  );

  assert.equal(result.classification, "settings");
  assert.deepEqual(result.artifact, {
    kind: "settings_handoff",
    title: "Open Notifications settings",
    message:
      "Review or change this in EveryField Settings. Evry has not read or changed the setting.",
    destination: {
      sectionId: "notifications",
    },
  });
  assert.equal("href" in result.artifact.destination, false);
  assert.equal("continuation" in result, false);
  assert.equal(JSON.stringify(result).includes(request), false);
});
