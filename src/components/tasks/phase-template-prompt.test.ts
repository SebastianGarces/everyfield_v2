import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  buildPhaseTemplatePrompt,
  decidePhaseTemplateDismissOutcome,
  decidePhaseTemplateImportOutcome,
  phaseTemplatesFor,
  type AcceptPhaseTemplatePromptResult,
  type PhaseTemplatePrompt as PhaseTemplatePromptData,
} from "@/lib/tasks/phase-prompt";

import {
  DISMISS_FAILED_MESSAGE,
  IMPORT_FAILED_MESSAGE,
  NOTHING_IMPORTED_MESSAGE,
  NOTHING_TICKED_HINT,
  PhaseTemplatePromptForm,
  partialImportMessage,
  phaseTemplatePromptAlert,
  phaseTemplatePromptControlState,
  type PhaseTemplateDismissOutcome,
  type PhaseTemplateImportOutcome,
  type PhaseTemplatePromptPress,
} from "./phase-template-prompt-controls";
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
 * The island on its own, at a tick count and an outcome a full render cannot
 * reach.
 *
 * `useActionState` reports `pending: false` and holds its initial state under
 * `renderToStaticMarkup`, and the checkboxes are uncontrolled server markup —
 * so "no box is ticked" and "the import came back partial" are set here, at the
 * island's own props, rather than simulated.
 */
function renderIsland(
  overrides: {
    offerCount?: number;
    initialImportOutcome?: PhaseTemplateImportOutcome;
    initialDismissOutcome?: PhaseTemplateDismissOutcome;
    initialLastPress?: PhaseTemplatePromptPress;
  } = {}
): string {
  return renderToStaticMarkup(
    createElement(PhaseTemplatePromptForm, {
      offerCount: overrides.offerCount ?? 2,
      lead: null,
      children: null,
      importAction: noopImport,
      dismissAction: noopDismiss,
      initialImportOutcome: overrides.initialImportOutcome,
      initialDismissOutcome: overrides.initialDismissOutcome,
      initialLastPress: overrides.initialLastPress,
    })
  );
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
  const html = renderIsland({ initialImportOutcome: { status: "failed" } });

  assert.ok(textOf(html).includes(IMPORT_FAILED_MESSAGE));
  assert.match(html, /role="alert"/, "the failure is not announced");
  assert.equal(
    buttons(html).length,
    2,
    "a failure that created nothing must leave both answers pressable"
  );
});

test("a submit naming no live checklist is answered in words", () => {
  const html = renderIsland({ initialImportOutcome: { status: "nothing" } });

  assert.ok(textOf(html).includes(NOTHING_IMPORTED_MESSAGE));
  assert.match(html, /role="alert"/);
});

