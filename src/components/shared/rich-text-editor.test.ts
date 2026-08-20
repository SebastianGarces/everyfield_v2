import assert from "node:assert/strict";
import { test } from "node:test";

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { namedButtons, parseElements } from "@/lib/testing/rendered-markup";

import { RichTextEditor, RichTextLinkEditor } from "./rich-text-editor";
import { RICH_TEXT_CONTROLS } from "./rich-text-editor-controls";

// ----------------------------------------------------------------------------
// A DOM assertion over the markup the browser actually receives — no jsdom
// needed for a contract that is entirely attributes and class names. The reader
// itself is `src/lib/testing/rendered-markup.ts`, shared rather than copied,
// because a private copy of a markup regex weakens quietly.
//
// What is pinned here: every toolbar control is a real, named button, and the
// surface itself is a labelled multiline textbox rather than an anonymous div.
// ----------------------------------------------------------------------------

function render(props: Partial<Parameters<typeof RichTextEditor>[0]> = {}) {
  return renderToStaticMarkup(
    createElement(RichTextEditor, {
      value: "",
      onChange: () => {},
      "aria-label": "Message",
      ...props,
    })
  );
}

test("the toolbar renders one named control per editor command", () => {
  // The cursor loop that used to sit here is gone (#502): the class comes from
  // `richTextControlClass` and is asserted where that constant is written.
  const buttons = namedButtons(render());

  assert.equal(buttons.length, RICH_TEXT_CONTROLS.length);
});

test("every editor control is named and reports its pressed state", () => {
  const buttons = namedButtons(render());
  const labels = buttons.map((b) => b.attrs["aria-label"]);

  for (const control of RICH_TEXT_CONTROLS) {
    assert.ok(labels.includes(control.label), `${control.label} missing`);
  }
  for (const button of buttons) {
    assert.ok(
      button.attrs["aria-pressed"] !== undefined,
      `${button.attrs["aria-label"]} has no pressed state`
    );
    // type="button" or the first control submits whatever form wraps it.
    assert.equal(button.attrs["type"], "button");
  }
});

test("bold, italic and link are all reachable from the toolbar", () => {
  const labels = namedButtons(render()).map((b) => b.attrs["aria-label"]);
  for (const required of ["Bold", "Italic", "Link"]) {
    assert.ok(labels.includes(required), required);
  }
});

test("the editing surface is a labelled multiline textbox", () => {
  const html = render({ id: "body" });
  const textbox = parseElements(html).find(
    (el) => el.attrs["role"] === "textbox"
  );

  assert.ok(textbox, "no textbox role in the rendered editor");
  assert.equal(textbox.attrs["aria-multiline"], "true");
  assert.equal(textbox.attrs["aria-label"], "Message");
  assert.equal(textbox.attrs["id"], "body");
  assert.equal(textbox.attrs["contenteditable"], "true");
});

test("the toolbar is a toolbar, and it is named", () => {
  const toolbar = parseElements(render()).find(
    (el) => el.attrs["role"] === "toolbar"
  );

  assert.ok(toolbar, "no toolbar role in the rendered editor");
  assert.ok((toolbar.attrs["aria-label"] ?? "").length > 0);
});

test("the placeholder shows only while there is nothing to read", () => {
  assert.ok(
    render({ placeholder: "Write your message..." }).includes(
      "Write your message..."
    )
  );
  // `<p><br></p>` is an emptied editor, not content.
  assert.ok(
    render({
      placeholder: "Write your message...",
      value: "<p><br></p>",
    }).includes("Write your message...")
  );
  assert.ok(
    !render({
      placeholder: "Write your message...",
      value: "<p>Hi Sarah</p>",
    }).includes("Write your message...")
  );
});

// --- the link box's refusal ------------------------------------------------
//
// `aria-invalid` says the address is wrong. It does not say why, and a message
// rendered beside the field is a message a screen reader never reaches. So the
// two have to be PAIRED — `aria-describedby` naming an id that some element
// really carries — and an id that drifts from the one on the paragraph reads
// exactly like no error at all, silently.

function renderLinkEditor(error: string | null) {
  return renderToStaticMarkup(
    createElement(RichTextLinkEditor, {
      url: "not a url",
      error,
      onUrlChange: () => {},
      onApply: () => {},
      onCancel: () => {},
    })
  );
}

test("the link error is associated with the field, not just placed near it", () => {
  const html = renderLinkEditor("Enter a web address like example.com");
  const elements = parseElements(html);

  const input = elements.find(
    (el) => el.attrs["aria-label"] === "Link address"
  );
  assert.ok(input, "no link address field");
  assert.equal(input.attrs["aria-invalid"], "true");

  const describedBy = input.attrs["aria-describedby"];
  assert.ok(describedBy, "the invalid field describes itself with nothing");

  // The id is not merely present — it names an element that exists.
  const described = elements.find((el) => el.attrs["id"] === describedBy);
  assert.ok(described, `aria-describedby="${describedBy}" names no element`);
  assert.equal(described.tag, "p");
  assert.ok(html.includes("Enter a web address like example.com"), html);
});

test("a link box with nothing wrong describes itself with nothing", () => {
  const input = parseElements(renderLinkEditor(null)).find(
    (el) => el.attrs["aria-label"] === "Link address"
  );

  assert.ok(input, "no link address field");
  assert.equal(input.attrs["aria-invalid"], "false");
  assert.equal(input.attrs["aria-describedby"], undefined);
});

test("both link controls are buttons that do not submit the form", () => {
  const html = renderLinkEditor(null);
  for (const label of ["Add link", "Cancel"]) {
    assert.ok(html.includes(`>${label}<`), `${label} is missing`);
  }
  const buttons = parseElements(html).filter((el) => el.tag === "button");
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.equal(button.attrs["type"], "button");
  }
});

test("a disabled editor is not editable and its controls are disabled", () => {
  const html = render({ disabled: true });
  const textbox = parseElements(html).find(
    (el) => el.attrs["role"] === "textbox"
  );

  assert.equal(textbox?.attrs["contenteditable"], "false");
  for (const button of namedButtons(html)) {
    assert.ok(
      button.attrs["disabled"] !== undefined,
      `${button.attrs["aria-label"]} stayed enabled`
    );
  }
});
