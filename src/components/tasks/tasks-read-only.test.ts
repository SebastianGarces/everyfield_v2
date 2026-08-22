import assert from "node:assert/strict";
import { test } from "node:test";

import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement, type ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { TaskDetailActions } from "@/app/(dashboard)/tasks/[id]/task-detail-actions";
import { ViewerCapabilitiesProvider } from "@/components/shared/viewer-capabilities";
import type { Task } from "@/db/schema";
import type { Capability } from "@/lib/auth/seat-rules";
import type { TaskListRow } from "@/lib/tasks/service";
import type { TaskWithAssignee } from "@/lib/tasks/types";
import { namedButtons, parseElements } from "@/lib/testing/rendered-markup";

import { SubtaskList } from "./subtask-list";
import { TaskList } from "./task-list";
import { TaskQuickAdd } from "./task-quick-add";
import { TaskTemplatePicker } from "./template-picker";

// ----------------------------------------------------------------------------
// THE TASK SURFACES IN A READ-ONLY CONTEXT — AS-020 (#499), row 7 of the FRD's
// read-only surface checklist.
//
// THE RULE UNDER TEST IS AN ABSENCE, which is why every assertion reads RENDERED
// MARKUP rather than the source. A `disabled` checkbox is still in the DOM,
// still reads out to a screen reader, and still tells a Member that a control
// exists which somebody else may press. A source scan for the word "Complete"
// cannot tell a hide from a disable; a scan of the markup for the CONTROL can.
//
// …AND THIS SURFACE HAS A SURVIVOR, WHICH IS THE HARDER HALF. Tasks is the only
// row of the checklist where a write control legitimately stays for a Member:
// `completeTaskAction`, `reopenTaskAction` and `setSubtaskCompletionAction` are
// `tasks.own`, a SEATED verb a Member HOLDS, and their subject half is checked
// server-side by `assertMayActOnTask` — `assignedToId === actor.id ||
// holdsSeatFor(actor, "tasks.write")`. So the same row renders its checkbox for
// the person it is assigned to and renders none for anybody else without the
// seat, and BOTH of those are asserted below. Hiding a Member's own task from
// them would be an over-hide, which drifts from the server exactly as far as an
// under-hide does.
//
// THE VERB IS NEVER DECIDED HERE. `capabilities` is typed `Capability`, whose
// members come from `CAPABILITIES` in `@/lib/auth/seat-rules` — the same table
// `requireSeat` refuses the POST with. This file asserts the transport works,
// not what the rule should be.
//
// WHAT THIS FILE DOES NOT CLAIM. None of it is authorization. `requireSeat`
// refuses every one of these actions whether or not its control ever rendered,
// and `seat-guard.test.ts` is what asserts that. A hidden control is a statement
// about what somebody is ASKED to do.
// ----------------------------------------------------------------------------

/** The plant Member: a seat in the plant, and none of the write verbs. */
const READ_ONLY: readonly Capability[] = [];

/** An Admin, as far as Task Management is concerned. */
const WRITER: readonly Capability[] = ["tasks.write"];

const VIEWER_ID = "00000000-0000-4000-8000-0000000000v1";
const SOMEBODY_ELSE = "00000000-0000-4000-8000-0000000000e1";
const CHURCH_ID = "00000000-0000-4000-8000-0000000000c1";
const TASK_ID = "00000000-0000-4000-8000-0000000000t1";

/**
 * A router that refuses every call. A STATIC render fires no handler, so nothing
 * here is ever reached — its job is to satisfy the `useRouter` mount invariant
 * `TaskDetailActions` hits at render time. Throwing rather than no-op'ing means
 * a render that DID navigate would say so instead of passing silently.
 */
const STUB_ROUTER = new Proxy({} as never, {
  get() {
    return () => {
      throw new Error("a static render must not navigate");
    };
  },
});

/** Render `element` as the viewer holding exactly `capabilities`. */
function renderAs(
  capabilities: readonly Capability[],
  element: ReactElement
): string {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: STUB_ROUTER },
      createElement(ViewerCapabilitiesProvider, {
        capabilities,
        children: element,
      })
    )
  );
}

