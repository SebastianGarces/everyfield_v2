// The board reads that gate an action never filter labels server-side (#579).
//
// THE BUG CLASS. GitHub's server-side label filter lags the write. Measured
// 2026-08-21, immediately after `gh issue edit --add-label` returned:
//
//   07:20:07  server-filter=[]     client-filter=[501]
//   07:20:10  server-filter=[501]  client-filter=[501]
//
// Three seconds in which a label that IS set reads as unset, and it is the
// FILTER that lags rather than the endpoint or the CLI — `gh issue list
// --label`, `gh pr list --label` and `gh api ".../issues?labels=X"` all go
// through it. Fetching the objects and matching `.labels[]` locally sees the
// write on the next request.
//
// For a report that staleness is invisible. For the two reads in
// `ops/board.sh` it is a collision: `claims` is the refusal that stops a second
// dispatch pass starting, and `frontier` is where a pass picks work. Two passes
// inside the lag window both read an empty claim list, both proceed, and end up
// on one issue — the thing dispatch § 1 exists to prevent.
//
// So the shape is pinned here. The lazy reads elsewhere (`--label feature` to
// find an FRD's board parent) are deliberately NOT covered: nothing races a
// label that is set once when the feature is filed.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Resolved from this file, not the cwd — the test must not depend on where it
// is run from.
const ROOT = path.resolve(import.meta.dirname, "../..");

function read(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

test("ops/board.sh never asks the API to filter labels", () => {
  const script = read("ops/board.sh");

  // The query string it builds must carry no label filter. `labels=` inside a
  // comment is how the header explains the hazard, so only the live `gh api`
  // lines are examined.
  const calls = script
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("#"))
    .filter((line) => line.includes("gh api"));

  assert.ok(
    calls.length > 0,
    "ops/board.sh makes no `gh api` call — has it been rewritten?"
  );

  for (const call of calls) {
    assert.doesNotMatch(
      call,
      /labels=/,
      `ops/board.sh filters labels server-side: ${call.trim()}\n` +
        "That read lags ~3s behind the write, so a claim written moments ago reads as absent. " +
        "Fetch the issues and match .labels[] in jq instead."
    );
  }
});

test("both gating reads match labels in jq", () => {
  const script = read("ops/board.sh");

  // The client-side idiom, spelled once here so the check stays readable:
  // `any(.labels[]?; .name == "…")` over issues the API returned unfiltered.
  assert.match(
    script,
    /any\(\.labels\[\]\?;/,
    "ops/board.sh no longer matches labels with `any(.labels[]?; …)` — if the filtering moved back to the API, it lags"
  );

  for (const label of [
    "agent:in-progress",
    "agent:queued",
    "agent:changes-requested",
  ]) {
    assert.ok(
      script.includes(`"${label}"`),
      `ops/board.sh no longer names "${label}" — a gating read lost one of the states it must cover`
    );
  }
});

test("the callers use the script instead of re-deriving the query", () => {
  const callers = [
    ["ops/process.md", "ops/board.sh frontier"],
    [".claude/skills/dispatch/SKILL.md", "ops/board.sh claims"],
    [".claude/skills/dispatch/SKILL.md", "ops/board.sh frontier"],
    [".claude/skills/standup/SKILL.md", "ops/board.sh frontier"],
  ];

  for (const [file, invocation] of callers) {
    assert.ok(
      read(file).includes(invocation),
      `${file} no longer calls \`${invocation}\` — a hand-rolled query there reintroduces the lag`
    );
  }
});
