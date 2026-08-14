import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DISMISS_FAILED_MESSAGE,
  IMPORT_FAILED_MESSAGE,
  NOTHING_IMPORTED_MESSAGE,
  NOTHING_TICKED_HINT,
  phaseTemplatePromptAlert,
  phaseTemplatePromptControlState,
  tickedTemplateCount,
} from "./phase-template-prompt-controls";
import {
  CONTROLS_SOURCE_PATH,
  IDLE_DISMISS,
  IDLE_IMPORT,
  alertCount,
  buttons,
  promptData,
  readSource,
  render,
  renderAlert,
  renderIsland,
  textOf,
} from "./phase-template-prompt-fixtures";

// ----------------------------------------------------------------------------
// THE ISLAND — the only client code the panel has.
//
// `useActionState` reports `pending: false` under `renderToStaticMarkup` no
// matter what, so every decision the two buttons render is a PURE function and
// is asserted as one here: which button is disabled, which reports itself busy,
// which sentence the one live region carries. What cannot be asserted in a test
// process — that the effect really re-reads the DOM after React restores it —
// is a browser assertion, and the source-level guard for it is below.
//
// The markup the island is wrapped in is `phase-template-prompt.test.ts`.
// ----------------------------------------------------------------------------

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
  const island = readSource(CONTROLS_SOURCE_PATH);

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
