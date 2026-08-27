import assert from "node:assert/strict";
import { test } from "node:test";

import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RICH_TEXT_CONTROLS } from "@/components/shared/rich-text-editor-controls";
import type { Task } from "@/db/schema";
import {
  namedButtons,
  parseElements,
  type RenderedElement,
} from "@/lib/testing/rendered-markup";

import {
  TaskDescriptionField,
  TaskForm,
  TaskPrerequisitesField,
} from "./task-form";

// ----------------------------------------------------------------------------
// The task description field (T-021), asserted against the markup the browser
// actually receives — the same approach `rich-text-editor.test.ts` takes, over
// the same shared reader (`src/lib/testing/rendered-markup.ts`), and for the
// same reason: a contract made entirely of attributes and class names does not
// need a jsdom.
//
// `TaskForm` itself cannot be rendered here (it calls `useRouter`, which throws
// outside a mounted app router), which is exactly why the description field is
// its own exported component. Everything worth pinning lives in this subtree:
//
//   * every editor control the toolbar offers is rendered and named
//   * the description reaches the request as HTML, under the name the server
//     action already reads
//   * a description written before T-021 loads into the editor as text, not as
//     a paragraph of escaped tags
// ----------------------------------------------------------------------------

function render(value = "") {
  return renderToStaticMarkup(
    createElement(TaskDescriptionField, { value, onChange: () => {} })
  );
}

function hiddenDescriptionInput(html: string): RenderedElement | undefined {
  return parseElements(html).find(
    (el) => el.tag === "input" && el.attrs["name"] === "description"
  );
}

test("the toolbar renders one named control per editor command", () => {
  // The cursor loop that used to sit here is gone (#502): these controls are
  // native <button>s, so globals.css gives them the pointer.
  const buttons = namedButtons(render());

  assert.equal(buttons.length, RICH_TEXT_CONTROLS.length);
});

test("bold, italic, links and both lists are all reachable", () => {
  const labels = namedButtons(render()).map((b) => b.attrs["aria-label"]);

  for (const required of [
    "Bold",
    "Italic",
    "Link",
    "Bulleted list",
    "Numbered list",
  ]) {
    assert.ok(
      labels.includes(required),
      `${required} missing from the toolbar`
    );
  }
});

test("the description is a named, multiline textbox", () => {
  const textbox = parseElements(render()).find(
    (el) => el.attrs["role"] === "textbox"
  );

  assert.ok(textbox, "no textbox role in the rendered field");
  assert.equal(textbox.attrs["aria-multiline"], "true");
  assert.equal(textbox.attrs["contenteditable"], "true");
  assert.equal(textbox.attrs["id"], "description");
  // A `<Label htmlFor>` does not associate with a div, so the name is wired
  // the other way. Losing this leaves the field anonymous to a screen reader.
  assert.equal(textbox.attrs["aria-labelledby"], "description-label");
});

test("the description travels in the form under the name the server reads", () => {
  const input = hiddenDescriptionInput(
    render("<p>Call <strong>Bob</strong></p>")
  );

  assert.ok(input, "no hidden input carrying the description");
  assert.equal(input.attrs["type"], "hidden");
  // The editor is a contentEditable div and submits nothing on its own; this
  // input is the whole reason the description reaches `FormData`.
  assert.equal(
    input.attrs["value"],
    "&lt;p&gt;Call &lt;strong&gt;Bob&lt;/strong&gt;&lt;/p&gt;"
  );
});

test("an empty description still submits the field, so a cleared one clears", () => {
  const input = hiddenDescriptionInput(render(""));

  assert.ok(input, "no hidden input on an empty description");
  assert.equal(input.attrs["value"], "");
});

test("the placeholder shows only while there is nothing to read", () => {
  assert.ok(render("").includes("Add details about this task..."));
  // `<p><br></p>` is an emptied editor, not content.
  assert.ok(render("<p><br></p>").includes("Add details about this task..."));
  assert.ok(!render("<p>Book the room</p>").includes("Add details about this"));
});

// ----------------------------------------------------------------------------
// Prerequisites (T-015). Same reason the description field is exported: the
// form around it cannot be rendered here, and the contract is attributes.
// ----------------------------------------------------------------------------

const PREREQ_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PREREQ_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function renderPrereqs(selectedIds: string[] = [PREREQ_A]) {
  return renderToStaticMarkup(
    createElement(TaskPrerequisitesField, {
      candidates: [
        { id: PREREQ_A, title: "Book the room", status: "not_started" },
        { id: PREREQ_B, title: "Confirm the speaker", status: "complete" },
      ],
      selectedIds,
    })
  );
}

test("prerequisite ids travel in the form under the name the server reads", () => {
  const input = parseElements(renderPrereqs()).find(
    (el) => el.tag === "input" && el.attrs["name"] === "prerequisiteTaskIds"
  );

  assert.ok(input, "no hidden input carrying the prerequisite ids");
  assert.equal(input.attrs["type"], "hidden");
  assert.equal(input.attrs["value"], PREREQ_A);
});

