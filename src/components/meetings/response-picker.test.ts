import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { sourceReader, stripComments } from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// VM-014 — a REFUSED response-card write is never silent.
//
// Both actions behind this control RETURN their failures (`ActionResult`) and
// neither revalidates on one. So discarding the result is not "no feedback" —
// it is WRONG feedback: the optimistic value paints, the transition ends,
// `useOptimistic` falls back to the unchanged prop, and the picker snaps back
// to the previous state with nothing said. On a data-entry control that reads
// as a mis-click, and the planter's most likely next move is to carry on
// believing the card was recorded.
//
// The path is reachable: `recordMeetingResponse`'s attendance guard refuses
// when the attendance row was removed in another tab, and the action turns that
// into `{ success: false, error: … }`.
//
// This is a SOURCE-shaped guard because the property is about what the
// transition body does with a promise — there is no rendered attribute to read
// and no settled DOM to assert on without a browser. `sourceReader` throws on a
// moved anchor rather than silently cutting the wrong span.
// ----------------------------------------------------------------------------

const PICKER = sourceReader(
  readFileSync(path.join(__dirname, "response-picker.tsx"), "utf8"),
  "meetings/response-picker.tsx"
);

/** The transition body — everything `onValueChange` runs. */
function handleChangeBody(): string {
  return stripComments(PICKER.span("const handleChange =", "return ("));
}

test("the picker raises a refused write instead of discarding the result", () => {
  const body = handleChangeBody();

  assert.match(
    body,
    /const result\s*=/,
    "the action result is thrown away — a refused write would revert in silence"
  );
  assert.match(
    body,
    /if \(!result\.success\) toast\.error\(result\.error\)/,
    "the failure must be raised, and it must carry the action's own sentence"
  );
});

test("both branches go through the one result check, not just the record path", () => {
  // The clear path refuses too (`Failed to clear the response card`), and a
  // control that reports one branch and swallows the other is worse than one
  // that reports neither: the silence becomes evidence of success.
  const body = handleChangeBody();

  assert.match(body, /clearResponseCardAction\(/);
  assert.match(body, /recordResponseCardAction\(/);
  assert.doesNotMatch(
    body,
    /^\s*await (clear|record)ResponseCardAction\(/m,
    "an action awaited as a bare statement is an action whose result is discarded"
  );
});

test("the message is raised through the root Toaster, never a local alert", () => {
  // The success path revalidates, and a message living inside the subtree that
  // re-render replaces is unmounted mid-read (memory/invariants.md →
  // Client/Server Data Synchronization). `sonner`'s toaster is a sibling
  // nothing here can unmount — the same import `EmailSuppressionNotice` uses.
  assert.match(PICKER.code, /import \{ toast \} from "sonner";/);
});
