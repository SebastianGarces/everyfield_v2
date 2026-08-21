// ============================================================================
// THE SCRATCH PLANT THE MINISTRY-TEAMS LIVE SUITES WRITE INTO (#311).
//
// WHY A SHARED MODULE AND NOT A THIRD COPY. `responsibilities-live.test.ts` and
// `leader-sync-live.test.ts` both need the same three rows — a church, an actor
// who owns it, and people to seat — and both need them SWEPT in the right FK
// order afterwards. That order is the part worth having once: `persons` is
// referenced by `ministry_teams.leader_id` and by `team_memberships`, and
// `users` by every `created_by`, so a delete list assembled by hand is a
// foreign-key error in whichever suite got it wrong.
//
// It is deliberately NOT a sweep of the older suites' fixtures. Each of those
// namespaces its own rows and owns its own actor, which is the property that
// lets them run beside each other; this module gives its callers the same
// property rather than pooling them.
//
// EVERYTHING IS NAMESPACED BY THE CALLER'S OWN `scratchName`, and `sweep`
// deletes only rows carrying it. Nothing here can reach real data even if it is
// pointed at a populated database.
// ============================================================================

import { sql, eq, like } from "drizzle-orm";

import { db } from "@/db";
import {
  churches,
  ministryTeams,
  persons,
  teamMemberships,
  teamResponsibilities,
  teamRoles,
  users,
} from "@/db/schema";

/**
 * `DATABASE_URL` is deliberately NOT the signal: CI sets an unreachable
 * placeholder on every `pnpm test` run, so keying on its presence would make
 * the hermetic suite take ECONNREFUSED.
 */
export const LIVE_DB = process.env.LIVE_DB_TESTS === "1";

export const liveSkip = LIVE_DB
  ? false
  : "opt-in: run `LIVE_DB_TESTS=1 pnpm test:live` — the assertion is about ROWS, and every path under test reaches the database";

export const UNREACHABLE =
  "SKIPPED — LIVE_DB_TESTS=1 was set but DATABASE_URL points at no reachable Postgres, so nothing under test ran";

export async function databaseReachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

export interface ScratchPlant {
  churchId: string;
  /** The Owner every scratch row is attributed to. */
  actorId: string;
}

/**
 * A plant and its Owner.
 *
 * THE ACTOR IS MINTED, NEVER BORROWED — the reasoning `teams-init-race.test.ts`
 * spells out: a suite that writes only inside its own namespace has to own its
 * actor too, or a parallel run's sweep fails on a `created_by` FK pointing at
 * somebody else's scratch user.
 */
export async function createScratchPlant(
  scratchName: string
): Promise<ScratchPlant> {
  const [church] = await db
    .insert(churches)
    .values({ name: scratchName, currentPhase: 3 })
    .returning({ id: churches.id });

  const [actor] = await db
    .insert(users)
    .values({
      email: `${crypto.randomUUID()}@scratch.invalid`,
      passwordHash: "scratch",
      name: scratchName,
      seat: "owner",
      churchId: church.id,
    })
    .returning({ id: users.id });

  return { churchId: church.id, actorId: actor.id };
}

/** Somebody to seat. Ordinary contact, no account link. */
export async function createScratchPerson(
  plant: ScratchPlant,
  firstName: string
): Promise<string> {
  const [person] = await db
    .insert(persons)
    .values({
      churchId: plant.churchId,
      firstName,
      lastName: "Scratch",
      createdBy: plant.actorId,
    })
    .returning({ id: persons.id });

  return person.id;
}

/**
 * Delete every row this namespace owns, in FK order.
 *
 * `ministry_teams.leader_id` references `persons`, so the teams go BEFORE the
 * people — the order the leader-sync suite is most likely to trip, since half
 * its assertions are about that column holding a value.
 */
export async function sweepScratch(scratchName: string): Promise<void> {
  const scratch = await db
    .select({ id: churches.id })
    .from(churches)
    .where(like(churches.name, scratchName));

  for (const church of scratch) {
    await db
      .delete(teamResponsibilities)
      .where(eq(teamResponsibilities.churchId, church.id));
    await db
      .delete(teamMemberships)
      .where(eq(teamMemberships.churchId, church.id));
    await db.delete(teamRoles).where(eq(teamRoles.churchId, church.id));
    await db.delete(ministryTeams).where(eq(ministryTeams.churchId, church.id));
    await db.delete(persons).where(eq(persons.churchId, church.id));
    await db
      .update(users)
      .set({ churchId: null })
      .where(eq(users.churchId, church.id));
    await db.delete(churches).where(eq(churches.id, church.id));
  }

  await db.delete(users).where(eq(users.name, scratchName));
}
