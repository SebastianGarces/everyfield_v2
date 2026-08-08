import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  canRecordOutcome,
  launchOutcomeSchema,
  recordLaunchOutcomeStatement,
} from "./outcome";

// ============================================================================
// LS-006 — recording the day.
// ============================================================================

const CHURCH_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";

const dialect = new PgDialect();

function outcomeSql(
  overrides: Partial<Parameters<typeof recordLaunchOutcomeStatement>[0]> = {}
): string {
  return dialect
    .sqlToQuery(
      recordLaunchOutcomeStatement({
        churchId: CHURCH_ID,
        actorUserId: ACTOR_ID,
        asOfDay: "2026-09-20",
        attendanceCount: 120,
        decisionsCount: 4,
        outcomeNotes: "Full room.",
        captureTheDay: "Photos in the shared drive.",
        ...overrides,
      })
    )
    .sql.replace(/\s+/g, " ")
    .trim();
}

// ---------------------------------------------------------------------------
// The guards
// ---------------------------------------------------------------------------

test("the launch row is LOCKED before the outcome overwrites it", () => {
  const sql = outcomeSql();
  assert.match(sql, /with current as \( select .* for update \)/);
  assert.ok(
    sql.indexOf("for update") < sql.indexOf("update launches"),
    "the lock must precede the write"
  );
});

test("recording is WRITE-ONCE", () => {
  // A second submit must not overwrite an account of the day with an empty
  // form, so the compare-and-set is on the status the first write set.
  assert.match(outcomeSql(), /status <> 'completed'/);
});

test("the outcome cannot be recorded before the day arrives", () => {
  // Not a nicety: `status = 'completed'` freezes the date, so an early submit
  // would strand a plant's launch date permanently.
  assert.match(outcomeSql(), /target_date <= /);
  assert.match(outcomeSql(), /target_date is not null/);
});

test("the day gate is the CALLER's UTC day, never the database's clock", () => {
  // `current_date` follows the server's TimeZone setting, which would let the
  // SQL gate and the page's countdown disagree about which day it is — the
  // #303/#338 divergence, in a new place.
  const sql = outcomeSql();
  assert.doesNotMatch(sql, /current_date/);
  const query = dialect.sqlToQuery(
    recordLaunchOutcomeStatement({
      churchId: CHURCH_ID,
      actorUserId: ACTOR_ID,
      asOfDay: "2026-09-20",
      attendanceCount: null,
      decisionsCount: null,
      outcomeNotes: null,
      captureTheDay: null,
    })
  );
  assert.ok(query.params.includes("2026-09-20"));
});

test("the journal fires only for a write that landed", () => {
  const sql = outcomeSql();
  assert.match(sql, /insert into launch_events/);
  assert.match(sql, /from updated u returning id/);
  assert.ok(
    sql.indexOf("insert into launch_events") > sql.indexOf("updated as"),
    "the journal must read from the updated row"
  );
  assert.match(sql, /'completed'/);
});

test("the UPDATE reads the locked row, so the journal keeps its OLD values", () => {
  // A REGRESSION TEST FOR A SILENT FAILURE, found against real Postgres. Written
  // the obvious way — `update … where church_id = $1`, then `insert … from
  // updated u join current c` — no journal row appeared at all: a plain CTE is
  // lazy, `current` was first pulled by the journal (after the UPDATE had run),
  // and `SELECT … FOR UPDATE` SKIPS a row whose latest version was written by
  // the current command. Empty `current`, inner join, no row, no error.
  //
  // The fix is structural: the UPDATE reads `from current`, so `current` is a
  // dependency and is evaluated (and locked) BEFORE anything modifies it, and
  // the previous values come back in the same RETURNING.
  const sql = outcomeSql();
  assert.match(sql, /update launches l .* from current c where l\.id = c\.id/);
  assert.match(sql, /c\.target_date as previous_target_date/);
  assert.match(sql, /c\.status as previous_status/);
  assert.ok(
    !/join current/.test(sql.slice(sql.indexOf("insert into launch_events"))),
    "the journal must not re-read `current` after the update — it cannot see it"
  );
});

