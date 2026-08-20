import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { setLaunchDateStatement } from "./service";
import {
  LAUNCH_NOTE_MAX_LENGTH,
  launchNoteSchema,
  launchTargetDateSchema,
} from "./validation";

// ============================================================================
// LS-001/2/7 — the launch write path.
//
// The rules this unit has to hold are properties of the STATEMENT and of the
// module's SHAPE, not of a return value: that the write is guarded, that the
// journal cannot fire for a write that did not land, and that none of this is
// exposed as an endpoint. So they are asserted against the generated SQL and
// against the source, the way `confirm-leadership.test.ts` reads its batches and
// `service.test.ts` (invitations) scans for a directive. A guard that lives only
// in a comment is a guard that comes back.
// ============================================================================

const CHURCH_ID = "22222222-2222-4222-8222-222222222222";
const ACTOR_ID = "11111111-1111-4111-8111-111111111111";
const ROOT = process.cwd();
const LAUNCH_DIR = path.join(ROOT, "src", "lib", "launch");

const dialect = new PgDialect();

function sqlFor(
  overrides: Partial<Parameters<typeof setLaunchDateStatement>[0]> = {}
): string {
  const query = dialect.sqlToQuery(
    setLaunchDateStatement({
      churchId: CHURCH_ID,
      targetDate: "2026-09-20",
      actorUserId: ACTOR_ID,
      postpone: false,
      note: null,
      ...overrides,
    })
  );
  return query.sql.replace(/\s+/g, " ").trim();
}

// ---------------------------------------------------------------------------
// The guards, read off the statement
// ---------------------------------------------------------------------------

test("the plant's launch row is LOCKED before anything is written", () => {
  // A row lock, not a snapshot predicate: two planters moving the date compete
  // for the SAME row, and `FOR UPDATE` is what serialises them
  // (memory/invariants.md → Atomicity). It is the FIRST thing in the statement.
  const sql = sqlFor();
  assert.match(sql, /with current as \( select .* for update \)/);
  assert.ok(
    sql.indexOf("for update") < sql.indexOf("insert into"),
    "the lock must precede every write in the statement"
  );
});

test("the first schedule cannot double-insert: the unique index is the guard", () => {
  // `FOR UPDATE` locks nothing when the row does not exist, so two concurrent
  // FIRST schedules both see an empty `current`. `on conflict do nothing` is
  // what makes one of them lose — and lose completely, journal included.
  const sql = sqlFor();
  assert.match(sql, /where not exists \(select 1 from current\)/);
  assert.match(sql, /on conflict \(church_id\) do nothing/);
});

test("re-saving the same date writes nothing — the compare-and-set is in the WHERE", () => {
  const sql = sqlFor();
  assert.match(sql, /c\.target_date is distinct from/);
  // `is distinct from`, not `<>`: the null case is a `planning` launch getting
  // its first date, and `<>` silently drops it.
  assert.doesNotMatch(sql, /target_date <> /);
});

test("a POSTPONED launch can be re-confirmed on the same day", () => {
  // The compare-and-set may not key on the date ALONE. A planter who postpones
  // and then decides to go ahead on that very Sunday after all is changing the
  // STATUS and nothing else; a date-only predicate writes nothing, and the
  // plant — and its sending church — keep reading `Postponed` until the date is
  // moved somewhere else and back.
  const sql = sqlFor();
  assert.match(sql, /c\.status is distinct from \$\d+::varchar/);
  assert.ok(
    /c\.target_date is distinct from \$\d+::date or c\.status is distinct from/.test(
      sql
    ),
    "the guard must be date-changed OR status-changed, not date alone"
  );
});

test("re-confirming the same day journals `scheduled`, not `moved`", () => {
  // The event describes what happened. Nothing moved, so `moved` would be a
  // false entry in an append-only history — and `scheduled` next to a
  // `previous_status` of `postponed` is exactly "the launch is back on".
  assert.match(
    sqlFor({ postpone: false }),
    /when w\.previous_target_date = w\.target_date then 'scheduled'/
  );
});

test("a completed launch's date is not re-datable", () => {
  assert.match(sqlFor(), /status <> 'completed'/);
});

