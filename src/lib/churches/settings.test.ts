import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_CHURCH_TIME_ZONE } from "@/lib/datetime";

import {
  InvalidDigestScheduleError,
  InvalidTimeZoneError,
  setChurchDigestScheduleQuery,
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
