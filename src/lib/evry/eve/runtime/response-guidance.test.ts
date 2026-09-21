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
test("focused launch questions use relevant evidence without requiring a readiness audit", () => {
  const focused = launch
    .split("\n\n")
    .find((paragraph) => paragraph.startsWith("For a focused question"));
  assert.ok(focused, "Focused questions have their own investigation scope");
  assert.match(focused, /launch timing or milestones/);
  assert.match(focused, /server-calculated days remaining/);
  assert.match(focused, /completed\/open\/total milestone counts/);
  assert.match(focused, /milestone records for the requested list or detail/);
  assert.match(focused, /no separate clock lookup solely to calculate/);
  assert.match(focused, /Do not expand into a readiness audit/);
  assert.match(
    focused,
    /Read other modules when the question or a finding needs/
  );
});

test("overall launch reviews retain broad evidence and a substantive narrative", () => {
  const overview = launch
    .split("\n\n")
    .find((paragraph) => paragraph.startsWith("For an overall launch"));
  assert.ok(overview, "Broad investigation is tied to an overall review");
  assert.match(overview, /progress or readiness review/);
  assert.match(
    overview,
    /launch status, open milestones, relevant task blockers, open ministry roles and upcoming meetings/
  );
  assert.match(overview, /independent reads can run together/);
  assert.match(overview, /existing assessment evidence when useful/);
  assert.match(launch, /For an overview, start with a useful narrative/);
  assert.match(
    launch,
    /progress out of the total, the most important open work, and supported implications/
  );
  assert.match(
    launch,
    /An open-only query counts remaining milestones, not all/
  );
  assert.match(launch, /Missing post-event results before launch are expected/);
  assert.match(launch, /Read further pages or counts before claiming complete/);
  assert.match(launch, /Investigate further when a finding needs it/);
});

test("simple missing input can be requested without discovery or an empty draft while preserving accumulated choices", () => {
  assert.match(
    instructions,
    /ask directly when there are no accumulated choices to save/
  );
  assert.match(
    instructions,
    /Do not load a skill or save an empty draft merely to ask for that input/
  );
  assert.match(instructions, /conversation already retains the request/);
  assert.match(
    instructions,
    /Continue to preserve existing multi-turn choices/
  );
  assert.match(instructions, /A short reply .* continues the pending task/);
  assert.match(instructions, /Do not ask again for details already given/);
  assert.match(
    instructions,
    /Look up saved locations, audiences and full message templates/
  );
  assert.match(
    instructions,
    /Show the exact date, location, audience and editable message in the review/
  );
  assert.match(
    instructions,
    /All lasting changes and email sends require an exact human confirmation/
  );
  assert.match(
    instructions,
    /Reads and preparation tools do not execute changes/
  );
});

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

test("list pagination follows displayed pages without sacrificing complete calculations", () => {
  assert.match(
    instructions,
    /show one useful page unless the user asks for the entire list/
  );
  assert.match(
    instructions,
    /exact total without fetching every page just to count/
  );
  assert.match(
    instructions,
    /Fetch all necessary pages when calculating a result across records/
  );
  assert.match(
    instructions,
    /last page shown to the user, keeping the same filters/
  );
  assert.match(instructions, /Do not repeat a page already displayed/);
  assert.match(
    instructions,
    /result reference from an earlier turn cannot render a new card/
  );
});
