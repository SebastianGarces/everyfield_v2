import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  assertInOrder,
  sourceReader,
  stripComments,
} from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// THE CLICK THAT LEAVES OWNS NO SYNCHRONOUS WORK ON THE ROUTE IT IS LEAVING
// (#228, shipped as part of #308 WS2; corrected by #527)
//
// The defect: clicking a feed row marked it read and did not navigate. The row
// was un-bolded, the URL never changed, and the user sat on the feed looking at
// a notification they had just "opened". #228 saw it 1 in 5 and left it as
// possible noise; on #308's preview it reproduced on demand once the
// destination was not already prefetched, and four arrangements were measured:
//
//   transition + action `refresh()` (what shipped) ...... 22 of 22 stranded
//   no transition + action `refresh()` .................. 20 of 22 stranded
//   transition + no `refresh()` ......................... 11 of 11 stranded
//   neither ............................................. 22 of 22 navigated
//
// Both halves cause it, and for the same reason: each turns the click into work
// React owns on the route being LEFT, and either can supersede a push that has
// not committed.
//
// WHAT "NEITHER" ALSO DID (#527) is leave the bell reading its old number for
// the rest of the session — the destination shares the layout the bell lives in,
// and a client-side push reuses a shared layout rather than re-rendering it. So
// the reconcile has to come back, and #527 measured where it can go:
//
//   no reconcile at all (what shipped) ... 12/12 navigated, 0/12 count moved
//   refresh chained on the ACTION ........ 8 of 11 stranded
//   refresh chained on the PUSH (this) ... 12/12 navigated, 12/12 count moved
//
// The middle row is why "after the action" is not the same claim as "after the
// push": the action settles in 200-500 ms and the push commits in 180-430 ms, so
// they overlap. `whenPushCommits` waits for the URL to change instead.
//
// So the fix is a shape, and a shape is what a later edit re-breaks by accident
// — `markReadOnNavigate` looks like an oversight next to `markRead`, and "the
// action should refresh, per data-patterns.md" is a rule somebody will correctly
// quote at it.
//
// Hence a SOURCE-shaped test. This component is a client component and these
// actions are a `"use server"` module, so neither runs in this process; what
// can be checked is that the two paths still differ in the two specific ways
// the measurement says they must. Comments are stripped first, so the prose
// above — which names both forbidden calls repeatedly — cannot satisfy a match.
// ----------------------------------------------------------------------------

const FEED = path.join(
  process.cwd(),
  "src/components/notifications/notification-feed.tsx"
);
const ACTIONS = path.join(
  process.cwd(),
  "src/app/(dashboard)/notifications/actions.ts"
);

function reader(file: string, label: string) {
  return sourceReader(stripComments(readFileSync(file, "utf8")), label);
}

test("the row link's handler is not the button's", () => {
  const feed = reader(FEED, "notification-feed.tsx (stripped)");
  const row = feed.after("function NotificationRow");

  // The stretched link is the whole row's hit area, so this is the click that
  // navigates. It must go to the leaving handler.
  assert.match(row, /onClick=\{onMarkReadAndNavigate\}/);
  // …and the "Mark read" button, which stays, to the other one.
  assert.match(row, /onClick=\{onMarkRead\}/);
});

test("the leaving handler starts no transition and owns no synchronous work", () => {
  const feed = reader(FEED, "notification-feed.tsx (stripped)");
  const leaving = feed.span("const markReadOnNavigate", "const markAllRead");

  assert.doesNotMatch(
    leaving,
    /startTransition/,
    "a transition here entangles Link's push behind a suspended update — 11 of 11 stranded"
  );
  assert.doesNotMatch(
    leaving,
    /applyOptimistic/,
    "there is no optimistic row to hold on a page the user has left"
  );
  assert.match(leaving, /markNotificationReadAction\(id\)/);
});

test("the leaving handler refreshes only AFTER the push commits (#527)", () => {
  // The half of the #526 fix that went too far. Removing the refresh entirely
  // left the bell reading 25 for the rest of the session after a row click: the
  // destination shares the dashboard layout the bell lives in, and a client-side
  // push REUSES a common layout rather than re-rendering it, so nothing re-read
  // the badge on arrival. Measured on the pre-#527 preview: 12 of 12 navigated,
  // 0 of 12 decremented.
  //
  // Chaining the refresh on the ACTION is not the fix either — the action
  // settles in 200-500 ms and the push commits in 180-430 ms, so they overlap
  // and the refresh still supersedes the navigation (8 of 11 stranded). The
  // ordering that works is: wait for the URL to change, THEN refresh.
  //
  // Pinned as a shape, in order, because either link alone is one of the two
  // broken arrangements.
  const feed = reader(FEED, "notification-feed.tsx (stripped)");
  const leaving = feed.span("const markReadOnNavigate", "const markAllRead");

  assertInOrder(
    leaving,
    "markReadOnNavigate",
    [
      "markNotificationReadAction(id)",
      "whenPushCommits(",
      "router.refresh()",
      ".catch(",
    ],
    "the action, then the wait for the push, then the refresh, then the catch — any other order is one of the two arrangements that stranded the click"
  );

  assert.match(
    leaving,
    /\.then\(\(\) => whenPushCommits\(leaving\)\)\s*\.then\(\(\) => router\.refresh\(\)\)/,
    "the refresh no longer waits for the push to commit — an early one strands it"
  );

  // …and the wait is a real one: a URL comparison plus a frame, not a fixed
  // sleep somebody will shorten. The frame is the half that took the count from
  // 20 of 22 to 22 of 22 — without it the refresh lands inside the
  // destination's own render and is coalesced away.
  const wait = feed.span("function whenPushCommits", "function appendRows");
  assert.match(wait, /window\.location\.pathname !== from/);
  assert.match(
    wait,
    /requestAnimationFrame\([\s\S]*requestAnimationFrame\(/,
    "the wait no longer clears the destination's own render"
  );
});

test("the two presses that STAY are the ones that refresh", () => {
  const feed = reader(FEED, "notification-feed.tsx (stripped)");
  const markRead = feed.span("const markRead = ", "const markReadOnNavigate");
  const markAllRead = feed.span("const markAllRead", "return (");

  for (const [name, body] of [
    ["markRead", markRead],
    ["markAllRead", markAllRead],
  ] as const) {
    assert.match(body, /startTransition\(/, `${name} keeps its transition`);
    assert.match(
      body,
      /router\.refresh\(\)/,
      `${name} reconciles the layout's badge itself`
    );
  }
});

test("neither mark-read action refreshes on the server", () => {
  const actions = reader(ACTIONS, "notifications/actions.ts (stripped)");

  // The whole module, not one span: an import is enough to put it back within
  // reach of either export.
  assert.doesNotMatch(
    actions.code,
    /from "next\/cache"/,
    "the refresh belongs to the caller that stays (memory/invariants.md → Client/Server Data Synchronization)"
  );
  assert.doesNotMatch(actions.code, /\brefresh\(\)/);

  // The load-more action never refreshed and still must not: it adds rows to a
  // list the user is reading and would throw away the pages already loaded.
  assert.match(
    actions.code,
    /export async function loadMoreNotificationsAction/
  );
});
