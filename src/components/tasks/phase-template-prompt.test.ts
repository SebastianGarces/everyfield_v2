import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createElement, isValidElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PHASE_TEMPLATE_RECEIPT_COOKIE,
  buildPhaseTemplatePrompt,
  type PhaseTemplatePrompt as PhaseTemplatePromptData,
} from "@/lib/tasks/phase-prompt";
import { phaseTemplatesFor } from "@/lib/tasks/templates";

import {
  ClearReceiptCookie,
  DISMISS_FAILED_MESSAGE,
  IMPORT_FAILED_MESSAGE,
  NOTHING_IMPORTED_MESSAGE,
  NOTHING_TICKED_HINT,
  PhaseTemplatePromptAlert,
  PhaseTemplatePromptForm,
  phaseTemplatePromptAlert,
  phaseTemplatePromptControlState,
  tickedTemplateCount,
  type PhaseTemplateDismissOutcome,
  type PhaseTemplateImportOutcome,
} from "./phase-template-prompt-controls";
import {
  PhaseTemplatePartialReceiptView,
  PhaseTemplatePromptView,
  partialImportMessage,
} from "./phase-template-prompt";

// ----------------------------------------------------------------------------
// The prompt, rendered. DOM assertions, not source scans: the Cursor Pointer
// Rule is about what ships to a browser, so it is asserted on the markup a
// browser would receive.
//
// The view takes its data and its two actions as props, so this renders the
// real component with no session, no database and no phase transition.
// ----------------------------------------------------------------------------

const TRANSITIONED_AT = new Date("2026-03-02T09:15:00.000Z");

/** The transition every fixture here is answering. */
const TRANSITION_ID = "22222222-2222-4222-8222-222222222222";

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

const IDLE_IMPORT: PhaseTemplateImportOutcome = { status: "idle" };
const IDLE_DISMISS: PhaseTemplateDismissOutcome = { status: "idle" };

async function noopImport(): Promise<PhaseTemplateImportOutcome> {
  return IDLE_IMPORT;
}

async function noopDismiss(): Promise<PhaseTemplateDismissOutcome> {
  return IDLE_DISMISS;
}

function render(prompt: PhaseTemplatePromptData = promptData()): string {
  return renderToStaticMarkup(
    createElement(PhaseTemplatePromptView, {
      prompt,
      importAction: noopImport,
      dismissAction: noopDismiss,
    })
  );
}

/**
 * The island on its own, at a tick count a full render cannot reach.
 *
 * The checkboxes are uncontrolled server markup, so "no box is ticked" is set
 * here, at the island's own resting count, rather than simulated.
 *
 * THE OUTCOME MARKUP IS NOT REACHED THROUGH THIS. `useActionState` holds its
 * initial state under `renderToStaticMarkup`, and the island used to carry
 * three `initial*` props so a test could seed it — production scaffolding for
 * test reach. The two outcome surfaces are components now, rendered directly
 * below; what the island still decides is WHICH of them, and that decision is
 * `phaseTemplatePromptAlert`, asserted as the pure function it is.
 */
function renderIsland(overrides: { offerCount?: number } = {}): string {
  return renderToStaticMarkup(
    createElement(PhaseTemplatePromptForm, {
      transitionId: TRANSITION_ID,
      offerCount: overrides.offerCount ?? 2,
      children: null,
      importAction: noopImport,
      dismissAction: noopDismiss,
    })
  );
}

/** The one live region, on its own. */
function renderAlert(message: string): string {
  return renderToStaticMarkup(
    createElement(PhaseTemplatePromptAlert, { message })
  );
}

/**
 * The panel in its OTHER body: the receipt, rendered by the server component
 * from the flash cookie the action wrote.
 *
 * It takes no actions and no prompt, because by the time it renders there is
 * neither — which is the whole reason it is not island state.
 */
function renderReceipt(createdCount: number, templateNames: string[]): string {
  return renderToStaticMarkup(
    createElement(PhaseTemplatePartialReceiptView, {
      receipt: { transitionId: TRANSITION_ID, createdCount, templateNames },
    })
  );
}

/**
 * Every element of one component type in a returned tree, at any depth.
 *
 * A MARKUP ASSERTION CANNOT SEE `ClearReceiptCookie`: it renders `null`, so
 * `renderReceipt` produces the same HTML whether it is there or not. The flash
 * is spent by being shown, and "shown" means that component mounted — so the
 * only honest place to assert it is the element tree the server component
 * returns, before React throws the empty render away.
 */
