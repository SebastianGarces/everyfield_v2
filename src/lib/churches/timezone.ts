import { eq } from "drizzle-orm";

import { db } from "@/db";
import { churches } from "@/db/schema/church";
import { isValidTimeZone } from "@/lib/datetime";

// ============================================================================
// The church's IANA timezone — read and write.
//
// ONE column on `churches`. The settings screen is the only writer; display
// paths read the same column off the church row they already loaded and pass
// it into `src/lib/datetime.ts`. This module exists so the `"use server"`
// action does not reach `@/db` itself (the settings actions' ownership
// boundary) and so an invalid id is rejected here, not only in the parser.
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
