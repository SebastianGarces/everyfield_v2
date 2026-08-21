import { eq } from "drizzle-orm";

import { db } from "@/db";
import { churches } from "@/db/schema/church";
import { isValidTimeZone } from "@/lib/datetime";

// ============================================================================
// THE CHURCH-LEVEL SETTINGS WRITES — the timezone, and when the digest lands.
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
