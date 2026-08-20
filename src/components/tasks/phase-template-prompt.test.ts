import assert from "node:assert/strict";
import { test } from "node:test";

import { buildPhaseTemplatePrompt } from "@/lib/tasks/phase-prompt";
import { phaseTemplatesFor } from "@/lib/tasks/templates";

import {
  PROMPT_SOURCE_PATH,
  TRANSITIONED_AT,
  buttons,
  clickables,
  decode,
  promptData,
  readSource,
  render,
  renderReceipt,
  seam,
  textOf,
} from "./phase-template-prompt-fixtures";
import { partialImportMessage } from "./phase-template-prompt";

// ----------------------------------------------------------------------------
// THE PANEL — both bodies, as a browser receives them.
//
// One `<section>` has two contents: the prompt ASKS, and after a part-way
// import the receipt REPORTS. Everything here is an assertion about rendered
// markup — the copy, which block a sentence lives in, the accessible name, the
// chrome the two bodies share — because that is the half a reader can check by
// looking at the screen.
//
// The island's own decisions are `phase-template-prompt-controls.test.ts`; what
// the actions and the loader do with a decision is
// `phase-template-prompt-receipt.test.ts`. Fixtures for all three:
// `phase-template-prompt-fixtures.ts`.
// ----------------------------------------------------------------------------

test("every control is rendered, and each checklist label says it is clickable", () => {
  const html = render();
  const controls = clickables(html);

  // Two buttons, plus a checkbox and a label per checklist on offer.
  assert.equal(controls.length, 2 + promptData().offers.length * 2);

  // Only the LABELS are scanned for the class (#502). The buttons and the
  // checkbox inputs take their cursor from globals.css; a <label> is the one
  // clickable in this subtree that no selector and no shadcn base reaches.
  const labels = controls.filter((control) => control.startsWith("<label"));
  assert.equal(labels.length, promptData().offers.length);

  for (const label of labels) {
    assert.match(
      label,
      /cursor-pointer/,
      `a checklist label is missing cursor-pointer: ${label}`
    );
  }
});

test("both answers are offered — import and decline", () => {
  const text = textOf(render());

  assert.ok(text.includes("Import checklists"));
  assert.ok(text.includes("Not now"));
});

test("the prompt names the stage that was reached", () => {
  const prompt = promptData(2);
  assert.ok(textOf(render(prompt)).includes(prompt.phaseName));
});

test("every checklist on offer is listed, with what it would create", () => {
  const prompt = promptData(2);
  const text = textOf(render(prompt));

  for (const offer of prompt.offers) {
    assert.ok(text.includes(offer.name), `${offer.key} is not on screen`);
    assert.ok(
      text.includes(`${offer.taskCount} tasks`) || text.includes("1 task"),
      `${offer.key} does not say how many tasks it creates`
    );
  }
});

test("each checklist submits its own key, ticked by default", () => {
  // Ticked is a preselection, not a decision already taken: the form still has
  // to be submitted before anything is created.
  const prompt = promptData(2);
  const html = render(prompt);

  for (const offer of prompt.offers) {
    assert.ok(
      html.includes(`name="templateKey"`) &&
        html.includes(`value="${offer.key}"`),
      `${offer.key} is not submittable`
    );
  }

  assert.equal(
    (html.match(/checked=""/g) ?? []).length,
    prompt.offers.length,
    "every checklist should arrive ticked"
  );
});

test("the prompt says nothing is created until it is answered", () => {
  const text = textOf(render());

  assert.ok(text.includes("Nothing is created until you press Import"));
  assert.ok(
    text.includes(
      "Not now creates nothing and hides this until your next stage"
    )
  );
});

test("the dates shown are the transition's, pinned to the app time zone", () => {
  // A due date formatted in the runtime's zone renders one string on the
  // server and another after hydration (`memory/invariants.md` → Date & Time
  // Rendering). Asserting the exact string is what pins the zone.
  const text = textOf(render(promptData(2)));

  assert.ok(
    text.includes("Mar 2, 2026"),
    "the prompt does not state the day the plant moved"
  );
});

test("the checklist boxes are labelled, not bare", () => {
  const prompt = promptData(2);
  const html = decode(render(prompt));

  for (const offer of prompt.offers) {
    assert.ok(
      html.includes(`for="phase-template-${offer.key}"`),
      `${offer.key}'s checkbox has no label`
    );
    assert.ok(
      html.includes(`id="phase-template-${offer.key}"`),
      `${offer.key}'s label points at nothing`
    );
  }
});

test("no count is ever fused to the word after it", () => {
  // The copy defect a number rendered next to a JSX expression produces
  // ("12tasks"). The sentence is one string, so the space is part of it.
  assert.doesNotMatch(textOf(render()), /\d\p{L}/u);
});

