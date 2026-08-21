// The merge-hold label is one literal in four files, and it fails SILENTLY
// when they drift (#579).
//
// THE BUG CLASS. `ops/merge-hold.sh` asks the board for open PRs carrying a
// label name it hard-codes. `ops/setup-labels.sh` creates a label name it
// hard-codes. If those two spellings ever differ, the script returns "clear"
// forever: `gh pr list --label <nonexistent>` is an empty list, not an error.
// Every track sails through a hold that is really in force, which is precisely
// the 2026-08-21 incident the hold was built to prevent — only now with a
// mechanism that reports success while doing nothing.
//
// A silent no-op is worth a test in a way that a loud failure is not. The two
// docs are checked as well, so neither can instruct an agent to look for a
// label the board does not have.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Resolved from this file, not the cwd — the test must not depend on where it
// is run from.
const ROOT = path.resolve(import.meta.dirname, "../..");

const LABEL = "merge-priority";

/** Every file that spells the label, and what it would break by drifting. */
const SPELLINGS = [
  [
    "ops/merge-hold.sh",
    "the query would match nothing and every hold would read as clear",
  ],
  [
    "ops/setup-labels.sh",
    "the board would never get the label the script looks for",
  ],
  [
    ".claude/skills/open-pr/SKILL.md",
    "the ship step would name a label that does not exist",
  ],
  ["ops/process.md", "the loop would name a label that does not exist"],
];

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test(`every file spells the hold label "${LABEL}"`, () => {
  for (const [file, consequence] of SPELLINGS) {
    assert.ok(
      read(file).includes(LABEL),
      `${file} does not contain "${LABEL}" — ${consequence}`
    );
  }
});

test("the script queries exactly the label setup-labels.sh creates", () => {
  const queried = /readonly LABEL="([^"]+)"/.exec(read("ops/merge-hold.sh"));
  assert.ok(
    queried,
    'ops/merge-hold.sh has no `readonly LABEL="…"` — the parity claim is no longer checkable'
  );

  const created =
    read("ops/setup-labels.sh").match(/gh label create "([^"]+)"/g) ?? [];
  const names = created.map((line) => /"([^"]+)"/.exec(line)[1]);

  assert.ok(
    names.includes(queried[1]),
    `ops/merge-hold.sh queries "${queried[1]}", which ops/setup-labels.sh never creates. ` +
      `It creates: ${names.join(", ")}. A query for a label the board lacks returns an empty ` +
      `list, so every hold would read as clear.`
  );
});

test("the ship step runs the check and the merge as one command", () => {
  // The whole mechanism is the `&&`. A check run minutes before the merge
  // reopens the window the hold exists to close, so the skill must not be
  // edited into two separate steps without someone reading this.
  assert.match(
    read(".claude/skills/open-pr/SKILL.md"),
    /ops\/merge-hold\.sh <number> --wait && gh pr merge/,
    "the open-pr skill no longer joins the hold check to the merge with `&&` — a check that does not gate the merge in the same command is not a gate"
  );
});

test("the ship step disables auto-merge, back-fills, and merges — in that order", () => {
  // #583. The merge has to be the LAST thing the ship step does. #579 moved the
  // merge into step 3 and left the body back-fill in step 4, so following the
  // recipe in order produced the one thing the same skill refuses to merge: a
  // body still reading "⏳ anchoring". It read fine to a human because each step
  // was individually correct.
  //
  // Ordering in prose has no compiler, so it gets one here: three literals, and
  // their positions must increase.
  const skill = read(".claude/skills/open-pr/SKILL.md");

  const steps = [
    [
      "--disable-auto",
      "auto-merge can rebase the branch and fire between the back-fill and your merge",
    ],
    // `gh pr edit`, not a bare `--body-file` — step 2's `gh pr create` carries
    // that flag too, and matching it would compare against the wrong step.
    [
      "gh pr edit <number> --body-file <path>",
      "the body must be corrected while the merge is still in your hands",
    ],
    [
      "gh pr merge <number> --squash",
      "the merge is the last thing the ship step does",
    ],
  ];

  let previous = -1;
  let previousLiteral = "the start of the file";

  for (const [literal, why] of steps) {
    const at = skill.indexOf(literal);
    assert.notEqual(
      at,
      -1,
      `the open-pr ship step no longer contains \`${literal}\` — ${why}`
    );
    assert.ok(
      at > previous,
      `\`${literal}\` now comes before \`${previousLiteral}\` in the open-pr ship step. ${why}.`
    );
    previous = at;
    previousLiteral = literal;
  }
});
