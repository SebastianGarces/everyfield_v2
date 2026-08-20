import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RICH_TEXT_CONTROLS,
  RICH_TEXT_CONTROL_CLASS,
  richTextControlClass,
} from "./rich-text-editor-controls";

// ----------------------------------------------------------------------------
// The toolbar's class string, in both states. What is pinned is that the active
// state DECORATES the base rather than replacing it — the failure that would
// otherwise show up as a Bold button losing its padding the moment it is
// pressed.
//
// The cursor scan that used to lead this file is gone (#502). These controls
// are bare <button>s, and a native button takes its pointer from globals.css,
// so the class carrying `cursor-pointer` is belt-and-braces and asserting it
// here was the second weak rung the issue exists to delete — the same call this
// PR made for the <Button> in article-feedback and eighteen others.
// ----------------------------------------------------------------------------

test("the active state changes appearance without dropping the base class", () => {
  const active = richTextControlClass(true);
  const idle = richTextControlClass(false);

  assert.notEqual(active, idle);
  for (const cls of [active, idle]) {
    assert.ok(cls.startsWith(RICH_TEXT_CONTROL_CLASS), cls);
  }
});

test("controls are keyboard-reachable and named", () => {
  assert.ok(RICH_TEXT_CONTROLS.length > 0);

  for (const control of RICH_TEXT_CONTROLS) {
    assert.ok(control.label.trim().length > 0, control.command);
    // Sentence case: "Bulleted list", never "Bulleted List".
    assert.ok(!/\s[A-Z]/.test(control.label), control.label);
    assert.ok(control.icon.length > 0, control.command);
  }
});

test("bold, italic and link are all offered — the three COM-017 names", () => {
  const commands = RICH_TEXT_CONTROLS.map((c) => c.command);
  for (const required of ["bold", "italic", "link"]) {
    assert.ok(commands.includes(required as never), required);
  }
  assert.equal(new Set(commands).size, commands.length, "duplicate command");
});
