import assert from "node:assert/strict";
import { test } from "node:test";

import { commitOnEnter, revertOnEscape } from "./field-save";

// ============================================================================
// The two keyboard rules the church-profile fields rest on (#618).
//
// Both are pure functions over an event, which is the whole reason they were
// pulled out of the components: the rules are subtle, the components are not
// reachable from `pnpm test`, and a rule nothing pins is a rule that regresses.
// ============================================================================

type Recorded = {
  prevented: boolean;
  stopped: boolean;
  blurred: boolean;
  value: string;
};

function keyEvent(key: string, value: string) {
  const recorded: Recorded = {
    prevented: false,
    stopped: false,
    blurred: false,
    value,
  };

  const target = {
    get value() {
      return recorded.value;
    },
    set value(next: string) {
      recorded.value = next;
    },
    blur() {
      recorded.blurred = true;
    },
  };

  const event = {
    key,
    currentTarget: target,
    preventDefault: () => {
      recorded.prevented = true;
    },
    stopPropagation: () => {
      recorded.stopped = true;
    },
  };

  return { event: event as never, recorded };
}

test("Escape in a DIRTY field reverts it and keeps the modal open", () => {
  const { event, recorded } = keyEvent("Escape", "Dayspring Fellowship");

  revertOnEscape(event, "Dayspring Church");

  assert.equal(recorded.value, "Dayspring Church", "the field did not revert");
  // The first Escape belongs to the EDIT, not to the dialog. Without this the
  // planter's typing leaves with the modal — no save, no message, nothing to
  // retry — because a focused node removed from the document does not reliably
  // fire `focusout`, and blur is the only save path.
  assert.equal(recorded.stopped, true, "the dialog would still have closed");
  assert.equal(recorded.prevented, true);
});

test("Escape in a CLEAN field closes the modal, exactly as it always did", () => {
  const { event, recorded } = keyEvent("Escape", "Dayspring Church");

  revertOnEscape(event, "Dayspring Church");

  assert.equal(recorded.stopped, false, "Escape stopped reaching the dialog");
  assert.equal(recorded.prevented, false);
  assert.equal(recorded.value, "Dayspring Church");
});

test("Escape compares TRIMMED, so whitespace alone is not a dirty field", () => {
  const { event, recorded } = keyEvent("Escape", "  Dayspring Church  ");

  revertOnEscape(event, "Dayspring Church");

  assert.equal(recorded.stopped, false);
});

test("Enter commits by blurring, because blur is the one save path", () => {
  const { event, recorded } = keyEvent("Enter", "Austin");

  commitOnEnter(event);

  assert.equal(recorded.blurred, true);
  assert.equal(recorded.prevented, true);
});

test("neither rule fires on any other key", () => {
  for (const key of ["a", "Tab", "ArrowDown", "Shift"]) {
    const { event, recorded } = keyEvent(key, "typed");
    commitOnEnter(event);
    revertOnEscape(event, "stored");

    assert.equal(recorded.blurred, false, key);
    assert.equal(recorded.stopped, false, key);
    assert.equal(recorded.prevented, false, key);
    assert.equal(recorded.value, "typed", key);
  }
});
