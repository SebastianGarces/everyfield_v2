import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_CHURCH_TIME_ZONE } from "@/lib/datetime";

import { CHURCH_PROFILE_FIELDS, churchProfileWriteSchema } from "./profile";
import {
  InvalidDigestScheduleError,
  InvalidInactivityThresholdsError,
  InvalidTimeZoneError,
  setChurchDigestScheduleQuery,
  setChurchInactivityThresholdsQuery,
  setChurchProfileFieldQuery,
  setChurchTimeZoneQuery,
} from "./settings";

const CHURCH_ID = "11111111-1111-4111-8111-111111111111";

test("the write names the church and the zone, and nothing else", () => {
  const { sql, params } = setChurchTimeZoneQuery(
    CHURCH_ID,
    "America/New_York"
  ).toSQL();

  assert.match(sql, /"time_zone"/);
  assert.match(sql, /"churches"/);
  assert.ok(params.includes(CHURCH_ID));
  assert.ok(params.includes("America/New_York"));
});

test("an invalid zone id is rejected on write rather than stored", () => {
  assert.throws(
    () => setChurchTimeZoneQuery(CHURCH_ID, "Not/AZone"),
    InvalidTimeZoneError
  );
  assert.throws(
    () => setChurchTimeZoneQuery(CHURCH_ID, ""),
    InvalidTimeZoneError
  );

  // The statement is never built, so a bad value cannot appear in SQL.
  try {
    setChurchTimeZoneQuery(CHURCH_ID, "Not/AZone");
    assert.fail("expected InvalidTimeZoneError");
  } catch (error) {
    assert.ok(error instanceof InvalidTimeZoneError);
    assert.doesNotMatch(
      String(error.stack ?? ""),
      /update/i,
      "the throw must precede the statement"
    );
  }
});

test("the migration adds a non-null IANA column defaulting to Chicago", () => {
  const sql = readFileSync(
    path.join(process.cwd(), "src/db/migrations/0044_church_time_zone.sql"),
    "utf8"
  );

  assert.match(
    sql,
    /ADD COLUMN "time_zone" varchar\(64\) DEFAULT 'America\/Chicago' NOT NULL/
  );
  assert.match(sql, new RegExp(DEFAULT_CHURCH_TIME_ZONE));
});

// ----------------------------------------------------------------------------
// When the digest lands (N-013, #448)
// ----------------------------------------------------------------------------

test("the digest schedule write names both columns and the church", () => {
  const { sql, params } = setChurchDigestScheduleQuery(CHURCH_ID, {
    weekday: 3,
    hour: 7,
  }).toSQL();

  assert.match(sql, /"digest_send_weekday"/);
  assert.match(sql, /"digest_send_hour"/);
  assert.match(sql, /"churches"/);
  assert.ok(params.includes(CHURCH_ID));
  assert.ok(params.includes(3));
  assert.ok(params.includes(7));

  // BOTH in one statement. The day and the hour are one wall clock, and a save
  // that landed halfway would put the digest at a time nobody chose.
  assert.match(sql, /^update "churches" set /i);
  assert.equal(sql.match(/^update/gim)?.length, 1);

  // AND NOT ONE `notification_preferences` ROW (#618's AC, restating N-013).
  // The CHURCH says when the digest lands; the RECIPIENT still says whether
  // they want one and how often, and neither answer may overwrite the other.
  // A write that reached those rows would be the church deciding for a person.
  assert.doesNotMatch(sql, /notification_preferences/i);
});

test("an out-of-range weekday or hour is rejected on write rather than stored", () => {
  for (const schedule of [
    { weekday: 7, hour: 16 },
    { weekday: -1, hour: 16 },
    { weekday: 0.5, hour: 16 },
    { weekday: 0, hour: 24 },
    { weekday: 0, hour: -1 },
    { weekday: 0, hour: Number.NaN },
  ]) {
    assert.throws(
      () => setChurchDigestScheduleQuery(CHURCH_ID, schedule),
      InvalidDigestScheduleError,
      `${JSON.stringify(schedule)} was accepted`
    );
  }

  // The two ends of each range ARE valid — midnight and 11 PM, Sunday and
  // Saturday. A guard that rejected hour 0 would be the same bug inverted.
  for (const schedule of [
    { weekday: 0, hour: 0 },
    { weekday: 6, hour: 23 },
  ]) {
    assert.ok(setChurchDigestScheduleQuery(CHURCH_ID, schedule).toSQL().sql);
  }

  // The statement is never built, so a bad value cannot appear in SQL.
  try {
    setChurchDigestScheduleQuery(CHURCH_ID, { weekday: 0, hour: 24 });
    assert.fail("expected InvalidDigestScheduleError");
  } catch (error) {
    assert.ok(error instanceof InvalidDigestScheduleError);
    assert.equal(error.field, "hour");
    assert.doesNotMatch(
      String(error.stack ?? ""),
      /update/i,
      "the throw must precede the statement"
    );
  }
});

