import { eq } from "drizzle-orm";

import { db } from "@/db";
import { churches, type NewChurch } from "@/db/schema/church";
import { isValidTimeZone } from "@/lib/datetime";
import {
  INACTIVITY_DAYS_MAX,
  INACTIVITY_DAYS_MIN,
  type ChurchProfileWrite,
} from "@/lib/churches/profile";

// ============================================================================
// THE CHURCH-LEVEL SETTINGS WRITES — the profile, the timezone, when the digest
// lands, and how long silence runs before it is worth saying so.
//
// Columns on `churches`, written by the settings screen and read by whoever
// already loaded the church row. This module exists so the `"use server"`
// actions do not reach `@/db` themselves (the settings actions' ownership
// boundary) and so a value the schema would reject is rejected HERE, not only
// in the action's parser.
//
// The two live together because they are ONE decision from the reader's seat:
// `digest_send_weekday` and `digest_send_hour` are a wall clock, and
// `time_zone` is the clock they are read on. `digestAnchorFrom` in
// `src/lib/notifications/digest-content.ts` composes all three into the anchor
// the digest's period arithmetic runs on; splitting the writes across two
// modules would have hidden that they answer to each other.
//
// Authorisation is the caller's: the action layer checks the actor is the
// plant's planter. This module writes.
// ============================================================================

/**
 * Persist a church's display timezone.
 *
 * Invalid IANA ids throw BEFORE the statement is built, so a bad value cannot
 * land even if a caller skipped the action's parser. An empty `returning()`
 * means the church id named no row — the action treats that as a save failure,
 * never as success with a stale value.
 */
export function setChurchTimeZoneQuery(churchId: string, timeZone: string) {
  if (!isValidTimeZone(timeZone)) {
    throw new InvalidTimeZoneError(timeZone);
  }

  return db
    .update(churches)
    .set({ timeZone, updatedAt: new Date() })
    .where(eq(churches.id, churchId))
    .returning({ timeZone: churches.timeZone });
}

export async function setChurchTimeZone(
  churchId: string,
  timeZone: string
): Promise<string> {
  const [row] = await setChurchTimeZoneQuery(churchId, timeZone);
  if (!row) {
    throw new Error("CHURCH_NOT_FOUND");
  }
  return row.timeZone;
}

export class InvalidTimeZoneError extends Error {
  readonly timeZone: string;

  constructor(timeZone: string) {
    super("INVALID_TIME_ZONE");
    this.name = "InvalidTimeZoneError";
    this.timeZone = timeZone;
  }
}

// ----------------------------------------------------------------------------
// When the digest lands (N-013, #448)
// ----------------------------------------------------------------------------

/** What the church's digest schedule is, and what a caller may set it to. */
export interface ChurchDigestSchedule {
  /** 0–6, Sunday first. The WEEKLY cadence's day. */
  weekday: number;
  /** 0–23, on the wall clock in the church's `time_zone`. Both cadences. */
  hour: number;
}

/**
 * OUT OF RANGE IS REJECTED BEFORE THE STATEMENT IS BUILT, exactly as an invalid
 * zone is above, and the `CHECK` constraints behind it would reject it again.
 *
 * Both guards are deliberate and neither is redundant. The constraint is the
 * one that cannot be forgotten — it holds against a migration, a script and a
 * psql session alike — and this throw is what turns a 23514 into a sentence the
 * settings screen can show, at the layer that knows which field was wrong.
 */
export function setChurchDigestScheduleQuery(
  churchId: string,
  schedule: ChurchDigestSchedule
) {
  assertInRange("weekday", schedule.weekday, 6);
  assertInRange("hour", schedule.hour, 23);

  return db
    .update(churches)
    .set({
      digestSendWeekday: schedule.weekday,
      digestSendHour: schedule.hour,
      updatedAt: new Date(),
    })
    .where(eq(churches.id, churchId))
    .returning({
      weekday: churches.digestSendWeekday,
      hour: churches.digestSendHour,
    });
}

export async function setChurchDigestSchedule(
  churchId: string,
  schedule: ChurchDigestSchedule
): Promise<ChurchDigestSchedule> {
  const [row] = await setChurchDigestScheduleQuery(churchId, schedule);
  if (!row) {
    throw new Error("CHURCH_NOT_FOUND");
  }
  return row;
}

function assertInRange(
  field: ChurchDigestScheduleField,
  value: number,
  max: number
): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    throw new InvalidDigestScheduleError(field, value);
  }
}

export type ChurchDigestScheduleField = "weekday" | "hour";

export class InvalidDigestScheduleError extends Error {
  readonly field: ChurchDigestScheduleField;
  readonly value: number;

  constructor(field: ChurchDigestScheduleField, value: number) {
    super("INVALID_DIGEST_SCHEDULE");
    this.name = "InvalidDigestScheduleError";
    this.field = field;
    this.value = value;
  }
}

