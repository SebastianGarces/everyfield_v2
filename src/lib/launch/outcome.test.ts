import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import {
  canEditOutcome,
  canRecordOutcome,
  launchOutcomeSchema,
  recordLaunchOutcomeStatement,
  updateLaunchOutcomeStatement,
} from "./outcome";
import { launchTargetDateSchema } from "./validation";

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
// Corrections (LS-006, ruled 2026-08-04: a recorded outcome stays editable)
// ---------------------------------------------------------------------------

function editSql(
  overrides: Partial<Parameters<typeof updateLaunchOutcomeStatement>[0]> = {}
): string {
  return dialect
    .sqlToQuery(
      updateLaunchOutcomeStatement({
        churchId: CHURCH_ID,
        actorUserId: ACTOR_ID,
        attendanceCount: 131,
        decisionsCount: 5,
        outcomeNotes: "Recount: 131.",
        captureTheDay: "Photos in the shared drive.",
        ...overrides,
      })
    )
    .sql.replace(/\s+/g, " ")
    .trim();
}

test("a correction may only touch an outcome that EXISTS", () => {
  // The mirror of recording's `status <> 'completed'`: this is the correction
  // path, so it requires the state recording produced. Without it there would be
  // two ways to complete a launch, one of them skipping the day gate entirely.
  const sql = editSql();
  assert.match(sql, /c\.status = 'completed'/);
  assert.match(sql, /c\.outcome_recorded_at is not null/);
});

test("a correction is LOCKED, and the update reads the locked row", () => {
  // Same structure as the recording statement, for the same reason: a lazily
  // evaluated `for update` re-read AFTER the write comes back empty
  // (HeapTupleSelfUpdated) and the journal silently writes nothing.
  const sql = editSql();
  assert.match(sql, /with current as \( select .* for update \)/);
  assert.match(sql, /update launches l .* from current c where l\.id = c\.id/);
  assert.ok(
    !/join current/.test(sql.slice(sql.indexOf("insert into launch_events"))),
    "the journal must not re-read `current` after the update"
  );
});

test("every correction is journalled, and only for a write that landed", () => {
  const sql = editSql();
  assert.match(sql, /insert into launch_events/);
  assert.match(sql, /from updated u returning id/);
  assert.ok(
    sql.indexOf("insert into launch_events") > sql.indexOf("updated as"),
    "the journal must read from the updated row"
  );
});

test("re-saving the same record writes nothing, so the history stays honest", () => {
  // The compare-and-set is in the WHERE, exactly as it is on the date rail: a
  // journal row reading "outcome corrected" that corrected nothing is noise in
  // a history a planter reads. `is distinct from` and not `<>`, because every
  // one of these columns is nullable and `null <> null` is null — which would
  // silently drop the case that matters, clearing a count.
  const sql = editSql();
  for (const column of [
    "attendance_count",
    "decisions_count",
    "outcome_notes",
    "capture_the_day",
  ]) {
    assert.ok(
      sql.includes(`c.${column} is distinct from `),
      `${column} must take part in the compare-and-set`
    );
  }
  // An untyped null parameter leaves Postgres unable to infer the operand type,
  // so every comparand is cast.
  assert.match(sql, /::int/);
  assert.match(sql, /::text/);
});

test("a correction is a `completed` row that came FROM `completed`", () => {
  // How the history tells a Monday recount apart from the launch itself. The
  // event vocabulary is a fixed four-value enum owned by the schema, so the
  // distinguishing fact is the pair (event, previous_status) — a shape the
  // first recording can never produce, since it always comes from `scheduled`
  // or `postponed`. `journalEntryLabel` reads exactly this pair.
  const sql = editSql();
  assert.match(sql, /u\.previous_status, u\.status/);
  assert.match(sql, /c\.status as previous_status/);
});

test("a correction never rewrites the day, the status, or when it was recorded", () => {
  // Read the SET clause alone. Matching the whole statement would be satisfied
  // by the WHERE's own `c.status = 'completed'` and prove nothing.
  const sql = editSql();
  const setClause = sql.slice(
    sql.indexOf(" set "),
    sql.indexOf(" from current c")
  );
  assert.ok(setClause.includes("attendance_count ="), setClause);
  assert.ok(
    !setClause.includes("target_date ="),
    "the day it happened is history"
  );
  assert.ok(
    !setClause.includes("status ="),
    "a correction is not a state change"
  );
  // WHEN the planter first wrote the day down is a fact about the record, not
  // about the edit; the journal carries the correction's own timestamp.
  assert.ok(
    !setClause.includes("outcome_recorded_at ="),
    "the original recording time survives a correction"
  );
});

