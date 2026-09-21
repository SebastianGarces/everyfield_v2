import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";

const instructions = readFileSync(resolve("agent/instructions.md"), "utf8");
const launch = readFileSync(
  resolve("agent/skills/launch-review/SKILL.md"),
  "utf8"
);
const invitation = readFileSync(
  resolve("agent/skills/meeting-invite/SKILL.md"),
  "utf8"
);

// Protect the authored contract; live evaluations must still judge actual prose.
test("quantity guidance preserves denominator and scope through the closing summary", () => {
  assert.match(instructions, /quantities, denominators and scope consistent/);
  assert.match(instructions, /including its closing summary/);
  assert.match(instructions, /must follow from the actual proportion/);
  assert.match(instructions, /exact completed\/total count/);
  assert.match(
    instructions,
    /Completion counts alone do not establish operational readiness/
  );
});

test("review handoffs avoid duplication without shortening substantive overviews or bypassing confirmation", () => {
  assert.match(
    instructions,
    /brief handoff rather than a second field-by-field/
  );
  assert.match(instructions, /when the user asked for that explanation/);
  assert.match(instructions, /not to substantive overviews or explanations/);
  assert.match(
    launch,
    /progress out of the total, the most important open work, and supported implications/
  );
  assert.match(launch, /Do not replace the whole overview with a one-record/);
  assert.match(
    invitation,
    /without repeating them as another checklist in prose/
  );
  assert.match(invitation, /one editable subject\/body preview/);
  assert.match(invitation, /Use future tense until execution receipts/);
  assert.match(invitation, /not confirmation of an unseen execution plan/);
});

test("failed full-source reads require exact identifier recovery and an honest snippet limit", () => {
  assert.match(instructions, /exact lookup value returned by search/);
  assert.match(instructions, /retry a corrected lookup when possible/);
  assert.match(instructions, /rather than deriving it from a display link/);
  assert.match(
    instructions,
    /Do not silently substitute search snippets for a full-source summary/
  );
  assert.match(instructions, /distinguish any snippet-based information/);
});