test("no meeting row is created — Launch Sunday is not a meeting", () => {
  assert.doesNotMatch(outcomeSql(), /insert into meetings/);
});

// ---------------------------------------------------------------------------
// Counts
// ---------------------------------------------------------------------------

test("null and zero are different answers", () => {
  // Null means "not recorded"; 0 means nobody came, or nobody responded.
  assert.equal(
    launchOutcomeSchema.safeParse({
      attendanceCount: null,
      decisionsCount: 0,
      outcomeNotes: null,
      captureTheDay: null,
    }).success,
    true
  );
});

test("a count is a whole number and never negative", () => {
  for (const attendanceCount of [-1, 1.5]) {
    assert.equal(
      launchOutcomeSchema.safeParse({
        attendanceCount,
        decisionsCount: null,
        outcomeNotes: null,
        captureTheDay: null,
      }).success,
      false,
      `${attendanceCount} must be refused`
    );
  }
});

// ---------------------------------------------------------------------------
// The UI's copy of the day gate
// ---------------------------------------------------------------------------

test("the form appears on launch day and not before", () => {
  const launch = { targetDate: "2026-09-20", status: "scheduled" };

  // The morning of the launch — the exact case #338 got wrong everywhere else.
  assert.equal(
    canRecordOutcome(launch, new Date("2026-09-20T00:00:01Z")),
    true
  );
  assert.equal(
    canRecordOutcome(launch, new Date("2026-09-20T23:59:59Z")),
    true
  );
  assert.equal(
    canRecordOutcome(launch, new Date("2026-09-21T09:00:00Z")),
    true
  );
  assert.equal(
    canRecordOutcome(launch, new Date("2026-09-19T23:59:59Z")),
    false
  );
});

test("nothing to record without a date, and nothing to record twice", () => {
  assert.equal(
    canRecordOutcome(
      { targetDate: null, status: "planning" },
      new Date("2026-09-20T12:00:00Z")
    ),
    false
  );
  assert.equal(
    canRecordOutcome(
      { targetDate: "2026-09-20", status: "completed" },
      new Date("2026-09-21T12:00:00Z")
    ),
    false
  );
  assert.equal(canRecordOutcome(null, new Date("2026-09-20T12:00:00Z")), false);
});

// ---------------------------------------------------------------------------
// Shape
// ---------------------------------------------------------------------------

test("recording the outcome is planter-only (LS-007), and self-authorising", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "lib", "launch", "outcome.ts"),
    "utf8"
  );
  assert.match(source, /requireRole\(user, "planter"\)/);
  assert.match(source, /await requireChurchAccess\(user, churchId\)/);
});

test("the outcome module has one countdown and does not re-derive days", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "lib", "launch", "outcome.ts"),
    "utf8"
  );
  assert.match(source, /daysUntilTarget/);
  assert.ok(
    !source.includes("MS_PER_DAY") && !source.includes("86_400_000"),
    "day math belongs in countdown.ts, which pins the UTC-midnight rule (#338)"
  );
});

test("recording a launch marks the plant dirty but never moves its phase", () => {
  // LS-008: a completed launch is a MATERIAL event, and the engine stays
  // advisory — completing a launch must not auto-advance `current_phase`.
  const source = readFileSync(
    path.join(process.cwd(), "src", "lib", "launch", "outcome.ts"),
    "utf8"
  );
  assert.match(source, /markPlantDirty\(churchId\)/);
  // Comments are stripped first: the module EXPLAINS this rule, and a scan that
  // trips on the explanation makes deleting the explanation the cheapest way to
  // pass. Same stripper as `service.test.ts`.
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.ok(
    !/current_phase|currentPhase/.test(code),
    "the outcome path must not touch the plant's phase"
  );
});