test("correcting is planter-only and never moves the phase either", () => {
  const source = readFileSync(
    path.join(process.cwd(), "src", "lib", "launch", "outcome.ts"),
    "utf8"
  );
  assert.match(
    source,
    /export async function updateLaunchOutcome\([\s\S]*?assertSeatFor\(user, "launch\.schedule"\)/
  );
  assert.match(
    source,
    /export async function updateLaunchOutcome\([\s\S]*?await requireChurchAccess\(user, churchId\)/
  );
  assert.match(
    source,
    /export async function updateLaunchOutcome\([\s\S]*?reconcileLaunchOutcomeAfterWrite\(churchId\)/
  );
  assert.match(
    source,
    /export async function reconcileLaunchOutcomeAfterWrite\([\s\S]*?markPlantDirty\(churchId\)/
  );
});

test("the correction form appears only for a recorded outcome", () => {
  const recorded = new Date("2026-09-20T18:00:00Z");
  assert.equal(
    canEditOutcome({ status: "completed", outcomeRecordedAt: recorded }),
    true
  );
  assert.equal(
    canEditOutcome({ status: "scheduled", outcomeRecordedAt: null }),
    false
  );
  // Belt and braces: a `completed` row with no record behind it is a state the
  // write path cannot produce, and the form must not offer to edit nothing.
  assert.equal(
    canEditOutcome({ status: "completed", outcomeRecordedAt: null }),
    false
  );
  assert.equal(canEditOutcome(null), false);
});

test("a correction has no deadline — nothing here reads a clock", () => {
  const recorded = new Date("2026-09-20T18:00:00Z");
  for (const asOf of ["2026-09-21", "2027-04-01"]) {
    assert.equal(
      canEditOutcome({ status: "completed", outcomeRecordedAt: recorded }),
      true,
      `still correctable as of ${asOf}`
    );
  }
  assert.equal(canEditOutcome.length, 1, "canEditOutcome takes no `asOf`");
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
  assert.match(source, /assertSeatFor\(user, "launch\.schedule"\)/);
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

test("postponing is the DATE rail's job, and there is only one of it", () => {
  // The ruling of 2026-08-04: a postponement carries a NEW target date and
  // journals through the same write as every other date change (`setLaunchDate`
  // → `setLaunchDateStatement`). A second postpone path living in the outcome
  // module — "the day didn't happen, here's a new date" — is exactly the two
  // write paths that ruling forbids: it would journal a different way, skip the
  // milestone notification, and let a date move without the lock.
  const outcome = readFileSync(
    path.join(process.cwd(), "src", "lib", "launch", "outcome.ts"),
    "utf8"
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  assert.ok(
    !/'postponed'/.test(outcome),
    "the outcome module must not write a postponement"
  );
  assert.ok(
    !/set[\s\S]{0,400}target_date\s*=/.test(outcome),
    "the outcome module must not move the launch date"
  );

  // And a postponement is unrepresentable without a day: the one rail validates
  // its date, so "postpone" with nothing to postpone TO cannot be written.
  assert.equal(launchTargetDateSchema.safeParse("").success, false);
  assert.equal(launchTargetDateSchema.safeParse("2026-09-20").success, true);

  // The action layer routes both arms of the rail through that one service.
  const actions = readFileSync(
    path.join(
      process.cwd(),
      "src",
      "app",
      "(dashboard)",
      "launch",
      "actions.ts"
    ),
    "utf8"
  );
  // `parsed.data`, not `input`: the action zod-parses its body first, so the
  // note carried alongside the date is bounded before it reaches the
  // append-only journal.
  assert.match(
    actions,
    /setLaunchDate\(user, churchId, parsed\.data\.targetDate, \{/
  );
  assert.equal(
    actions.match(/setLaunchDate\(/g)?.length,
    1,
    "one call site, so postponing and moving cannot diverge"
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
