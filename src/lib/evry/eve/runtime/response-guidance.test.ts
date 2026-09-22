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
const loader = readFileSync(resolve("agent/tools/load_tools.ts"), "utf8");
const composition = readFileSync(resolve("agent/tools/code_mode.ts"), "utf8");
const daily = readFileSync(resolve("agent/skills/daily-work/SKILL.md"), "utf8");
const cleanup = readFileSync(
  resolve("agent/skills/task-cleanup/SKILL.md"),
  "utf8"
);

test("feature ambiguity keeps clarification while discoverable records get a relevant lookup", () => {
  const ambiguity = instructions
    .split("\n\n")
    .find((paragraph) =>
      paragraph.startsWith("Use the conversation and page context")
    );
  assert.ok(ambiguity);
  assert.match(ambiguity, /different features, ask one brief question/);
  assert.match(ambiguity, /Do not assume a person-specific assessment/);
  assert.match(
    ambiguity,
    /within a known feature, use a small relevant lookup/
  );
  assert.match(ambiguity, /before asking the user to identify them/);
  assert.match(ambiguity, /records establish a clear match/);
  assert.match(ambiguity, /otherwise ask using the actual candidates/);
  assert.match(ambiguity, /remaining choice that records cannot supply/);
  assert.doesNotMatch(
    ambiguity,
    /September|2026|Core team orientation|assessments-0/
  );
});

test("required clarification uses the native question protocol without prescribing the answer", () => {
  const protocol = instructions
    .split("\n\n")
    .find((paragraph) => paragraph.startsWith("When user input is required"));
  assert.ok(protocol);
  assert.match(
    protocol,
    /required to continue the current request, use ask_question/
  );
  assert.match(protocol, /natural, concise prompt and allowFreeform: true/);
  assert.match(protocol, /Offer options when they help explain a real choice/);
  assert.match(protocol, /Do not end with only a prose question/);
  assert.match(
    protocol,
    /repeat the same question in both prose and the tool prompt/
  );
  assert.match(
    protocol,
    /Completed answers, rhetorical questions and optional offers of further help do not need ask_question/
  );
  assert.match(protocol, /clarification reply never approves a change/);
  assert.doesNotMatch(
    protocol,
    /4C|Plant Intelligence|assessments-03|respondIfAsked/
  );
});

test("daily lists use their returned total without requesting the same count again", () => {
  assert.match(
    daily,
    /result already includes the total number of matches across all pages/
  );
  assert.match(daily, /Use count mode when only a total is needed/);
  assert.match(daily, /Do not repeat the same filtered lookup in both modes/);
});

test("personal summaries stay focused while church-wide briefs consider cross-feature priorities", () => {
  assert.match(daily, /Keep personal summaries focused/);
  assert.match(daily, /church-wide operational brief/);
  assert.match(
    daily,
    /launch progress, unfinished milestones and ministry staffing/
  );
  assert.match(daily, /Honor an explicitly narrower scope/);
  assert.match(
    daily,
    /Missing history must not erase current findings or become a zero trend/
  );
  assert.match(launch, /broader than a personal work summary/);
  assert.match(launch, /does not require a full readiness audit/);
});

test("task cleanup applies known exclusions early and preserves complete exact review", () => {
  assert.match(
    cleanup,
    /Apply requested relationship exclusions in the initial query/
  );
  assert.match(cleanup, /rather than task-title words/);
  assert.match(cleanup, /when they affect the proposed change/);
  assert.match(
    cleanup,
    /Read every necessary page before preparing a bulk change/
  );
  assert.match(cleanup, /Prepare only requested changes/);
  assert.match(cleanup, /domain service own that consequence/);
});