test("a phase whose catalog is empty renders nothing at all", () => {
  // The view is only ever reached with a prompt, and a prompt is only built
  // when the phase has templates — asserted here from the other end.
  assert.equal(phaseTemplatesFor(9).length, 0);
  assert.equal(
    buildPhaseTemplatePrompt({
      id: "11111111-1111-4111-8111-111111111111",
      fromPhase: 8,
      toPhase: 9,
      createdAt: TRANSITIONED_AT,
    }),
    null
  );
});

test("the prompt states what unticking costs, and where the checklist stays", () => {
  // Round 2 of the PR #393 review. The answer is one row per TRANSITION, so
  // unticking is not "later" — it is "not here again". The planter cannot infer
  // that from a checkbox, so the copy says it, and points at the one route that
  // still has the checklist.
  const html = render();
  const text = textOf(html);

  assert.ok(
    text.includes(
      "Unticked checklists are not offered again for this stage change"
    ),
    "the prompt does not say that unticking is final for this transition"
  );
  assert.ok(
    text.includes("You can still import them at any time from"),
    "the prompt does not say the unticked checklists remain available"
  );
  assert.ok(
    html.includes('href="/tasks/templates"'),
    "the untick note does not link to the standing catalog route"
  );
});

test("the untick consequence is read before the checklist it applies to", () => {
  // Said after the boxes, it is a correction rather than a warning.
  const html = render();
  const notePosition = html.indexOf(
    "Unticked checklists are not offered again"
  );
  const firstCheckbox = html.indexOf('type="checkbox"');

  assert.ok(notePosition >= 0 && firstCheckbox >= 0);
  assert.ok(
    notePosition < firstCheckbox,
    "the untick note renders below the boxes it is about"
  );
});

test("the fine print is not a fourth lead paragraph", () => {
  // Verifier warning 5: three muted `text-sm` paragraphs were already a wall,
  // and round 2 added a sentence. The standing policy therefore drops to `xs`
  // fine print, so the lead keeps exactly two muted `text-sm` paragraphs.
  const html = render();

  // The lead seam only — the checklist rows below carry `text-sm` descriptions
  // of their own, and those are content, not notes.
  const lead = seam(html, "prompt-lead");

  assert.equal(
    (lead.inner.match(/<p[\s>]/g) ?? []).length,
    2,
    "the prompt's lead should be two paragraphs, not a stack of them"
  );
  assert.equal(
    (lead.inner.match(/<p[^>]*class="[^"]*text-sm[^"]*"[^>]*>/g) ?? []).length,
    2,
    "the prompt's lead no longer reads at the lead size"
  );

  // Both standing notes live in the one fine-print block, and it is smaller
  // than the lead — that size step is what stops it reading as a fourth line.
  const finePrint = seam(html, "prompt-fine-print");

  assert.match(
    finePrint.tag,
    /class="[^"]*text-xs[^"]*"/,
    "the fine print is no longer set smaller than the lead"
  );

  for (const note of [
    "Imported tasks are added as new tasks",
    "Not now creates nothing",
  ]) {
    assert.ok(html.includes(note), `${note} is missing`);
    assert.ok(
      finePrint.inner.includes(note),
      `${note} is not inside the fine print`
    );
  }
});

test("the fine print is stated above the buttons it describes", () => {
  const html = render();

  assert.ok(
    html.indexOf("Not now creates nothing") < html.indexOf("<button"),
    "the fine print renders after the press it is meant to inform"
  );
});

test("the answer carries the transition the planter was looking at", () => {
  // #313. 'Not now' had no staleness guard: a press on a panel left open while
  // the plant moved on declined the NEW stage change — permanently, for the
  // whole plant, with no un-answer path. The id travels with the press so the
  // server can refuse a mismatch; it cannot AIM the decline, because the server
  // compares it with its own latest transition and accepts nothing else.
  const prompt = promptData(2);
  const html = render(prompt);

  assert.ok(
    html.includes(
      `<input type="hidden" name="transitionId" value="${prompt.transitionId}"/>`
    ),
    "the prompt posts no transition id, so a stale press answers the wrong stage change"
  );

  const formStart = html.indexOf("<form");
  const hidden = html.indexOf('name="transitionId"');
  assert.ok(
    formStart >= 0 && hidden > formStart,
    "the transition id is outside the form that posts it"
  );
});

