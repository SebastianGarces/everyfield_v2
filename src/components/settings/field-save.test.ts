import assert from "node:assert/strict";
import { test } from "node:test";

import { commitOnEnter } from "./field-save";

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

test("Enter commits by blurring, because blur is the one save path", () => {
  const { event, recorded } = keyEvent("Enter", "Austin");

  commitOnEnter(event);

  assert.equal(recorded.blurred, true);
  assert.equal(recorded.prevented, true);
});

test("Enter does not fire on any other key", () => {
  for (const key of ["a", "Tab", "ArrowDown", "Shift"]) {
    const { event, recorded } = keyEvent(key, "typed");
    commitOnEnter(event);

    assert.equal(recorded.blurred, false, key);
    assert.equal(recorded.stopped, false, key);
    assert.equal(recorded.prevented, false, key);
    assert.equal(recorded.value, "typed", key);
  }
});
