import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { PgDialect } from "drizzle-orm/pg-core";

import { setLaunchDateStatement } from "./service";
import { launchTargetDateSchema } from "./validation";

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
  assert.match(sql, /target_date is distinct from/);
  // `is distinct from`, not `<>`: the null case is a `planning` launch getting
  // its first date, and `<>` silently drops it.
  assert.doesNotMatch(sql, /target_date <> /);
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
  assert.match(sql, /from written w left join current c on true/);
  assert.ok(
    sql.indexOf("insert into launch_events") > sql.indexOf("written as"),
    "the journal must read from the written rows, so it comes after them"
  );
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
      /case when c\.target_date is null then 'scheduled'/
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
  assert.match(source, /requireRole\(user, "planter"\)/);
  assert.match(source, /await requireChurchAccess\(user, churchId\)/);
});

test("the countdown has one implementation, and the service does not re-derive it", () => {
  const source = readFileSync(path.join(LAUNCH_DIR, "service.ts"), "utf8");
  assert.ok(
    !source.includes("MS_PER_DAY"),
    "day math belongs in countdown.ts, which pins the UTC-midnight rule"
  );
});
