import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { launchNoteSchema } from "@/lib/launch/validation";

// ============================================================================
// /launch — the `"use server"` boundary, asserted from its SOURCE.
//
// Importing the module would drag `next/cache` into a bare node:test process,
// so its SHAPE is read off the file — the same technique
// `settings/actions.test.ts` uses for the same reason. What is pinned here is
// what a reviewer found missing at review time and could go missing again:
//
//   * every action that receives a result carrying an ERROR arm reads it. An
//     unread refusal is reported to the planter as a success.
//   * the schedule action VALIDATES its input, note included. Every export of
//     this file is a public POST, and the note lands in an append-only table.
// ============================================================================

const ACTIONS_PATH = path.join(
  process.cwd(),
  "src/app/(dashboard)/launch/actions.ts"
);

function source(): string {
  return readFileSync(ACTIONS_PATH, "utf8");
}

/** The body of one exported action, from its signature to the next one. */
function actionBody(name: string): string {
  const code = source();
  const start = code.indexOf(`export async function ${name}(`);
  assert.ok(start >= 0, `${name} is no longer exported from actions.ts`);
  const next = code.indexOf("\nexport ", start + 1);
  return code.slice(start, next === -1 ? undefined : next);
}

// ---------------------------------------------------------------------------
// Refusals are reported, not swallowed
// ---------------------------------------------------------------------------

test("both milestone actions check the service's error arm", () => {
  // `reopenMilestoneAction` shipped WITHOUT this check while its declared
  // return type promised the error arm — so a refusal would have been rendered
  // as `success: true, changed: false`. Nothing refuses a reopen today, which
  // is exactly why the omission was invisible: the first guard added to
  // `reopenLaunchMilestone` would have been silently swallowed.
  for (const name of ["completeMilestoneAction", "reopenMilestoneAction"]) {
    assert.match(
      actionBody(name),
      /if \(result\.status === "error"\) \{\s*return \{ success: false, error: result\.error \};/,
      `${name} does not report the service's refusal`
    );
  }
});

// ---------------------------------------------------------------------------
// The note is bounded at the endpoint, not at the textarea
// ---------------------------------------------------------------------------

test("scheduleLaunchAction parses its input before it reaches the service", () => {
  const body = actionBody("scheduleLaunchAction");
  assert.match(body, /scheduleLaunchInputSchema\.safeParse\(input\)/);
  assert.ok(
    body.indexOf("safeParse(input)") < body.indexOf("await setLaunchDate("),
    "the parse must happen before the write, not after it"
  );
  // And the schema must actually bound the note: `targetDate` was validated in
  // the service from the start, but the note went straight into
  // `launch_events.note` with nothing between it and Next's 1 MB body limit.
  assert.match(source(), /const scheduleLaunchInputSchema = z\.object\(\{/);
  assert.match(source(), /note: launchNoteSchema\.optional\(\)/);
});

test("the note's bound matches the textarea a planter types into", () => {
  // 2,000 characters — `schedule-launch-form.tsx` shows `maxLength={2000}`, and
  // a server bound that disagreed with the control would either refuse a note
  // the UI accepted or accept one it did not.
  const form = readFileSync(
    path.join(process.cwd(), "src/components/launch/schedule-launch-form.tsx"),
    "utf8"
  );
  assert.match(form, /maxLength=\{2000\}/);
  assert.equal(launchNoteSchema.safeParse("x".repeat(2000)).success, true);
  assert.equal(launchNoteSchema.safeParse("x".repeat(2001)).success, false);
  // `null` is a real value — most changes are made without a stated reason.
  assert.equal(launchNoteSchema.safeParse(null).success, true);
});

// ---------------------------------------------------------------------------
// The rules the whole module rests on (#265, LS-007)
// ---------------------------------------------------------------------------

test("no action takes a church id, so a forged one is unrepresentable", () => {
  const code = source().replace(/\/\*[\s\S]*?\*\//g, "");
  const signatures = [
    ...code.matchAll(/export async function \w+\(([^)]*)\)/g),
  ];
  assert.ok(signatures.length > 0, "found no exported actions to scan");
  for (const [, params] of signatures) {
    assert.ok(
      !/churchId/.test(params),
      `an action takes a church id: (${params.trim()})`
    );
  }
});

test("no SQL is written at the action layer", () => {
  // Every write goes through `src/lib/launch/*`, which is where the row lock,
  // the compare-and-set and the journal insert live. An action with its own SQL
  // would be a second write path with none of them.
  assert.doesNotMatch(source(), /\bsql`/);
});