test("composition guidance publishes the actual configured concurrency and call limits", () => {
  assert.match(composition, /\$\{COMPOSITION_LIMITS\.maxConcurrentToolCalls\}/);
  assert.match(composition, /\$\{COMPOSITION_LIMITS\.maxBridgeRequests\}/);
  assert.match(
    composition,
    /additional calls queue automatically within the same program deadline/
  );
  assert.match(composition, /Promise\.allSettled and inspect every outcome/);
  assert.match(composition, /Await all calls before returning/);
  assert.doesNotMatch(composition, /await each batch before starting another/);
  assert.match(
    composition,
    /No filesystem, imports, network, secrets, execution, or confirmation/
  );
});

// Protect the authored contract; live evaluations must still judge actual prose.
test("discovery guidance uses already available tools without a schema housekeeping step", () => {
  assert.match(loader, /Load missing capability definitions/);
  assert.match(loader, /when the next work needs different tools/);
  assert.match(
    loader,
    /Tools already listed with full schemas can be called directly/
  );
  assert.match(loader, /including through code_mode/);
  assert.match(loader, /do not reload them just to select a smaller subset/);
  assert.doesNotMatch(loader, /Load full definitions before calling tools/);
  assert.match(instructions, /use those tools immediately/);
  assert.match(instructions, /use them without a separate selection step/);
  assert.match(
    instructions,
    /answer rather than adding a step only to unload tools/
  );
  assert.doesNotMatch(
    instructions,
    /unload tools with an empty list before composing/
  );
});

test("filtered cards use trusted selection while text-only answers remain valid", () => {
  assert.match(
    instructions,
    /use results\.select with their exact source references and item IDs/
  );
  assert.match(
    instructions,
    /filtering code-mode output alone does not change a card/
  );
  assert.match(instructions, /text-only answers remain valid/);
});

test("discovery guidance adds missing definitions with bounded explicit replacement and exact preparation selection", () => {
  assert.match(loader, /adding them to the current working set/);
  assert.match(loader, /Use mode: replace/);
  assert.match(loader, /supply the complete desired set/);
  assert.match(loader, /over-limit addition leaves the current set unchanged/);
  assert.match(loader, /without losing results or task notes/);
  assert.match(loader, /An empty names list unloads it/);
  assert.match(loader, /Select up to eight canonical names/);
  assert.match(
    loader,
    /For actions\.prepare, also select up to three preparationOperations/
  );
  assert.match(instructions, /When the next work needs different tools/);
  assert.match(instructions, /select the definitions needed for that stage/);
  assert.match(
    instructions,
    /Loading a schema grants no permission and executes nothing/
  );
  assert.match(
    instructions,
    /All lasting changes and email sends require an exact human confirmation/
  );
});

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
    /call ask_question directly when there are no accumulated choices to save/
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

test("quantity guidance preserves denominator and scope without requiring a closing summary", () => {
  assert.match(instructions, /quantities, denominators and scope consistent/);
  assert.match(instructions, /wherever they appear/);
  assert.doesNotMatch(instructions, /including its closing summary/);
  assert.match(instructions, /must follow from the actual proportion/);
  assert.match(instructions, /exact completed\/total count/);
  assert.match(
    instructions,
    /Completion counts alone do not establish operational readiness/
  );
});

test("overview guidance removes repeated recaps while retaining depth and requested summaries", () => {
  assert.match(instructions, /Text already streamed remains visible/);
  assert.match(
    instructions,
    /After explaining the findings, do not add another recap that repeats the same counts and dates/
  );
  assert.match(
    instructions,
    /A closing section should add a useful decision, implication or next step/
  );
  assert.match(
    instructions,
    /Provide a separate summary when the user asks for one/
  );
  assert.match(
    instructions,
    /Keep the substantive explanation and supporting evidence/
  );
  assert.match(instructions, /Do not reduce a substantive overview to a count/);
  assert.match(instructions, /When a card helps/);
  assert.match(instructions, /Combine evidence across modules/);
  assert.doesNotMatch(
    instructions,
    /(?:at most|no more than|limit (?:the |your )?(?:answer|response) to) \d+ (?:sentences|words)/i
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