test("the journal is sourced from what was WRITTEN, never from the request", () => {
  // This is the whole reason the insert and the journal are one statement: a
  // journal fed from the caller's arguments would record moves that never
  // happened, and a journal in a second round trip could not see `RETURNING`.
  const sql = sqlFor();
  assert.match(sql, /insert into launch_events/);
  assert.match(sql, /from written w returning id/);
  assert.ok(
    sql.indexOf("insert into launch_events") > sql.indexOf("written as"),
    "the journal must read from the written rows, so it comes after them"
  );
});

test("the UPDATE reads the locked row, so the journal keeps its OLD values", () => {
  // THE SAME REGRESSION `outcome.test.ts` pins, and it was live here: the
  // UPDATE did not reference `current`, so nothing forced the locked read
  // before the write — only the SIBLING `inserted` CTE's `where not exists
  // (select 1 from current)` did, by accident of plan ordering. A plain CTE is
  // lazy, and a `SELECT … FOR UPDATE` first pulled AFTER the update finds a row
  // its own command just wrote and SKIPS it (`HeapTupleSelfUpdated`). Because
  // the journal joined `current` with a LEFT join, an empty `current` did not
  // suppress the row — it wrote one carrying `previous_target_date` NULL and
  // `previous_status` coalesced to 'planning'. A believable FALSE entry in an
  // append-only history is worse than a missing one.
  //
  // Structural fix, identical to `recordLaunchOutcomeStatement`: `current` is a
  // DEPENDENCY of the UPDATE, and the old values travel to the journal in the
  // same RETURNING rather than through a second read that cannot see them.
  const sql = sqlFor();
  assert.match(sql, /update launches l .* from current c where l\.id = c\.id/);
  assert.match(sql, /c\.target_date as previous_target_date/);
  assert.match(sql, /c\.status as previous_status/);
  assert.ok(
    !/current/.test(sql.slice(sql.indexOf("insert into launch_events"))),
    "the journal must not re-read `current` after the update — it cannot see it"
  );
  // The insert arm has no previous row to carry, so it supplies the same two
  // columns as constants rather than leaving the union ragged.
  assert.match(sql, /null::date as previous_target_date/);
  assert.match(sql, /'planning'::varchar as previous_status/);
  assert.doesNotMatch(sql, /coalesce\(c\.status/);
});

test("the journal records the actor, and the actor is a bound parameter", () => {
  const query = dialect.sqlToQuery(
    setLaunchDateStatement({
      churchId: CHURCH_ID,
      targetDate: "2026-09-20",
      actorUserId: ACTOR_ID,
      postpone: false,
      note: null,
    })
  );
  assert.ok(
    query.params.includes(ACTOR_ID),
    "the actor must reach the journal as a parameter"
  );
  assert.ok(
    !query.sql.includes(ACTOR_ID),
    "no id may be interpolated into the SQL text"
  );
});

// ---------------------------------------------------------------------------
// LS-009 — a reschedule and a postponement are different events
// ---------------------------------------------------------------------------

test("a move journals `moved`; a postponement journals `postponed`", () => {
  assert.match(sqlFor({ postpone: false }), /else 'moved' end/);
  assert.match(sqlFor({ postpone: true }), /else 'postponed' end/);
});

test("a FIRST commitment is `scheduled` even when the postpone flag is set", () => {
  // There is no scheduled date to postpone from, so the arm is chosen on
  // whether a previous date existed — not on the flag.
  for (const postpone of [true, false]) {
    assert.match(
      sqlFor({ postpone }),
      /case when w\.previous_target_date is null then 'scheduled'/
    );
  }
});

test("postponing sets the launch's status to `postponed`, moving keeps `scheduled`", () => {
  const moved = dialect.sqlToQuery(
    setLaunchDateStatement({
      churchId: CHURCH_ID,
      targetDate: "2026-09-20",
      actorUserId: ACTOR_ID,
      postpone: false,
      note: null,
    })
  );
  const postponed = dialect.sqlToQuery(
    setLaunchDateStatement({
      churchId: CHURCH_ID,
      targetDate: "2026-09-20",
      actorUserId: ACTOR_ID,
      postpone: true,
      note: null,
    })
  );
  assert.ok(moved.params.includes("scheduled"));
  assert.ok(postponed.params.includes("postponed"));
});

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

test("a launch date is a calendar day, and a shape check is not enough", () => {
  assert.equal(launchTargetDateSchema.safeParse("2026-09-20").success, true);
  assert.equal(launchTargetDateSchema.safeParse("20-09-2026").success, false);
  assert.equal(launchTargetDateSchema.safeParse("2026-9-20").success, false);
  // Right shape, not a real day — Postgres would refuse it and the planter
  // would see a driver error instead of a sentence.
  assert.equal(launchTargetDateSchema.safeParse("2026-02-31").success, false);
  assert.equal(launchTargetDateSchema.safeParse("2026-13-01").success, false);
});

test("the journal note is BOUNDED, and the service is where it is bounded", () => {
  // `launch_events` is append-only and nothing prunes it, so the note's length
  // is a durable cost. The textarea's `maxLength` is a courtesy to the person
  // typing; `scheduleLaunchAction` is a public POST and the service has callers
  // that are not that form, so the bound lives at both layers (Zod at every
  // boundary) — mirroring how `launchOutcomeSchema` bounds its free text.
  assert.equal(LAUNCH_NOTE_MAX_LENGTH, 2_000);
  assert.equal(launchNoteSchema.safeParse("Venue fell through").success, true);
  assert.equal(launchNoteSchema.safeParse(null).success, true);
  assert.equal(
    launchNoteSchema.safeParse("x".repeat(LAUNCH_NOTE_MAX_LENGTH)).success,
    true
  );
  assert.equal(
    launchNoteSchema.safeParse("x".repeat(LAUNCH_NOTE_MAX_LENGTH + 1)).success,
    false
  );

  // And the service must actually apply it, rather than pass the note through
  // to the statement unchecked.
  const source = readFileSync(path.join(LAUNCH_DIR, "service.ts"), "utf8");
  assert.match(
    source,
    /launchNoteSchema\.safeParse\(options\.note \?\? null\)/
  );
  assert.match(source, /note: parsedNote\.data/);
});

// ---------------------------------------------------------------------------
// Shape: none of this is an endpoint (#265's rules)
// ---------------------------------------------------------------------------

function launchModules(): string[] {
  return readdirSync(LAUNCH_DIR)
    .filter((file) => file.endsWith(".ts") && !file.endsWith(".test.ts"))
    .map((file) => path.join(LAUNCH_DIR, file));
}

test('no module under src/lib/launch carries a "use server" directive', () => {
  // In a `"use server"` module every export is a POSTable endpoint with no
  // session behind it, so the export list IS the auth surface. These modules
  // export helpers taking bare church ids and a raw SQL builder; publishing them
  // would hand anyone who can guess a uuid the ability to re-date a stranger's
  // launch (memory/invariants.md → Authentication).
  const files = launchModules();
  assert.ok(files.length > 0, "found no launch modules to scan");
  for (const file of files) {
    // Comments are stripped first: every one of these files EXPLAINS the rule,
    // and a scan that trips on the explanation makes deleting the explanation
    // the cheapest way to pass. Same stripper as `oversight/read.test.ts`.
    const code = readFileSync(file, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.ok(
      !/["']use server["']/.test(code),
      `${path.basename(file)} declares "use server"`
    );
  }
});

test("the write path never takes its actor as an argument it did not mint", () => {
  // `setLaunchDate(user, …)` takes a `User`, and that is the SESSION's user:
  // the rule is that the value comes from `verifySession()` at the action layer
  // and that this function re-derives authority from it rather than trusting a
  // church id alone. Both checks must be present and both must throw.
  const source = readFileSync(path.join(LAUNCH_DIR, "service.ts"), "utf8");
  assert.match(source, /requirePlantOwner\(user\)/);
  assert.match(source, /await requireChurchAccess\(user, churchId\)/);
});

test("the countdown has one implementation, and the service does not re-derive it", () => {
  const source = readFileSync(path.join(LAUNCH_DIR, "service.ts"), "utf8");
  assert.ok(
    !source.includes("MS_PER_DAY"),
    "day math belongs in countdown.ts, which pins the UTC-midnight rule"
  );
});