test("the migration adds both columns with the ruled defaults and CHECKs behind them", () => {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "src/db/migrations/0058_church_digest_send_time.sql"
    ),
    "utf8"
  );

  // Sunday 16:00 — the ruling of 2026-08-15, and the backfill for every church
  // that predates the column, in the same statement.
  assert.match(
    sql,
    /ADD COLUMN "digest_send_weekday" integer DEFAULT 0 NOT NULL/
  );
  assert.match(
    sql,
    /ADD COLUMN "digest_send_hour" integer DEFAULT 16 NOT NULL/
  );

  // The strongest available guard, not only the action's parser.
  assert.match(
    sql,
    /"churches_digest_send_weekday_check" CHECK[\s\S]*?0 and 6/
  );
  assert.match(sql, /"churches_digest_send_hour_check" CHECK[\s\S]*?0 and 23/);
});

// ----------------------------------------------------------------------------
// The church profile — name and address (CS-006, #618)
// ----------------------------------------------------------------------------

test("each profile field writes ITS OWN column and no other", () => {
  // CS-015 is "each field saves independently", and independence is a property
  // of the STATEMENT, not of the UI: a write that touched a neighbouring column
  // would make a failed save of one field a failed save of two. Walking the
  // registry rather than listing five cases means a sixth field cannot be added
  // without this assertion covering it.
  const columns: Record<string, string> = {
    name: '"name"',
    streetAddress: '"street_address"',
    city: '"city"',
    stateRegion: '"state_region"',
    country: '"country"',
  };

  for (const field of CHURCH_PROFILE_FIELDS) {
    // Parsed rather than cast: `churchProfileWriteSchema` is what narrows a
    // field id to its arm, so the write helper is exercised with exactly the
    // value the action would hand it — and the test needs no `as never`.
    const { sql, params } = setChurchProfileFieldQuery(
      CHURCH_ID,
      churchProfileWriteSchema.parse({ field: field.id, value: "Dayspring" })
    ).toSQL();

    const setClause = sql.slice(sql.indexOf("set "), sql.indexOf(" where "));

    assert.match(setClause, new RegExp(columns[field.id]), field.id);
    assert.ok(params.includes(CHURCH_ID), field.id);
    assert.ok(params.includes("Dayspring"), field.id);

    for (const [other, column] of Object.entries(columns)) {
      if (other === field.id) continue;
      assert.doesNotMatch(
        setClause,
        new RegExp(column),
        `writing ${field.id} also wrote ${other}`
      );
    }

    // `updated_at` is the ONE column every write here shares, and it is not a
    // profile field — it is the row's own bookkeeping, as on the zone and the
    // digest writes above.
    assert.match(setClause, /"updated_at"/, field.id);
  }
});

test("clearing an optional profile field stores NULL, never an empty string", () => {
  // OB-002's contract: one flavour of absent. Two would make every later reader
  // — settings, SEND reporting, merge fields — know about both.
  const { sql, params } = setChurchProfileFieldQuery(CHURCH_ID, {
    field: "city",
    value: null,
  }).toSQL();

  assert.match(sql, /"city"/);
  assert.ok(!params.includes(""), "an empty string reached the statement");
});

test("the profile write touches `churches` and nothing else", () => {
  for (const field of CHURCH_PROFILE_FIELDS) {
    const { sql } = setChurchProfileFieldQuery(
      CHURCH_ID,
      churchProfileWriteSchema.parse({ field: field.id, value: "x" })
    ).toSQL();

    assert.match(sql, /^update "churches" set /i, field.id);
    assert.equal(sql.match(/^update/gim)?.length, 1, field.id);
    // NOTHING about launch, and nothing about a person's preferences: CS-014
    // says Launch Sunday appears nowhere on this page, and the digest schedule
    // above is a CHURCH decision that must never reach a user's own rows.
    assert.doesNotMatch(sql, /launch/i, field.id);
    assert.doesNotMatch(sql, /notification_preferences/i, field.id);
  }
});