/** Every control's accessible name — what identifies the verb on offer. */
function controlLabels(html: string): string[] {
  return namedButtons(html).map((button) => button.attrs["aria-label"]);
}

/**
 * The assertion every case in this file shares.
 *
 * `disabled` is checked on the read-only render as well as the needle, because
 * the failure this issue exists to remove is a control that stays in the markup
 * greyed out — and that would pass a bare "the label is gone" check if the label
 * moved into an aria attribute.
 */
function assertHidden(
  hiddenHtml: string,
  shownHtml: string,
  needle: string | RegExp,
  what: string
) {
  const pattern = typeof needle === "string" ? new RegExp(needle) : needle;

  assert.doesNotMatch(
    hiddenHtml,
    pattern,
    `AS-020: ${what} must be ABSENT from a read-only viewer's markup, not disabled`
  );
  assert.match(
    shownHtml,
    pattern,
    `${what} must still render for somebody holding the verb — hiding it from them would be stricter than the server`
  );
}

// ----------------------------------------------------------------------------
// Fixtures
// ----------------------------------------------------------------------------

const NOW = new Date("2026-03-02T09:15:00.000Z");

/**
 * One list row, assigned to whoever the case is about.
 *
 * TYPED, NOT CAST. `assignedToId` is the field every assertion in this file
 * turns on, so a row shape that drifted out from under the compiler is exactly
 * the thing that would make these tests describe a component nobody renders.
 */
