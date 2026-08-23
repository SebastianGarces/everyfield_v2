import assert from "node:assert/strict";
import { test } from "node:test";

import { commitOnEnter, decideCommit } from "./field-save";

// ============================================================================
// The keyboard rule and the dedupe rule the church-profile fields rest on
// (#618).
//
// Both are pure functions, which is the whole reason they were pulled out of
// the components: the rules are subtle, the components are not reachable from
// `pnpm test`, and a rule nothing pins is a rule that regresses. `decideCommit`
// is the newer of the two and the more dangerous to lose — when it is wrong the
// value still saves, so nothing on screen looks broken.
// ============================================================================

type Recorded = {
  prevented: boolean;
  stopped: boolean;
  blurred: boolean;
  committed: number;
  value: string;
};

function keyEvent(key: string, value: string) {
  const recorded: Recorded = {
    prevented: false,
    stopped: false,
    blurred: false,
    committed: 0,
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

  const handler = commitOnEnter(() => {
    recorded.committed += 1;
  });

  return { fire: () => handler(event as never), recorded };
}

test("Enter commits", () => {
  const { fire, recorded } = keyEvent("Enter", "Austin");

  fire();

  assert.equal(recorded.committed, 1);
  assert.equal(recorded.prevented, true);
});

test("Enter leaves focus where the planter put it", () => {
  // The regression this replaced: committing by calling `blur()` saved the
  // field AND dropped keyboard focus to `<body>`, so the next Tab restarted
  // from the top of the dialog. Saving is the effect; moving focus is not.
  const { fire, recorded } = keyEvent("Enter", "Austin");

  fire();

  assert.equal(recorded.blurred, false);
});

test("Enter does not fire on any other key", () => {
  for (const key of ["a", "Tab", "ArrowDown", "Shift"]) {
    const { fire, recorded } = keyEvent(key, "typed");
    fire();

    assert.equal(recorded.committed, 0, key);
    assert.equal(recorded.blurred, false, key);
    assert.equal(recorded.stopped, false, key);
    assert.equal(recorded.prevented, false, key);
    assert.equal(recorded.value, "typed", key);
  }
});

test("an edit the server has not been told about saves", () => {
  assert.equal(
    decideCommit({ typed: "Austin", stored: "Dallas", sent: null }),
    "save"
  );
});

test("a field that agrees with the server resets the status line", () => {
  // Including after a refusal — the planter has just undone whatever was
  // refused, so the message is no longer about anything on screen.
  assert.equal(
    decideCommit({ typed: "Dallas", stored: "Dallas", sent: null }),
    "reset"
  );
});

test("Enter then Tab does not save the same value twice", () => {
  // The pair of commits one edit reaches. The prop still says `Dallas`, because
  // `refresh()` cannot have landed in the keystroke between them.
  assert.equal(
    decideCommit({ typed: "Austin", stored: "Dallas", sent: null }),
    "save",
    "Enter"
  );
  assert.equal(
    decideCommit({ typed: "Austin", stored: "Dallas", sent: "Austin" }),
    "nothing",
    "the blur that follows"
  );
});

test("a second edit during the first save still saves", () => {
  // The dedupe is on the VALUE, not on a request being in flight: `chain`
  // exists precisely so a planter who keeps typing gets every answer written.
  assert.equal(
    decideCommit({ typed: "Houston", stored: "Dallas", sent: "Austin" }),
    "save"
  );
});

test("typing the stored value back after a save is a real change", () => {
  // The server holds `Austin` now, whatever the lagging prop says, so writing
  // `Dallas` over it is a write and not a no-op.
  assert.equal(
    decideCommit({ typed: "Dallas", stored: "Dallas", sent: "Austin" }),
    "save"
  );
});