// ----------------------------------------------------------------------------
// Inactivity thresholds (CS-009, #618)
// ----------------------------------------------------------------------------

test("the inactivity write names both columns and the church, in one statement", () => {
  const { sql, params } = setChurchInactivityThresholdsQuery(CHURCH_ID, {
    warningDays: 10,
    alertDays: 30,
  }).toSQL();

  assert.match(sql, /"inactivity_warning_days"/);
  assert.match(sql, /"inactivity_alert_days"/);
  assert.match(sql, /"churches"/);
  assert.ok(params.includes(CHURCH_ID));
  assert.ok(params.includes(10));
  assert.ok(params.includes(30));

  // BOTH in one statement, for the reason the digest schedule is: the pair is
  // one decision and a half-landed save is `warning > alert`, a combination the
  // planter never chose and the people list would read as nonsense.
  assert.match(sql, /^update "churches" set /i);
  assert.equal(sql.match(/^update/gim)?.length, 1);
});

test("warning must be strictly below alert, and the refusal names the warning", () => {
  for (const thresholds of [
    { warningDays: 14, alertDays: 14 },
    { warningDays: 30, alertDays: 14 },
  ]) {
    assert.throws(
      () => setChurchInactivityThresholdsQuery(CHURCH_ID, thresholds),
      InvalidInactivityThresholdsError,
      `${JSON.stringify(thresholds)} was accepted`
    );
  }

  try {
    setChurchInactivityThresholdsQuery(CHURCH_ID, {
      warningDays: 30,
      alertDays: 14,
    });
    assert.fail("expected InvalidInactivityThresholdsError");
  } catch (error) {
    assert.ok(error instanceof InvalidInactivityThresholdsError);
    // CS-015: the refusal names a FIELD. It is the warning count, because that
    // is the one the planter is told to lower.
    assert.equal(error.field, "warningDays");
    assert.doesNotMatch(
      String(error.stack ?? ""),
      /update/i,
      "the throw must precede the statement"
    );
  }
});

test("an out-of-range day count is rejected on write rather than stored", () => {
  for (const thresholds of [
    { warningDays: 0, alertDays: 14 },
    { warningDays: 7, alertDays: 366 },
    { warningDays: 7.5, alertDays: 14 },
    { warningDays: Number.NaN, alertDays: 14 },
  ]) {
    assert.throws(
      () => setChurchInactivityThresholdsQuery(CHURCH_ID, thresholds),
      InvalidInactivityThresholdsError,
      `${JSON.stringify(thresholds)} was accepted`
    );
  }

  // Both ends of the range ARE valid. A guard that rejected 1 or 365 would be
  // the same bug inverted.
  assert.ok(
    setChurchInactivityThresholdsQuery(CHURCH_ID, {
      warningDays: 1,
      alertDays: 365,
    }).toSQL().sql
  );
});

test("the inactivity columns carry NO check constraint, deliberately", () => {
  // The line is what a bad value COSTS (see the columns' own comment and
  // 0062's header): a stored digest hour of 24 is a send that never happens and
  // is never noticed, so it earned a CHECK in 0056; a warning of 400 days is
  // wrong on the next `/people` load, in the same session, one click from the
  // control that set it. This test exists so that flipping that choice is a
  // deliberate edit here rather than a silent one in a migration.
  const schema = readFileSync(
    path.join(process.cwd(), "src/db/schema/church.ts"),
    "utf8"
  );

  // `[\s\S]` rather than the `s` flag: the repo's `tsc` target predates
  // es2018 and rejects `dotAll` at compile time even though node runs it.
  assert.doesNotMatch(schema, /inactivity_warning_days[\s\S]{0,40}between/i);
  assert.match(
    schema,
    /churches_digest_send_hour_check/,
    "the digest CHECK is the comparison this rule is stated against"
  );
});

test("0062 adds one nullable street address and nothing else", () => {
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "src/db/migrations/0062_church_street_address.sql"
    ),
    "utf8"
  );

  const statements = sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n")
    .trim();

  assert.equal(
    statements,
    'ALTER TABLE "churches" ADD COLUMN "street_address" varchar(255);'
  );
  // NULLABLE and with no default — a catalog-only change, no table rewrite, and
  // NULL is the one flavour of absent this table carries.
  assert.doesNotMatch(statements, /NOT NULL/);
  assert.doesNotMatch(statements, /DEFAULT/);
});