function taskRow(assignedToId: string | null): TaskListRow {
  return {
    id: TASK_ID,
    churchId: CHURCH_ID,
    title: "Book the school hall",
    description: null,
    descriptionPreview: null,
    status: "not_started",
    priority: "medium",
    category: "facilities",
    dueDate: "2026-03-09",
    dueTime: null,
    completedAt: null,
    completedById: null,
    completionEvent: null,
    assignedToId,
    assigneeName: null,
    assigneeEmail: null,
    createdById: SOMEBODY_ELSE,
    relatedType: null,
    relatedId: null,
    parentTaskId: null,
    isRecurring: false,
    recurrenceRule: null,
    isBlocked: false,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function taskList(
  capabilities: readonly Capability[],
  assignedToId: string | null
): string {
  return renderAs(
    capabilities,
    createElement(TaskList, {
      tasks: [taskRow(assignedToId)],
      total: 1,
      nextCursor: null,
      searchParams: {},
      now: NOW,
      currentUserId: VIEWER_ID,
    })
  );
}

// ----------------------------------------------------------------------------
// The list — creating, selecting, bulk-acting
// ----------------------------------------------------------------------------

test("a read-only viewer is offered no way to create a task", () => {
  const asMember = renderAs(READ_ONLY, createElement(TaskQuickAdd, {}));
  const asAdmin = renderAs(WRITER, createElement(TaskQuickAdd, {}));

  assertHidden(asMember, asAdmin, "Quick Add", "the quick-add control");
  assert.equal(
    asMember,
    "",
    "AS-020: quick add is the whole component — a read-only viewer gets no markup from it at all"
  );
});

test("the selection machinery is absent, so the bulk bar can never appear", () => {
  // BOTH HALVES GO, and that is a judgement about the MECHANISM rather than
  // about either button on the bar. `bulkCompleteTasksAction` is `tasks.own`
  // and `bulkRescheduleTasksAction` is `tasks.write`; one multi-select drives
  // both, so a viewer who may only ever press one of them is being offered a
  // batch whose second answer is a refusal. Completing one at a time survives —
  // see the survivor test below.
  const asMember = taskList(READ_ONLY, VIEWER_ID);
  const asAdmin = taskList(WRITER, VIEWER_ID);

  assertHidden(
    asMember,
    asAdmin,
    'data-testid="task-select"',
    "the per-row selection checkbox"
  );
  assertHidden(
    asMember,
    asAdmin,
    'data-testid="task-group-select-all"',
    "the group select-all checkbox"
  );
});

test("the empty state states the fact instead of asking for a create", () => {
  const empty = {
    tasks: [],
    total: 0,
    nextCursor: null,
    searchParams: {},
    now: NOW,
    currentUserId: VIEWER_ID,
  };
  const asMember = renderAs(READ_ONLY, createElement(TaskList, empty));
  const asAdmin = renderAs(WRITER, createElement(TaskList, empty));

  assert.doesNotMatch(
    asMember,
    /Add a new task to get started/,
    "recipe rule 4: the read-only copy must not ask for an action the viewer cannot take"
  );
  assert.match(
    asAdmin,
    /Add a new task to get started/,
    "somebody who may create one still gets the invitation"
  );
  assert.match(
    asMember,
    /admins create tasks and assign them/,
    "the read-only copy names who does create tasks"
  );
  assert.ok(
    asMember.includes("No tasks found"),
    "the FACT is not what is hidden — the viewer still learns the list is empty"
  );
});

// ----------------------------------------------------------------------------
// THE SURVIVOR — a Member's own assigned task keeps its complete control
// ----------------------------------------------------------------------------

test("a Member's OWN task still offers the complete checkbox", () => {
  // THE MOST IMPORTANT ASSERTION IN THIS FILE. `completeTaskAction` is
  // `tasks.own`, which a Member holds, and `assertMayActOnTask` admits the
  // assignee — so hiding this would refuse in the UI what the server allows.
  const html = taskList(READ_ONLY, VIEWER_ID);

  assert.ok(
    controlLabels(html).includes("Complete task"),
    "AS-006/AS-020: the person a task is assigned to keeps the control that finishes it, seat or no seat"
  );
});

test("…and somebody else's task offers them none", () => {
  const html = taskList(READ_ONLY, SOMEBODY_ELSE);

  assert.deepEqual(
    controlLabels(html),
    [],
    "a Member may not complete a task assigned to somebody else — `assertMayActOnTask` refuses it, so it is not offered"
  );
  assert.doesNotMatch(
    html,
    /<button[^>]*\bdisabled\b/,
    "AS-020: hidden means absent — a disabled checkbox still announces the control"
  );

  // THE ROW ITSELF IS NOT WHAT IS HIDDEN. A Member reads the whole list; it is
  // the CONTROL on somebody else's row that is absent.
  assert.ok(
    html.includes("Book the school hall"),
    "the task still renders — only its control is gone"
  );
});

test("an Admin keeps the complete control on every row, not only their own", () => {
  assert.ok(
    controlLabels(taskList(WRITER, SOMEBODY_ELSE)).includes("Complete task"),
    "`tasks.write` carries the whole plant's tasks (mayActOnTask's second clause)"
  );
});

// ----------------------------------------------------------------------------
// The detail view — Complete/Reopen survive on an own task, Delete never does
// ----------------------------------------------------------------------------

function detailActions(
  capabilities: readonly Capability[],
  assignedToId: string | null
): string {
  // `TaskListRow` extends `Task`, so the list fixture is the detail view's row
  // too — no cast, and one shape for both halves of the surface.
  const task: Task = taskRow(assignedToId);

  return renderAs(
    capabilities,
    createElement(TaskDetailActions, { task, currentUserId: VIEWER_ID })
  );
}

test("Delete is hidden from a Member — including on their own task", () => {
  // The two verbs on this one row of buttons are DIFFERENT. Deleting is
  // `tasks.write`, so owning the task buys nothing here.
  assertHidden(
    detailActions(READ_ONLY, VIEWER_ID),
    detailActions(WRITER, VIEWER_ID),
    ">Delete<",
    "the Delete button"
  );
});

test("Complete survives on a Member's own task and is absent on another's", () => {
  assert.match(
    detailActions(READ_ONLY, VIEWER_ID),
    />Complete</,
    "AS-006: the assignee finishes their own work from the detail view too"
  );
  assert.doesNotMatch(
    detailActions(READ_ONLY, SOMEBODY_ELSE),
    />Complete</,
    "somebody else's task offers a Member no completion control"
  );
  assert.equal(
    detailActions(READ_ONLY, SOMEBODY_ELSE).includes("<button"),
    false,
    "AS-020: with neither verb the action row carries no button at all"
  );
});

// ----------------------------------------------------------------------------
// The checklist — two `tasks.own` controls with two different subjects
// ----------------------------------------------------------------------------

const SUBTASK_ID = "00000000-0000-4000-8000-0000000000s1";

/**
 * The step's OWN tick, addressed by the step's id.
 *
 * Not `/id="subtask-/`: the add form's text input is `id="subtask-title"`, so
 * that pattern matches the control this test is trying to prove absent and
 * passes for the wrong reason.
 */
const SUBTASK_TICK = new RegExp(`id="subtask-${SUBTASK_ID}"`);

/** The add form's field, under the name `addSubtaskAction` reads. */
const ADD_STEP = /name="title"/;

function subtask(assignedToId: string | null): TaskWithAssignee {
  return {
    ...taskRow(assignedToId),
    id: SUBTASK_ID,
    title: "Call the caretaker",
    parentTaskId: TASK_ID,
  };
}

function subtaskList(
  capabilities: readonly Capability[],
  subtaskOwner: string | null,
  parentOwner: string | null
): string {
  return renderAs(
    capabilities,
    createElement(SubtaskList, {
      parentTaskId: TASK_ID,
      subtasks: [subtask(subtaskOwner)],
      currentUserId: VIEWER_ID,
      parentAssignedToId: parentOwner,
    })
  );
}

test("a subtask tick follows the SUBTASK's assignee, not the parent's", () => {
  // `setSubtaskCompletionAction` loads the subtask and calls `completeTask` on
  // THAT row, so the subject is the subtask. A Member who owns the parent but
  // not this step is refused by the server, and so is not offered the box.
  assert.match(
    subtaskList(READ_ONLY, VIEWER_ID, SOMEBODY_ELSE),
    SUBTASK_TICK,
    "the step assigned to the viewer keeps its checkbox"
  );
  assert.doesNotMatch(
    subtaskList(READ_ONLY, SOMEBODY_ELSE, VIEWER_ID),
    SUBTASK_TICK,
    "owning the PARENT does not buy the tick on a step assigned to somebody else"
  );

  assert.ok(
    subtaskList(READ_ONLY, SOMEBODY_ELSE, VIEWER_ID).includes(
      "Call the caretaker"
    ),
    "the step itself is a read — it is the CONTROL that is absent"
  );
});

test("adding a subtask follows the PARENT's assignee, not the step's", () => {
  // `addSubtaskAction` loads the parent and asserts against it: a step is work
  // on that task, so the task's owner may add one.
  assert.match(
    subtaskList(READ_ONLY, SOMEBODY_ELSE, VIEWER_ID),
    ADD_STEP,
    "the parent's owner may break their own task into steps"
  );
  assert.doesNotMatch(
    subtaskList(READ_ONLY, VIEWER_ID, SOMEBODY_ELSE),
    ADD_STEP,
    "owning one STEP does not buy the right to add steps to somebody else's task"
  );
});

test("an Admin gets both checklist controls on anybody's task", () => {
  const html = subtaskList(WRITER, SOMEBODY_ELSE, SOMEBODY_ELSE);

  assert.match(html, SUBTASK_TICK, "`tasks.write` ticks any step");
  assert.match(html, ADD_STEP, "`tasks.write` adds a step to any task");
});

test("a viewer with neither subject is left no disabled control either", () => {
  // AS-020's actual rule, on the one surface where an ownership test decides
  // it: absence, not a greyed-out box.
  assert.doesNotMatch(
    subtaskList(READ_ONLY, SOMEBODY_ELSE, SOMEBODY_ELSE),
    /<button[^>]*\bdisabled\b/,
    "a disabled checkbox still announces a control the viewer may not use"
  );
});

// ----------------------------------------------------------------------------
// The template catalog
// ----------------------------------------------------------------------------

test("the checklist catalog offers no import control without the verb", () => {
  const asMember = renderAs(READ_ONLY, createElement(TaskTemplatePicker, {}));
  const asAdmin = renderAs(WRITER, createElement(TaskTemplatePicker, {}));

  assert.deepEqual(
    controlLabels(asMember),
    [],
    "AS-020: every row's Import button is absent — `importTaskTemplateAction` is `tasks.write`"
  );
  assert.ok(
    controlLabels(asAdmin).length > 0,
    "the imports come back for somebody holding the verb"
  );
  assert.deepEqual(
    parseElements(asMember).filter((el) => el.tag === "button"),
    [],
    "and not one of them survives as a disabled button"
  );
});