// ----------------------------------------------------------------------------
// The church profile — name and address (CS-006, #618)
// ----------------------------------------------------------------------------
//
// ONE FIELD PER CALL, because CS-015 says each saves independently and a
// whole-profile write would make a failure in any one of them a failure of all
// five. The value arrives ALREADY PARSED as `ChurchProfileWrite`
// (`./profile.ts`), which is the discriminated union whose `name` arm is
// `string` and whose four optional arms are `string | null` — so the statement
// below needs no "but is this the name?" guard: a NULL name is not a value this
// signature accepts.
//
// THIS IS THE ONLY WRITER OF `churches.name` OUTSIDE CREATION. The name was
// settable exactly once until now — `churchCreationStatements` at onboarding
// step 1 — and it stays a single writer here rather than gaining a second
// surface: `./profile.test.ts` walks `src/` for every `.update(churches)`,
// holds the file list to a checked-in one, and asserts that no `.set()` outside
// THIS module names a profile column.

/**
 * Persist one church-profile field.
 *
 * An empty `returning()` means the church id named no row — the action treats
 * that as a save failure, never as success with a stale value, exactly as the
 * timezone write above does.
 */
export function setChurchProfileFieldQuery(
  churchId: string,
  write: ChurchProfileWrite
) {
  return db
    .update(churches)
    .set({ ...profilePatch(write), updatedAt: new Date() })
    .where(eq(churches.id, churchId))
    .returning({
      name: churches.name,
      streetAddress: churches.streetAddress,
      city: churches.city,
      stateRegion: churches.stateRegion,
      country: churches.country,
    });
}

export async function setChurchProfileField(
  churchId: string,
  write: ChurchProfileWrite
): Promise<string | null> {
  const [row] = await setChurchProfileFieldQuery(churchId, write);
  if (!row) {
    throw new Error("CHURCH_NOT_FOUND");
  }
  return row[write.field];
}

/**
 * The field id to the column it names.
 *
 * EXHAUSTIVE BY CONSTRUCTION: the switch returns on every arm and declares no
 * default, so widening `ChurchProfileField` fails the build here until the new
 * field names a column. That is the whole reason this is a switch and not
 * `{ [write.field]: write.value }` — a computed key compiles for a field the
 * table does not have.
 */
function profilePatch(write: ChurchProfileWrite): Partial<NewChurch> {
  switch (write.field) {
    case "name":
      return { name: write.value };
    case "streetAddress":
      return { streetAddress: write.value };
    case "city":
      return { city: write.value };
    case "stateRegion":
      return { stateRegion: write.value };
    case "country":
      return { country: write.value };
  }
}

// ----------------------------------------------------------------------------
// Inactivity thresholds (CS-009, #618)
// ----------------------------------------------------------------------------
//
// The same shape as the digest schedule above — TWO NUMBERS WRITTEN TOGETHER,
// because `warning` must stay below `alert` and a half-landed save is a pair
// nobody chose. Rejected before the statement is built, and NOT by a `CHECK`:
// the argument for that line is on the columns themselves
// (`src/db/schema/church.ts`) and in 0062's header.

export interface ChurchInactivityThresholds {
  /** Days of silence before a contact is flagged. Below `alertDays`. */
  warningDays: number;
  /** Days of silence before the flag escalates. */
  alertDays: number;
}

export function setChurchInactivityThresholdsQuery(
  churchId: string,
  thresholds: ChurchInactivityThresholds
) {
  assertDayCount("warningDays", thresholds.warningDays);
  assertDayCount("alertDays", thresholds.alertDays);
  if (thresholds.warningDays >= thresholds.alertDays) {
    throw new InvalidInactivityThresholdsError(
      "warningDays",
      thresholds.warningDays
    );
  }

  return db
    .update(churches)
    .set({
      inactivityWarningDays: thresholds.warningDays,
      inactivityAlertDays: thresholds.alertDays,
      updatedAt: new Date(),
    })
    .where(eq(churches.id, churchId))
    .returning({
      warningDays: churches.inactivityWarningDays,
      alertDays: churches.inactivityAlertDays,
    });
}

export async function setChurchInactivityThresholds(
  churchId: string,
  thresholds: ChurchInactivityThresholds
): Promise<ChurchInactivityThresholds> {
  const [row] = await setChurchInactivityThresholdsQuery(churchId, thresholds);
  if (!row) {
    throw new Error("CHURCH_NOT_FOUND");
  }
  return row;
}

function assertDayCount(
  field: InactivityThresholdWriteField,
  value: number
): void {
  if (
    !Number.isInteger(value) ||
    value < INACTIVITY_DAYS_MIN ||
    value > INACTIVITY_DAYS_MAX
  ) {
    throw new InvalidInactivityThresholdsError(field, value);
  }
}

export type InactivityThresholdWriteField = "warningDays" | "alertDays";

export class InvalidInactivityThresholdsError extends Error {
  readonly field: InactivityThresholdWriteField;
  readonly value: number;

  constructor(field: InactivityThresholdWriteField, value: number) {
    super("INVALID_INACTIVITY_THRESHOLDS");
    this.name = "InvalidInactivityThresholdsError";
    this.field = field;
    this.value = value;
  }
}