function elementsOfType(
  node: ReactNode,
  type: unknown
): { props: Record<string, unknown> }[] {
  if (Array.isArray(node)) {
    return node.flatMap((child) => elementsOfType(child as ReactNode, type));
  }
  if (!isValidElement(node)) return [];

  const props = (node.props ?? {}) as Record<string, unknown>;
  const nested = elementsOfType((props.children ?? null) as ReactNode, type);

  return node.type === type ? [{ props }, ...nested] : nested;
}

/** How many `role="alert"` live regions the markup carries. */
function alertCount(html: string): number {
  return (html.match(/role="alert"/g) ?? []).length;
}

/** The `<button>` tags in document order — Import first, then Not now. */
function buttons(html: string): string[] {
  return html.match(/<button[^>]*>/g) ?? [];
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

/**
 * One `data-testid` block of the prompt, split into its tag and its contents.
 *
 * The structural rules below are about WHICH BLOCK a sentence lives in — the
 * lead or the fine print — not about how a block is styled. Anchored to the
 * serialized `class` attribute they broke whenever prettier reordered a
 * utility class; anchored to the seam they break only when a sentence actually
 * moves. The size token is still checked, but loosely, because "the fine print
 * is smaller than the lead" IS part of the rule.
 *
 * Neither seam nests a `<div>`, so "up to the next `</div>`" delimits it
 * exactly — and that is asserted, so the day one grows a wrapper this fails
 * loudly instead of silently measuring half a block.
 */
function seam(html: string, testId: string): { tag: string; inner: string } {
  const open = new RegExp(`<div[^>]*data-testid="${testId}"[^>]*>`).exec(html);
  assert.ok(open, `the ${testId} seam is missing`);

  const start = open.index + open[0].length;
  const end = html.indexOf("</div>", start);
  assert.ok(end > start, `the ${testId} seam is never closed`);

  const inner = html.slice(start, end);
  assert.ok(
    !inner.includes("<div"),
    `the ${testId} seam grew a nested <div>, so this helper no longer delimits it`
  );

  return { tag: open[0], inner };
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

// ----------------------------------------------------------------------------
// The submit guard (ruled 2026-08-10, PR #393)
//
// `useActionState` reports `pending: false` under `renderToStaticMarkup` no
// matter what, so the decision it feeds is a pure function and is asserted at
// every combination here. The wiring itself is a browser assertion.
// ----------------------------------------------------------------------------

const RESTING = {
  importPending: false,
  dismissPending: false,
  tickedCount: 2,
};

test("both buttons rest enabled, with the resting label", () => {
  assert.deepEqual(phaseTemplatePromptControlState(RESTING), {
    importDisabled: false,
    dismissDisabled: false,
    importing: false,
    dismissing: false,
    importLabel: "Import checklists",
    emptyHint: null,
  });
});

test("a request in flight disables both buttons", () => {
  for (const pending of ["importPending", "dismissPending"] as const) {
    const state = phaseTemplatePromptControlState({
      ...RESTING,
      [pending]: true,
    });

    assert.equal(
      state.importDisabled,
      true,
      `${pending} left the import live during the request`
    );
    assert.equal(
      state.dismissDisabled,
      true,
      `${pending} left the decline live during the request`
    );
  }
});

test("only the pressed button reports itself busy", () => {
  const importing = phaseTemplatePromptControlState({
    ...RESTING,
    importPending: true,
  });
  assert.equal(importing.importing, true);
  assert.equal(importing.dismissing, false);
  assert.equal(importing.importLabel, "Importing…");

  const dismissing = phaseTemplatePromptControlState({
    ...RESTING,
    dismissPending: true,
  });
  assert.equal(dismissing.dismissing, true);
  assert.equal(dismissing.importing, false);
  assert.equal(
    dismissing.importLabel,
    "Import checklists",
    "declining must not tell the planter something is being imported"
  );
});

test("neither button is busy when nothing is in flight", () => {
  const state = phaseTemplatePromptControlState(RESTING);

  assert.equal(state.importing, false);
  assert.equal(state.dismissing, false);
});

// ----------------------------------------------------------------------------
// The empty selection (ruled 2026-08-12, round 3 — "disable, not message")
//
// Unticking every box and pressing Import used to be a silent, feedback-free
// no-op, which also made the round-2 untick copy false. These pin that the
// state is now unreachable, and that it is explained rather than merely dead.
// ----------------------------------------------------------------------------

test("the zero-ticked state cannot produce a silent submit", () => {
  const state = phaseTemplatePromptControlState({ ...RESTING, tickedCount: 0 });

  assert.equal(
    state.importDisabled,
    true,
    "an empty selection can still be submitted"
  );
  assert.equal(
    state.emptyHint,
    NOTHING_TICKED_HINT,
    "an empty selection refuses the press without saying why"
  );
  assert.equal(
    state.dismissDisabled,
    false,
    "with Import refusing, Not now is the only way out and must stay live"
  );
});

test("one tick is enough to arm the import again", () => {
  const state = phaseTemplatePromptControlState({ ...RESTING, tickedCount: 1 });

  assert.equal(state.importDisabled, false);
  assert.equal(state.emptyHint, null);
});

// ----------------------------------------------------------------------------
// WHAT FEEDS THE COUNT — the round-3 exit defect
//
// `phaseTemplatePromptControlState` was correct at every input and still shipped
// a trap, because the INPUT was wrong: `tickedCount` had one writer, the
// bubbled `change`, and React 19 restores an uncontrolled form to its defaults
// after a `<form action>` settles WITHOUT firing one. Round 3 added three
// settled outcomes that leave the panel mounted, so after any of them the boxes
// were all ticked again while the count still held its pre-submit value — a
// disabled Import above three ticked checklists, and a retry that submitted
// checklists the planter had unticked.
//
// So these do not add a case over that pure function. They pin the two things
// that make its input trustworthy: the counter reads the very inputs the prompt
// renders and the action submits, and every settled outcome re-reads them.
// ----------------------------------------------------------------------------

/** A form that records what it was asked for and answers with a count. Enough
 *  for a function whose entire job is one `querySelectorAll`. */
function recordingForm(asked: string[], checked: number): HTMLFormElement {
  return {
    querySelectorAll(selector: string) {
      asked.push(selector);
      return { length: checked } as unknown as NodeListOf<Element>;
    },
  } as unknown as HTMLFormElement;
}

test("the tick counter counts the very inputs the prompt renders", () => {
  const asked: string[] = [];

  assert.equal(
    tickedTemplateCount(recordingForm(asked, 2)),
    2,
    "the counter does not report what the form says is checked"
  );
  assert.equal(asked.length, 1, "the counter reads the form more than once");

  // The count and the submitted payload have to be the SAME set, or a disabled
  // Import and an import of the wrong checklists are both one rename away.
  const name = /^input\[name="([^"]+)"\]:checked$/.exec(asked[0])?.[1];
  assert.ok(name, `the counter no longer selects checked inputs: ${asked[0]}`);

  const html = render();
  const rendered =
    html.match(new RegExp(`<input[^>]*name="${name}"[^>]*>`, "g")) ?? [];

  assert.equal(
    rendered.length,
    promptData().offers.length,
    `the counter selects name="${name}", which is not what the checklist rows render`
  );
  assert.ok(
    rendered.every((tag) => tag.includes("checked")),
    "the offers no longer arrive ticked, so the island's resting count is wrong"
  );
});

test("every settled outcome re-reads the boxes", () => {
  // Read as source, deliberately and narrowly — the same compromise the
  // receipt's early-return test makes, and for the same reason: the property is
  // about what React does to the DOM after an action settles, and this suite
  // has no client renderer to make it happen (`renderToStaticMarkup` never
  // settles anything). The behaviour itself is pinned in the browser gate,
  // where the defect was found: untick everything, force a settled failure, and
  // the boxes and the Import button must agree afterwards.
  //
  // What this catches is the regression that is actually likely — somebody
  // deleting the resync, or narrowing it to one of the two outcomes.
  const island = readFileSync(
    path.join(
      process.cwd(),
      "src/components/tasks/phase-template-prompt-controls.tsx"
    ),
    "utf8"
  );

  assert.match(
    island,
    /useEffect\(\(\) => \{[\s\S]*?setTickedCount\(tickedTemplateCount\(form\)\);[\s\S]*?\}, \[importOutcome, dismissOutcome\]\);/,
    "a settled import or dismiss no longer re-reads the checkboxes, so the count can go stale against a form React has reset"
  );
});

test("the hint is not offered while a request is in flight", () => {
  // Mid-request the button is inert because it is BUSY, not because the
  // selection is empty; two reasons on one control read as a contradiction.
  const state = phaseTemplatePromptControlState({
    importPending: true,
    dismissPending: false,
    tickedCount: 0,
  });

  assert.equal(state.importDisabled, true);
  assert.equal(state.emptyHint, null);
});

test("with nothing ticked the rendered Import button is disabled and explained", () => {
  const html = renderIsland({ offerCount: 0 });
  const [importButton, dismissButton] = buttons(html);

  assert.match(
    importButton,
    /disabled=""/,
    "the Import button accepts a press with no checklist ticked"
  );
  assert.doesNotMatch(
    dismissButton,
    /disabled=""/,
    "Not now went inert with the Import button, leaving no way out"
  );
  assert.ok(
    textOf(html).includes(NOTHING_TICKED_HINT),
    "the refusing button is not explained"
  );
  assert.match(
    html,
    /role="status"/,
    "the reason Import refuses is never announced"
  );
});

test("with every checklist ticked the Import button accepts the press", () => {
  const [importButton] = buttons(renderIsland({ offerCount: 3 }));

  assert.doesNotMatch(importButton, /disabled=""/);
  assert.ok(!renderIsland({ offerCount: 3 }).includes(NOTHING_TICKED_HINT));
});

test("the full prompt arms its Import button, because every box arrives ticked", () => {
  const [importButton] = buttons(render());

  assert.doesNotMatch(
    importButton,
    /disabled=""/,
    "the prompt renders refusing a press it has every reason to accept"
  );
});

// ----------------------------------------------------------------------------
// The failure paths (ruled 2026-08-12, round 3 — "both cases surface")
//
// Every outcome used to end in `console.error` and a `void` return. A press
// that writes 22–26 tasks may not fail into a log file.
// ----------------------------------------------------------------------------

test("a total failure is reported where the press happened", () => {
  // Two halves, asserted apart: WHICH sentence a failed import produces, and
  // that the sentence is announced when it is drawn.
  assert.equal(
    phaseTemplatePromptAlert({
      lastPress: "import",
      importOutcome: { status: "failed" },
      dismissOutcome: IDLE_DISMISS,
    }),
    IMPORT_FAILED_MESSAGE
  );

  const html = renderAlert(IMPORT_FAILED_MESSAGE);
  assert.ok(textOf(html).includes(IMPORT_FAILED_MESSAGE));
  assert.match(html, /role="alert"/, "the failure is not announced");

  assert.equal(
    buttons(renderIsland()).length,
    2,
    "a failure that created nothing must leave both answers pressable"
  );
});

test("a submit naming no live checklist is answered in words", () => {
  assert.equal(
    phaseTemplatePromptAlert({
      lastPress: "import",
      importOutcome: { status: "nothing" },
      dismissOutcome: IDLE_DISMISS,
    }),
    NOTHING_IMPORTED_MESSAGE
  );

  const html = renderAlert(NOTHING_IMPORTED_MESSAGE);
  assert.ok(textOf(html).includes(NOTHING_IMPORTED_MESSAGE));
  assert.match(html, /role="alert"/);
});

test("a failed decline is reported too", () => {
  assert.equal(
    phaseTemplatePromptAlert({
      lastPress: "dismiss",
      importOutcome: IDLE_IMPORT,
      dismissOutcome: { status: "failed" },
    }),
    DISMISS_FAILED_MESSAGE
  );

  const html = renderAlert(DISMISS_FAILED_MESSAGE);
  assert.ok(textOf(html).includes(DISMISS_FAILED_MESSAGE));
  assert.match(html, /role="alert"/);
});

// ----------------------------------------------------------------------------
// ONE live region, not three
//
// Each failure used to render its own `role="alert"` paragraph, independently.
// The two hooks keep their last result forever, so a failed import followed by
// a failed dismiss put TWO live regions on screen — two announcements for one
// press, the older describing a press already moved on from.
// ----------------------------------------------------------------------------

test("two failed presses never stack two live regions", () => {
  for (const lastPress of ["import", "dismiss"] as const) {
    // ONE sentence out of the decision, whichever pair of outcomes is on
    // record — the two hooks each keep their last result forever, so this is
    // the case that once put two regions on screen at the same time.
    const message = phaseTemplatePromptAlert({
      lastPress,
      importOutcome: { status: "failed" },
      dismissOutcome: { status: "failed" },
    });
    assert.ok(message, `last=${lastPress} announced nothing`);

    // …and drawing it produces exactly one region, never a second beside it.
    const html = renderAlert(message);
    assert.equal(
      alertCount(html),
      1,
      `last=${lastPress} announced ${alertCount(html)} times`
    );
  }
});

test("the live region carries the press the planter actually just made", () => {
  const bothFailed = {
    importOutcome: { status: "failed" },
    dismissOutcome: { status: "failed" },
  } as const;

  assert.equal(
    phaseTemplatePromptAlert({ ...bothFailed, lastPress: "import" }),
    IMPORT_FAILED_MESSAGE,
    "a failed Import reported the stale decline instead"
  );
  assert.equal(
    phaseTemplatePromptAlert({ ...bothFailed, lastPress: "dismiss" }),
    DISMISS_FAILED_MESSAGE,
    "a failed Not now reported the stale import instead"
  );
});

test("a successful press says nothing at all", () => {
  assert.equal(
    phaseTemplatePromptAlert({
      lastPress: "import",
      importOutcome: { status: "idle" },
      dismissOutcome: { status: "failed" },
    }),
    null,
    "an import that landed still announced an older decline failure"
  );
  assert.equal(alertCount(renderIsland()), 0, "the resting prompt announces");
});

test("an empty submit is announced through the same one region", () => {
  const message = phaseTemplatePromptAlert({
    lastPress: "import",
    importOutcome: { status: "nothing" },
    dismissOutcome: IDLE_DISMISS,
  });
  assert.equal(message, NOTHING_IMPORTED_MESSAGE);

  const html = renderAlert(message);
  assert.equal(alertCount(html), 1);
  assert.ok(textOf(html).includes(NOTHING_IMPORTED_MESSAGE));
});

// ----------------------------------------------------------------------------
// The empty hint is a live region, so it must exist BEFORE it has anything to
// say. A polite `role="status"` inserted together with its first message is
// commonly never announced — there is nothing for the assistive tech to diff.
// ----------------------------------------------------------------------------

test("the empty hint region is mounted from the first paint, silent", () => {
  const armed = renderIsland({ offerCount: 3 });

  assert.match(
    armed,
    /role="status"/,
    "the hint region only appears once it has something to say, so it is never announced"
  );
  assert.ok(
    !armed.includes(NOTHING_TICKED_HINT),
    "the armed prompt is explaining a refusal it is not making"
  );
});

test("no aria-describedby points at the hint, because it could never be read", () => {
  // It sat on the Import button, which is disabled for exactly as long as the
  // hint has anything to say — and a disabled button is not focusable.
  assert.ok(
    !renderIsland({ offerCount: 0 }).includes("aria-describedby"),
    "the dead aria-describedby is back on a button that cannot take focus"
  );
});

// ----------------------------------------------------------------------------
// The action performs the decision, it does not re-take it
//
// The decision seam itself is pure and lives in `src/lib/tasks/phase-prompt.ts`,
// asserted beside it in `phase-prompt.test.ts`. What belongs HERE is the wiring:
// both `"use server"` closures in this component are non-exported, so no test
// can call them and reading them is the only way to pin what they DO with a
// decision. That is how the partial case acquired a `revalidatePath("/tasks")`
// nobody could see, which unmounted the very receipt it was written to preserve.
// ----------------------------------------------------------------------------

test("the action performs the decision rather than re-deciding it", () => {
  // The seam only helps if the action still routes through it. Both branches
  // used to be written out inline, which is how the partial case acquired a
  // revalidation nobody could test.
  const action = readFileSync(
    path.join(process.cwd(), "src/components/tasks/phase-template-prompt.tsx"),
    "utf8"
  );

  assert.match(action, /decidePhaseTemplateImportOutcome\(/);
  assert.match(action, /decidePhaseTemplateDismissOutcome\(/);

  // The receipt is written BEFORE the answer cookie, because the answer cookie
  // is what triggers the re-render that reads the receipt.
  const receiptWrite = action.indexOf("markPartialImportReceipt(decision");
  const answerWrite = action.indexOf(
    "markPromptAnswered(decision.fastPathTransitionId)"
  );
  assert.ok(receiptWrite > 0, "the partial receipt is never written anywhere");
  assert.ok(
    answerWrite > 0,
    "the import action no longer mints the fast path from `fastPathTransitionId` — if it went back to `answeredTransitionId`, `already_answered` mints a cookie against a claim that may be released"
  );
  assert.ok(
    receiptWrite < answerWrite,
    "the answer cookie is set before the receipt, so the re-render it causes can read a receipt that is not there yet"
  );

  // The two fields are not interchangeable and NEITHER action may collapse them
  // back: `refresh()` hangs off `answeredTransitionId` (the route changed), the
  // cookie off `fastPathTransitionId` (this press owns the row nothing can take
  // away). Both presses can find a claim that is not their own — Import reports
  // `already_answered`, and so does a decline that lost the same race — and a
  // year-long cookie minted against a claim that is later released hides a
  // prompt the row says is unanswered (`memory/invariants.md` → Tasks).
  assert.equal(
    (
      action.match(/markPromptAnswered\(decision\.answeredTransitionId\)/g) ??
      []
    ).length,
    0,
    "an action is minting the fast path from the answered id again — that id only says the route changed, and it is set for `already_answered` too"
  );
  assert.equal(
    (
      action.match(/markPromptAnswered\(decision\.fastPathTransitionId\)/g) ??
      []
    ).length,
    2,
    "both actions mint the fast path through the field that means `this press owns its row`"
  );

  // `revalidatePath` is for OTHER pages (`memory/contracts/data-patterns.md`).
  // The planter answering this prompt is ON /tasks, which is force-dynamic, so
  // the house `refresh()` is the whole of what is owed.
  assert.equal(
    (action.match(/revalidatePath\(/g) ?? []).length,
    0,
    "revalidatePath is back on the route the planter is already standing on"
  );
  assert.equal(
    (action.match(/^\s*refresh\(\);$/gm) ?? []).length,
    2,
    "each action refreshes exactly once, and only when it answered something"
  );
});

// ----------------------------------------------------------------------------
// The receipt's road, where it passes through THIS file
//
// The codec and `receiptForTransition` are pure and are asserted in
// `src/lib/tasks/phase-prompt.test.ts`. What is asserted here is the loader:
// which branch looks for the flash, and which reader it asks for it.
// ----------------------------------------------------------------------------

test("no prompt is where the loader LOOKS for a receipt, not where it gives up", () => {
  // The loader's empty branch is the fix. A part-way import answers the
  // transition, so the prompt is correctly `null` on the very render that has
  // to carry the receipt — and `return null` there is exactly the silence that
  // shipped and failed its browser gate.
  const source = readFileSync(
    path.join(process.cwd(), "src/components/tasks/phase-template-prompt.tsx"),
    "utf8"
  );

  assert.match(
    source,
    /if \(!prompt\) \{[\s\S]*?receiptForTransition\([\s\S]*?PhaseTemplatePartialReceiptView[\s\S]*?\n {2}\}/,
    "an empty prompt goes straight back to null again, so a part-way import says nothing"
  );

  // And it asks the guarded reader, never the bare codec — `decodePartial…`
  // answers "is this a receipt", which is only half the question the loader has
  // to ask (see the test below).
  assert.doesNotMatch(
    source,
    /decodePartialImportReceipt\(/,
    "the loader decodes the flash without checking whose transition it is"
  );
});

test("the receipt is server markup — the island cannot outlive the answer", () => {
  // The island is inside the prompt, and answering the transition removes the
  // prompt from the next server render. Anything the planter must still be able
  // to read after an answer therefore cannot be island state, and this is the
  // assertion that stops it moving back.
  const island = readFileSync(
    path.join(
      process.cwd(),
      "src/components/tasks/phase-template-prompt-controls.tsx"
    ),
    "utf8"
  );

  assert.doesNotMatch(
    island,
    /"partial"/,
    "the partial import is being rendered from client state again"
  );
  assert.doesNotMatch(
    island,
    /data-testid="prompt-partial"/,
    "the receipt markup is back in the island the answer unmounts"
  );

  // …and it really is rendered on the server side, from the decoded cookie.
  const server = readFileSync(
    path.join(process.cwd(), "src/components/tasks/phase-template-prompt.tsx"),
    "utf8"
  );
  assert.match(server, /data-testid="prompt-partial"/);
  assert.match(server, /<PhaseTemplatePartialReceiptView receipt=\{receipt\}/);
});

test("the island reaches the server module for TYPES ONLY", () => {
  // `phase-prompt.ts` imports `@/db`, whose module scope calls `neon()`. A
  // value import from this `"use client"` island would ship that to the browser
  // and kill /tasks on load — the outage `template-picker.bundle.test.ts`
  // documents. `import type` is erased, so it is safe and it is the only form
  // allowed here.
  const island = readFileSync(
    path.join(
      process.cwd(),
      "src/components/tasks/phase-template-prompt-controls.tsx"
    ),
    "utf8"
  );

  const edges = [
    ...island.matchAll(
      /^\s*(?:import|export)\s+(\S+)[^;]*?\bfrom\s*["']@\/lib\/tasks\/phase-prompt["']/gm
    ),
  ];

  assert.ok(edges.length > 0, "the outcome types are no longer imported here");
  for (const [statement, firstWord] of edges) {
    assert.equal(
      firstWord,
      "type",
      `a VALUE import of the db-backed module ships neon() to the browser: ${statement.trim()}`
    );
  }
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

  const source = readFileSync(
    path.join(process.cwd(), "src/components/tasks/phase-template-prompt.tsx"),
    "utf8"
  );
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

// ----------------------------------------------------------------------------
// Spending the flash
//
// The transition id in the receipt closes ONE stale-alarm route: a receipt for
// transition A met by a render reporting on B. It closes nothing at all on the
// other route, which is a receipt for A met, again and again, by every later
// render that is STILL reporting on A — a reload, a filter change, or the visit
// after the planter has followed the link and imported the remainder, when
// "the remaining checklists were not created" is false in a `role="alert"`.
//
// What closes that one is `ClearReceiptCookie`, and it is invisible to every
// other test in this file: it renders `null`, so the receipt's HTML is byte for
// byte the same with it and without it.
// ----------------------------------------------------------------------------

test("the receipt spends its own flash — shown once, then gone", () => {
  const clears = elementsOfType(
    PhaseTemplatePartialReceiptView({
      receipt: {
        transitionId: TRANSITION_ID,
        createdCount: 9,
        templateNames: ["Ministry Team Setup"],
      },
    }),
    ClearReceiptCookie
  );

  assert.equal(
    clears.length,
    1,
    "the receipt never clears its cookie, so it re-alarms on every /tasks render until the flash expires"
  );
  assert.equal(
    clears[0].props.name,
    PHASE_TEMPLATE_RECEIPT_COOKIE,
    "the browser clears a different cookie than the loader reads, which deletes nothing and shows the receipt forever"
  );
});

test("the asking body spends no flash, because it is showing none", () => {
  // A live prompt WINS over a lingering receipt, and that receipt has not been
  // read yet — clearing it from this body would throw away a report the planter
  // is still owed, silently, in the one state that has no second chance.
  assert.equal(
    elementsOfType(
      PhaseTemplatePromptView({
        prompt: promptData(),
        importAction: noopImport,
        dismissAction: noopDismiss,
      }),
      ClearReceiptCookie
    ).length,
    0,
    "the prompt clears a receipt it never showed"
  );
});

test("the clear write expires the cookie the action set, not a namesake", () => {
  // A cookie is identified by name AND path. The action sets `path: "/"`, so a
  // `document.cookie` delete with no `Path` writes a second, path-scoped cookie
  // at `/tasks` and leaves the real one standing — the receipt then survives its
  // own clearing, which looks exactly like the clearing working.
  const island = readFileSync(
    path.join(
      process.cwd(),
      "src/components/tasks/phase-template-prompt-controls.tsx"
    ),
    "utf8"
  );

  const write = /document\.cookie\s*=\s*`([^`]*)`/.exec(island);
  assert.ok(write, "the flash is never cleared from the browser at all");

  const [, value] = write;
  assert.match(
    value,
    /^\$\{name\}=/,
    "the clear is not keyed on the name it was handed, so it cannot follow the cookie the loader reads"
  );
  assert.match(
    value,
    /Path=\//,
    "a delete with no Path leaves the /-scoped cookie standing"
  );
  assert.match(
    value,
    /Max-Age=0/,
    "the write re-arms the flash instead of expiring it"
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
