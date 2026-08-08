// ============================================================================
// The journal, with the actor's NAME (LS-002/LS-009).
//
// NO `"use server"` DIRECTIVE — same rule as every module under
// `src/lib/launch/` (memory/invariants.md → Authentication, the #265 rules).
//
// WHY THIS IS NOT A SECOND JOURNAL QUERY. `getLaunchJournal` (queries.ts) is
// still the one read of `launch_events`; this composes it with ONE batched name
// lookup, because the page shows "who moved the date" and the journal row
// stores an id. Re-writing the journal read with a JOIN would give two
// definitions of "the journal"; looking each actor up inside the render loop
// would be an N+1. Neither, then: one journal read, one `inArray` for the
// handful of distinct actors it names.
// ============================================================================

import { inArray } from "drizzle-orm";

import { db } from "@/db";
import { users } from "@/db/schema";
import type { LaunchEventType, LaunchStatus } from "@/db/schema/launch";
import { getLaunchJournal } from "./queries";

export interface LaunchJournalEntry {
  id: string;
  event: LaunchEventType;
  /**
   * The status the launch held BEFORE this row, carried through because it is
   * what distinguishes the first recording of an outcome from a later
   * CORRECTION of it (LS-006): both are `completed` events, and only a
   * correction comes from a launch that was already `completed`. The label the
   * history shows is derived from the pair — see `journalEntryLabel`
   * (`src/components/launch/presentation.ts`).
   */
  previousStatus: LaunchStatus;
  status: LaunchStatus;
  previousTargetDate: string | null;
  targetDate: string | null;
  note: string | null;
  actorName: string | null;
  createdAt: Date;
}

/** One launch's history, oldest first — the order the story happened in. */
export async function getLaunchJournalEntries(
  launchId: string,
  churchId: string
): Promise<LaunchJournalEntry[]> {
  const rows = await getLaunchJournal(launchId, churchId);
  if (rows.length === 0) return [];

  const actorIds = [...new Set(rows.map((row) => row.actorUserId))];
  const actorRows = await db
    .select({ id: users.id, name: users.name, email: users.email })
    .from(users)
    .where(inArray(users.id, actorIds));

  const names = new Map(
    actorRows.map((actor) => [actor.id, actor.name || actor.email])
  );

  return rows.map((row) => ({
    id: row.id,
    event: row.event,
    previousStatus: row.previousStatus,
    status: row.status,
    previousTargetDate: row.previousTargetDate,
    targetDate: row.targetDate,
    note: row.note,
    actorName: names.get(row.actorUserId) ?? null,
    createdAt: row.createdAt,
  }));
}
