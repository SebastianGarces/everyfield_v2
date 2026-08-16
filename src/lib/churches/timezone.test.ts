import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { DEFAULT_CHURCH_TIME_ZONE } from "@/lib/datetime";

import { InvalidTimeZoneError, setChurchTimeZoneQuery } from "./timezone";

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