test("a failed decline is reported too", () => {
  const html = renderIsland({
    initialDismissOutcome: { status: "failed" },
    initialLastPress: "dismiss",
  });

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
    const html = renderIsland({
      initialImportOutcome: { status: "failed" },
      initialDismissOutcome: { status: "failed" },
      initialLastPress: lastPress,
    });

    assert.equal(
      alertCount(html),
      1,
      `both presses failed and last=${lastPress} announced ${alertCount(html)} times`
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
  const html = renderIsland({ initialImportOutcome: { status: "nothing" } });

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
// The decision seam (ruled 2026-08-12, round 3)
//
// All of this used to live inside `importPhaseTemplatesAction`, a non-exported
// `"use server"` closure that no test can call — so the branch that matters
// most had no coverage at all, and shipped a `revalidatePath("/tasks")` that
// unmounted the very receipt it was written to preserve.
// ----------------------------------------------------------------------------

const TRANSITION_ID = "22222222-2222-4222-8222-222222222222";

test("nothing answered leaves the prompt up and re-reads nothing", () => {
  // `null` is "no live prompt, or every requested key was forged" — and it is
  // also the empty tick list, which the action never sends to the service.
  const decision = decidePhaseTemplateImportOutcome(null);

  assert.deepEqual(decision.outcome, { status: "nothing" });
  assert.equal(decision.answeredTransitionId, null, "an unanswered prompt");
  assert.deepEqual(decision.revalidation, {
    refresh: false,
    revalidatePath: false,
  });
});

test("a PARTIAL import revalidates NOTHING, or the receipt is destroyed", () => {
  // THE REGRESSION THIS FILE EXISTS FOR. The claim is kept on a part-way
  // import, so /tasks re-rendered has no prompt in it and the island holding
  // the receipt unmounts. `refresh()` does that — and so does
  // `revalidatePath("/tasks")`, which for a Server Function "Updates the UI
  // immediately (if viewing the affected path)"
  // (.next-docs/01-app/03-api-reference/04-functions/revalidatePath.mdx), and
  // the planter IS on that path. /tasks is `force-dynamic`, so neither call
  // buys anything either.
  const result: AcceptPhaseTemplatePromptResult = {
    status: "partial",
    transitionId: TRANSITION_ID,
    importedOn: "2026-03-02",
    createdCount: 9,
    templateNames: ["Ministry Team Setup"],
  };

  const decision = decidePhaseTemplateImportOutcome(result);

  assert.deepEqual(decision.outcome, {
    status: "partial",
    createdCount: 9,
    templateNames: ["Ministry Team Setup"],
  });
  assert.equal(
    decision.revalidation.refresh,
    false,
    "a partial import called refresh() and took its own receipt down"
  );
  assert.equal(
    decision.revalidation.revalidatePath,
    false,
    "a partial import called revalidatePath('/tasks') — which re-renders /tasks immediately for a Server Function and unmounts the receipt"
  );
  assert.equal(
    decision.answeredTransitionId,
    TRANSITION_ID,
    "the claim is kept, so the cookie fast path must be written too"
  );
});

test("a clean import takes the prompt down and re-reads the list", () => {
  const decision = decidePhaseTemplateImportOutcome({
    status: "imported",
    transitionId: TRANSITION_ID,
    importedOn: "2026-03-02",
    createdCount: 22,
    templateNames: ["Ministry Team Setup", "Launch Prep"],
  });

  assert.deepEqual(decision.outcome, { status: "idle" });
  assert.deepEqual(decision.revalidation, {
    refresh: true,
    revalidatePath: true,
  });
  assert.equal(decision.answeredTransitionId, TRANSITION_ID);
});

test("a second press is a success that created nothing", () => {
  const decision = decidePhaseTemplateImportOutcome({
    status: "already_answered",
    transitionId: TRANSITION_ID,
  });

  assert.deepEqual(
    decision.outcome,
    { status: "idle" },
    "answering twice reported a failure the planter cannot act on"
  );
  assert.equal(
    decision.revalidation.refresh,
    true,
    "the prompt is answered and must come down"
  );
  assert.equal(decision.answeredTransitionId, TRANSITION_ID);
});

test("declining decides the same way, from a transition id or its absence", () => {
  const landed = decidePhaseTemplateDismissOutcome(TRANSITION_ID);
  assert.deepEqual(landed.outcome, { status: "idle" });
  assert.deepEqual(landed.revalidation, {
    refresh: true,
    revalidatePath: true,
  });
  assert.equal(landed.answeredTransitionId, TRANSITION_ID);

  // No transition to decline: the press changed nothing, which from the
  // planter's side IS a failure — and nothing is re-read, so nothing is lost.
  const missed = decidePhaseTemplateDismissOutcome(null);
  assert.deepEqual(missed.outcome, { status: "failed" });
  assert.deepEqual(missed.revalidation, {
    refresh: false,
    revalidatePath: false,
  });
  assert.equal(missed.answeredTransitionId, null);
});

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
  assert.equal(
    (action.match(/revalidatePath\("\/tasks"\)/g) ?? []).length,
    1,
    "revalidatePath is called somewhere other than the one directive-driven place"
  );
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
  // This panel is the only place the planter can be told, which is why it
  // replaces the offers rather than sitting under them.
  const html = renderIsland({
    initialImportOutcome: {
      status: "partial",
      createdCount: 9,
      templateNames: ["Ministry Team Setup"],
    },
  });
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