test("a selected prerequisite can be removed, and another can be added", () => {
  const html = renderPrereqs();
  const buttons = namedButtons(html);
  assert.ok(
    buttons.length >= 1,
    "the selected prerequisite has no named remove control"
  );

  const trigger = parseElements(html).find(
    (el) => el.attrs["data-slot"] === "select-trigger"
  );
  assert.ok(trigger, "no select trigger to add a prerequisite");
});

// ----------------------------------------------------------------------------
// Field names and descriptions. `SelectTrigger` is a button with combobox
// semantics, so the visible `<Label>` must be its ARIA name as well as sharing
// its id. The router provider lets this render exercise the complete form
// without allowing a static render to navigate.
// ----------------------------------------------------------------------------

const STATIC_ROUTER = new Proxy({} as never, {
  get() {
    return () => {
      throw new Error("a static render must not navigate");
    };
  },
});

const FOLLOW_UP_RECURRING_TASK: Task = {
  id: "22222222-2222-4222-8222-222222222222",
  churchId: "33333333-3333-4333-8333-333333333333",
  title: "Follow up with Avery",
  description: null,
  status: "not_started",
  priority: "medium",
  dueDate: "2026-09-01",
  dueTime: null,
  assignedToId: null,
  category: "follow_up",
  relatedType: null,
  relatedId: null,
  parentTaskId: null,
  isRecurring: true,
  recurrenceRule: {
    interval: "weekly",
    endDate: "2026-12-31",
    seriesId: "22222222-2222-4222-8222-222222222222",
  },
  completionEvent: null,
  completedAt: null,
  completedById: null,
  createdById: "44444444-4444-4444-8444-444444444444",
  createdAt: new Date("2026-08-27T12:00:00.000Z"),
  updatedAt: new Date("2026-08-27T12:00:00.000Z"),
  deletedAt: null,
};

const AVERY = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Avery Planter",
  email: "avery@example.com",
};

function renderTaskForm({
  followUpAssignees = [AVERY],
}: {
  followUpAssignees?: (typeof AVERY)[];
} = {}) {
  return renderToStaticMarkup(
    createElement(
      AppRouterContext.Provider,
      { value: STATIC_ROUTER },
      createElement(TaskForm, {
        task: FOLLOW_UP_RECURRING_TASK,
        users: [AVERY],
        followUpAssignees,
        prerequisiteCandidates: [
          {
            id: PREREQ_A,
            title: "Book the room",
            status: "not_started",
          },
        ],
      })
    )
  );
}

test("task form labels every select and keeps its help text as a description", () => {
  const elements = parseElements(renderTaskForm());
  const renderedIds = elements
    .map((element) => element.attrs.id)
    .filter(Boolean);
  const ids = new Set(renderedIds);

  assert.equal(
    ids.size,
    renderedIds.length,
    "every nonempty id in the rendered form must be unique"
  );

  for (const id of ["status", "priority", "category", "assignedToId"]) {
    const control = elements.find((element) => element.attrs.id === id);
    assert.ok(control, `${id} trigger is missing`);
    assert.equal(control.attrs["aria-labelledby"], `${id}-label`);
    assert.ok(
      ids.has(control.attrs["aria-labelledby"]),
      `${id} is named by a missing label`
    );
  }

  const prerequisites = elements.find(
    (element) => element.attrs["aria-labelledby"] === "prerequisites-label"
  );
  assert.ok(prerequisites, "prerequisite picker is unnamed");
  assert.equal(
    prerequisites.attrs["aria-describedby"],
    "prerequisites-description"
  );

  const repeat = elements.find(
    (element) => element.attrs.id === "recurrenceInterval"
  );
  assert.ok(repeat, "repeat picker is missing");
  assert.equal(
    repeat.attrs["aria-describedby"],
    "recurrenceInterval-description"
  );

  const assignee = elements.find(
    (element) => element.attrs.id === "assignedToId"
  );
  assert.ok(assignee, "assignee picker is missing");
  assert.equal(assignee.attrs["aria-describedby"], "assignedToId-description");

  const recurrenceEndDate = elements.find(
    (element) => element.attrs.id === "recurrenceEndDate"
  );
  assert.ok(recurrenceEndDate, "recurrence end date is missing");
  assert.equal(
    recurrenceEndDate.attrs["aria-describedby"],
    "recurrenceEndDate-description"
  );

  for (const id of [
    "prerequisites-label",
    "prerequisites-description",
    "assignedToId-description",
    "recurrenceInterval-label",
    "recurrenceInterval-description",
    "recurrenceEndDate-description",
  ]) {
    assert.ok(ids.has(id), `${id} is missing from the rendered form`);
  }

  assert.match(
    renderTaskForm(),
    /Follow-ups can only be owned by Core Group, Launch Team or Leader members\./
  );
  const noEligibleAssignee = parseElements(
    renderTaskForm({ followUpAssignees: [] })
  ).find((element) => element.attrs.id === "assignedToId");
  assert.ok(
    noEligibleAssignee,
    "assignee picker is missing without candidates"
  );
  assert.equal(
    noEligibleAssignee.attrs["aria-describedby"],
    "assignedToId-description"
  );
  assert.match(
    renderTaskForm({ followUpAssignees: [] }),
    /Nobody has a committed status yet, so no one can own a follow-up\./
  );
});
