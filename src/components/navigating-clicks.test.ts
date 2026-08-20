import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { sourceReader, stripComments } from "@/lib/testing/source-span";

// ----------------------------------------------------------------------------
// THE NAVIGATING-CLICK INVARIANT, ACROSS EVERY HANDLER THAT LEAVES
// (#228, minted by #308, swept by #529)
//
// memory/invariants.md → Client/Server Data Synchronization: a click that
// navigates must not own a transition or a refresh on the route being LEFT.
// Either turns the click into work React is still doing on the route the push is
// trying to replace, and either can supersede a push that has not committed.
// Measured on #308's preview: 22 of 22 stranded with the refresh, 11 of 11 with
// the transition, 22 of 22 navigated with neither.
//
// #308 wrote the rule and fixed ONE instance. The review found two live
// violations it had not swept — `TaskForm` (the full banned shape: a transition
// wrapping actions that each called `refresh()`, with the push inside the same
// transition) and `TemplateEditor` (`router.push` on one line, `router.refresh`
// on the next). This file is the sweep's ratchet, and it is a TABLE rather than
// three copies of one test, so the next handler that leaves is added as a row.
//
// WHY SOURCE-SHAPED. These are client components calling `"use server"` modules,
// so neither side runs in this process. What can be checked is that each leaving
// handler still has the shape the measurement says it must, and that the actions
// it reaches do not put the refresh back on the server side of the same call.
// Comments are stripped first, so the prose above — which names every forbidden
// call — cannot satisfy a match.
//
// NOT IN THIS TABLE: `notification-feed.tsx`'s `markReadOnNavigate`, which has
// its own file (`notification-feed.test.ts`) because it is the one leaving
// handler that must ALSO reconcile — its destination shares the layout holding
// the unread bell, so it refreshes once the push has committed and painted
// (#527). The rule here is the same rule; that handler just has a second half.
// ----------------------------------------------------------------------------

const SRC = process.cwd();

function reader(relativePath: string) {
  return sourceReader(
    stripComments(readFileSync(path.join(SRC, relativePath), "utf8")),
    `${path.basename(relativePath)} (stripped)`
  );
}

/** One handler that ends in a `router.push`, and the span that holds it. */
interface LeavingHandler {
  what: string;
  file: string;
  from: string;
  to: string;
  /** Where it sends the reader — asserted, so a row cannot go stale silently. */
  destination: string;
}

const LEAVING_HANDLERS: LeavingHandler[] = [
  {
    what: "TaskForm's submit",
    file: "src/components/tasks/task-form.tsx",
    from: "async function handleSubmit",
    to: "<form onSubmit",
    destination: '/tasks"',
  },
  {
    what: "TemplateEditor's Save",
    file: "src/app/(dashboard)/communication/templates/[id]/edit/template-editor.tsx",
    from: "const handleSave",
    to: "const handleReset",
    destination: '/communication/templates"',
  },
  {
    what: "TemplateEditor's Reset",
    file: "src/app/(dashboard)/communication/templates/[id]/edit/template-editor.tsx",
    from: "const handleReset",
    to: "const handleInsertMergeField",
    destination: '/communication/templates"',
  },
];

test("no handler that leaves owns a transition or a refresh", () => {
  for (const handler of LEAVING_HANDLERS) {
    const body = reader(handler.file).span(handler.from, handler.to);

    // The row is only meaningful if it still contains the push it is named for.
    assert.match(
      body,
      new RegExp(`router\\.push\\(["'].*${handler.destination}`),
      `${handler.what}: the span no longer pushes to ${handler.destination} — this row is stale`
    );

    assert.doesNotMatch(
      body,
      /startTransition/,
      `${handler.what}: a transition entangles the push behind an update suspended on a round-trip — 11 of 11 stranded`
    );
    assert.doesNotMatch(
      body,
      /router\.refresh\(\)/,
      `${handler.what}: a refresh re-renders the route the push is replacing — 22 of 22 stranded`
    );
  }
});

test("TaskForm's form is wired through onSubmit, not action", () => {
  // The subtle half of the sweep. `<form action={fn}>` runs `fn` inside a
  // transition REACT owns, so dropping `useTransition` while keeping `action`
  // would have left the push inside a transition and changed nothing. The
  // wiring is what puts it outside one, so the wiring is what is pinned.
  const form = reader("src/components/tasks/task-form.tsx");

  assert.match(form.code, /<form onSubmit=\{handleSubmit\}/);
  assert.doesNotMatch(
    form.code,
    /<form action=/,
    "the form is back on the action prop, which re-wraps the submit in React's own transition"
  );
  assert.doesNotMatch(
    form.code,
    /useTransition/,
    "the submit that leaves owns a transition again"
  );
});

test("the actions those handlers call do not refresh the route being left", () => {
  // The other side of the same call. The refresh belongs to the caller that
  // STAYS (memory/contracts/data-patterns.md), and neither of these actions has
  // one: `createTaskAction`/`updateTaskAction` are reached only by `TaskForm`,
  // which always navigates away.
  //
  // Span-scoped rather than module-wide, because `tasks/actions.ts` holds a
  // dozen other actions whose callers legitimately stay — completing a task from
  // its detail page is the obvious one — and they keep their `refresh()`.
  const tasks = reader("src/app/(dashboard)/tasks/actions.ts");

  for (const [action, to] of [
    [
      "export async function createTaskAction",
      "export async function quickAddTaskAction",
    ],
    [
      "export async function updateTaskAction",
      "export async function completeTaskAction",
    ],
  ] as const) {
    const body = tasks.span(action, to);

    assert.doesNotMatch(
      body,
      /\brefresh\(\)/,
      `${action}: its only caller leaves, so a refresh here re-renders a route nobody will be on`
    );
    // …and the half that SHOULD be there: the destination still gets freshened.
    assert.match(
      body,
      /revalidatePath\("\/tasks"\)/,
      `${action}: the list the planter lands on is no longer revalidated`
    );
  }

  // The template actions never had a server-side refresh, and must not grow one.
  const communication = reader("src/app/(dashboard)/communication/actions.ts");
  assert.doesNotMatch(communication.code, /\brefresh\(\)/);
  assert.match(
    communication.code,
    /revalidatePath\("\/communication\/templates"\)/
  );
});
