import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { RICH_TEXT_CONTROLS } from "@/components/shared/rich-text-editor-controls";
import {
  namedButtons,
  parseElements,
  type RenderedElement,
} from "@/lib/testing/rendered-markup";

import { TaskDescriptionField, TaskPrerequisitesField } from "./task-form";

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
//   * every editor control is a clickable carrying `cursor-pointer` (hard rule)
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

test("every description control is a clickable that carries cursor-pointer", () => {
  const buttons = namedButtons(render());

  assert.equal(buttons.length, RICH_TEXT_CONTROLS.length);
  for (const button of buttons) {
    assert.match(
      button.attrs["class"] ?? "",
      /\bcursor-pointer\b/,
      `${button.attrs["aria-label"]} is clickable without cursor-pointer`
    );
  }
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

test("every prerequisite control is a clickable that carries cursor-pointer", () => {
  const html = renderPrereqs();
  const buttons = namedButtons(html);
  assert.ok(
    buttons.length >= 1,
    "the selected prerequisite has no named remove control"
  );
  for (const button of buttons) {
    assert.match(
      button.attrs["class"] ?? "",
      /\bcursor-pointer\b/,
      `${button.attrs["aria-label"]} is clickable without cursor-pointer`
    );
  }

  const trigger = parseElements(html).find(
    (el) => el.attrs["data-slot"] === "select-trigger"
  );
  assert.ok(trigger, "no select trigger to add a prerequisite");
  assert.match(
    trigger.attrs["class"] ?? "",
    /\bcursor-pointer\b/,
    "the add-prerequisite trigger is clickable without cursor-pointer"
  );
});
