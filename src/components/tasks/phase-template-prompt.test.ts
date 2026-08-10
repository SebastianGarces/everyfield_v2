import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildPhaseTemplatePrompt,
  phaseTemplatesFor,
  type PhaseTemplatePrompt as PhaseTemplatePromptData,
} from "@/lib/tasks/phase-prompt";

import { PhaseTemplatePromptView } from "./phase-template-prompt";

// ----------------------------------------------------------------------------
// The prompt, rendered. DOM assertions, not source scans: the Cursor Pointer
// Rule is about what ships to a browser, so it is asserted on the markup a
// browser would receive.
//
// The view takes its data and its two actions as props, so this renders the
// real component with no session, no database and no phase transition.
// ----------------------------------------------------------------------------

const TRANSITIONED_AT = new Date("2026-03-02T09:15:00.000Z");

function promptData(toPhase = 2): PhaseTemplatePromptData {
  const prompt = buildPhaseTemplatePrompt(
    {
      id: "11111111-1111-4111-8111-111111111111",
      fromPhase: toPhase - 1,
      toPhase,
      createdAt: TRANSITIONED_AT,
    },
    null
  );

  assert.ok(prompt, `phase ${toPhase} offers nothing to render`);
  return prompt;
}

function render(prompt: PhaseTemplatePromptData = promptData()): string {
  return renderToStaticMarkup(
    createElement(PhaseTemplatePromptView, {
      prompt,
      importAction: async () => {},
      dismissAction: async () => {},
    })
  );
}

/** Undo React's HTML escaping, so an assertion can be written in the words a
 *  reader sees ("Children's Ministry", "Training & Preparation"). */
function decode(html: string): string {
  return html
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

/** Strip tags — what a reader actually sees. */
function textOf(html: string): string {
  return decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ");
}

function clickables(html: string): string[] {
  return [
    ...(html.match(/<button[^>]*>/g) ?? []),
    ...(html.match(/<input[^>]*type="checkbox"[^>]*>/g) ?? []),
    ...(html.match(/<label[^>]*>/g) ?? []),
  ];
}

test("every control carries cursor-pointer", () => {
  const html = render();
  const controls = clickables(html);

  // Two buttons, plus a checkbox and a label per checklist on offer.
  assert.equal(controls.length, 2 + promptData().offers.length * 2);

  for (const control of controls) {
    assert.match(
      control,
      /cursor-pointer/,
      `a control is missing cursor-pointer: ${control}`
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
    buildPhaseTemplatePrompt(
      {
        id: "11111111-1111-4111-8111-111111111111",
        fromPhase: 8,
        toPhase: 9,
        createdAt: TRANSITIONED_AT,
      },
      null
    ),
    null
  );
});
