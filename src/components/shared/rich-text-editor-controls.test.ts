import assert from "node:assert/strict";
import { test } from "node:test";

import {
  RICH_TEXT_CONTROLS,
  RICH_TEXT_CONTROL_CLASS,
  richTextControlClass,
} from "./rich-text-editor-controls";

// ----------------------------------------------------------------------------
// `cursor-pointer` on every clickable is a project hard rule (AGENTS.md), and
// these toolbar buttons are the easiest place in the app to break it — they are
// bare <button>s in a custom widget, not shadcn components someone else already
// styled. The rule is a claim about the class string, so it is asserted on the
// class string, in BOTH states: an active Bold is still a clickable.
// ----------------------------------------------------------------------------

test("every toolbar control carries cursor-pointer, active or not", () => {
  for (const isActive of [true, false]) {
    assert.match(
      richTextControlClass(isActive),
      /\bcursor-pointer\b/,
      `active=${isActive}`
    );
  }
  assert.match(RICH_TEXT_CONTROL_CLASS, /\bcursor-pointer\b/);
});

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
