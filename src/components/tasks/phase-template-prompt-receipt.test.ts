import assert from "node:assert/strict";
import { test } from "node:test";

import { PHASE_TEMPLATE_RECEIPT_COOKIE } from "@/lib/tasks/phase-prompt";
import { assertInOrder } from "@/lib/testing/source-span";

import { ClearReceiptCookie } from "./phase-template-prompt-controls";
import {
  CONTROLS_SOURCE_PATH,
  PROMPT_ACTIONS_SOURCE_PATH,
  PROMPT_SOURCE_PATH,
  TRANSITION_ID,
  elementsOfType,
  noopDismiss,
  noopImport,
  promptData,
  readSource,
} from "./phase-template-prompt-fixtures";
import {
  PhaseTemplatePartialReceiptView,
  PhaseTemplatePromptView,
} from "./phase-template-prompt";

// ----------------------------------------------------------------------------
// THE RECEIPT'S ROAD — press → flash cookie → the NEXT server render.
//
// A part-way import ANSWERS the transition, so the render that owes the planter
// a receipt is exactly the render with no prompt in it and no island left to
// hold state. The receipt therefore travels in a flash cookie and is drawn on
// the server. Three legs of that road live in this file, and none of them is
// visible in markup:
//
//   - what the two `"use server"` closures DO with a decision (they are
//     non-exported, so reading them is the only way to pin it);
//   - which loader branch reads the flash, and through which reader;
//   - how the flash is SPENT, by a component that renders `null`.
//
// The codec and `receiptForTransition` are pure and are asserted beside them in
// `src/lib/tasks/phase-prompt.test.ts`; the receipt's own markup is
// `phase-template-prompt.test.ts`.
// ----------------------------------------------------------------------------

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
  const action = readSource(PROMPT_ACTIONS_SOURCE_PATH);

  assert.match(action, /decidePhaseTemplateImportOutcome\(/);
  assert.match(action, /decidePhaseTemplateDismissOutcome\(/);

  // The receipt is written BEFORE the re-render that reads it, and that
  // re-render is not optional: `refresh()` follows, and setting a cookie in a
  // Server Action re-renders the route by itself.
  assertInOrder(
    action,
    PROMPT_ACTIONS_SOURCE_PATH,
    ["markPartialImportReceipt(decision.receipt)", "refresh();"],
    "the route is re-read before the receipt exists, so the render that has to draw it finds nothing"
  );

  // ONE transition id reaches these actions, and it answers one question:
  // did this press change the route. #411 deleted `fastPathTransitionId` and
  // the browser cookie that was its only reader — a year-long, browser-held
  // copy of an answer the PLANT owns, which could outlive a claim that
  // `acceptPhaseTemplatePrompt` releases and then hide a prompt the row says is
  // unanswered. Nothing here may write an answer to the browser again.
  assert.doesNotMatch(
    action,
    /fastPathTransitionId|markPromptAnswered|PHASE_TEMPLATE_PROMPT_COOKIE/,
    "the browser fast path is back: an answer this module writes to a cookie can suppress a prompt the database says is open, and there is no un-answer path"
  );

  const cookieWrites = action.match(/cookieStore\.set\(/g) ?? [];
  assert.equal(
    cookieWrites.length,
    1,
    "this module writes exactly one cookie — the two-minute partial-import receipt"
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
  const source = readSource(PROMPT_SOURCE_PATH);

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
  const island = readSource(CONTROLS_SOURCE_PATH);

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
  const server = readSource(PROMPT_SOURCE_PATH);
  assert.match(server, /data-testid="prompt-partial"/);
  assert.match(server, /<PhaseTemplatePartialReceiptView receipt=\{receipt\}/);
});

test("the island reaches the server module for TYPES ONLY", () => {
  // `phase-prompt.ts` imports `@/db`, whose module scope calls `neon()`. A
  // value import from this `"use client"` island would ship that to the browser
  // and kill /tasks on load — the outage `template-picker.bundle.test.ts`
  // documents. `import type` is erased, so it is safe and it is the only form
  // allowed here.
  const island = readSource(CONTROLS_SOURCE_PATH);

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
  const island = readSource(CONTROLS_SOURCE_PATH);

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