test("the prompt states the import policy before the press", () => {
  // AC5 allows either behaviour so long as the surface says which. The catalog
  // has said it since T-011; the prompt did not, and a repeat here is 22–26
  // tasks rather than one small checklist (verifier warning 2 on PR #393).
  const text = textOf(render());

  assert.ok(
    text.includes("Nothing is merged, replaced or skipped"),
    "the prompt does not state that imported tasks are never deduped"
  );
  assert.ok(
    text.includes("importing again adds nothing"),
    "the prompt does not state that it can only be answered once"
  );
  assert.ok(
    text.includes("on any device"),
    "the prompt does not say the answer follows the planter, not the browser"
  );
});

test("a partial import says what landed and points at the standing catalog", () => {
  // The claim is KEPT on a part-way import, so the prompt never renders again.
  // This panel is the only place the planter can be told.
  const html = renderReceipt(9, ["Ministry Team Setup"]);
  const text = textOf(html);

  assert.match(html, /role="alert"/, "the partial import is not announced");
  assert.ok(
    text.includes("9 tasks created from Ministry Team Setup"),
    "the partial import does not say what DID land"
  );
  assert.ok(
    text.includes("The remaining checklists were not created"),
    "the partial import does not say that something failed"
  );
  assert.ok(
    text.includes("this stage change is now answered"),
    "the partial import does not say the prompt is spent"
  );
  assert.ok(
    html.includes('href="/tasks/templates"'),
    "the partial import does not point at the route holding the remainder"
  );
  assert.equal(
    buttons(html).length,
    0,
    "the answered prompt still offers checklists it can no longer import"
  );
});

test("the panel keeps its accessible name in BOTH of its bodies", () => {
  // `<section aria-labelledby>` names the landmark by pointing at the heading
  // in the lead — and the receipt REPLACES the lead. Pointed at an id that is
  // no longer in the document, the attribute contributes nothing and the region
  // goes unnamed in the one state that has no other route left. Both bodies
  // carry the id; only one is ever mounted, so it stays unique.
  const html = render();
  const named = /aria-labelledby="([^"]+)"/.exec(html)?.[1];

  assert.ok(named, "the prompt's section is not named by anything");
  assert.ok(
    html.includes(`id="${named}"`),
    "the asking state names the section after an element it does not render"
  );
  assert.ok(
    renderReceipt(9, ["Ministry Team Setup"]).includes(`id="${named}"`),
    "the receipt drops the id the section is named by, so the landmark loses its accessible name exactly when it replaces the body"
  );
});

test("both bodies wear ONE panel chrome, written once", () => {
  // The test above states a rule the two bodies must both obey. A rule that two
  // copies of the same markup must stay identical is a rule one edit breaks
  // silently, so the `<section>` — its `aria-labelledby`, its `data-testid` and
  // its card styling — is written in a single wrapper and neither body owns it.
  const opening = (html: string) => /<section[^>]*>/.exec(html)?.[0];

  const asking = opening(render());
  const reporting = opening(renderReceipt(9, ["Ministry Team Setup"]));

  assert.ok(asking, "the asking body renders no section landmark");
  assert.equal(
    reporting,
    asking,
    "the two bodies' landmark chrome has drifted apart — they are copies again"
  );

  const source = readSource(PROMPT_SOURCE_PATH);
  // JSX openings only — the surrounding prose names the element too.
  assert.equal(
    (source.match(/^\s*<section\b/gm) ?? []).length,
    1,
    "the panel chrome is written more than once, which is how the two bodies drift"
  );
  assert.equal(
    (source.match(/data-testid="phase-template-prompt"/g) ?? []).length,
    1,
    "the panel's test seam is declared in more than one place"
  );
});

test("the receipt REPLACES the panel body rather than joining it", () => {
  // The receipt is the panel's whole content in this state, and it offers
  // nothing: the alternative — a receipt UNDER the offers — is a screen that
  // invites a second import of a set that already half-landed, and those offers
  // cannot be taken anyway, because the transition is answered.
  const html = renderReceipt(16, ["Ministry Team Setup"]);

  assert.equal(
    buttons(html).length,
    0,
    "the answered panel still offers checklists it can no longer import"
  );
  assert.ok(
    !html.includes("<form") && !html.includes('name="templateKey"'),
    "the receipt still carries the form the answer made unusable"
  );
  assert.ok(
    !textOf(html).includes("Nothing is created until you press Import"),
    "the prompt's lead survived into a panel that is no longer asking"
  );
});

test("the partial receipt reads as a sentence at any number of checklists", () => {
  assert.ok(partialImportMessage(1, ["A"]).includes("1 task created from A"));
  assert.ok(
    partialImportMessage(4, ["A", "B"]).includes("4 tasks created from A and B")
  );
  assert.ok(
    partialImportMessage(6, ["A", "B", "C"]).includes(
      "6 tasks created from A, B and C"
    )
  );
});
