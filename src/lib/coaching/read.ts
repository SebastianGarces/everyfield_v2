// ============================================================================
// WHAT A COACH READS — the plant's OWN records, gated by the assignment and by
// nothing else (AS-008 / AS-011, #496).
//
// ----------------------------------------------------------------------------
// THE GATE IS THE ASSIGNMENT, AND `share_*` IS NOT CONSULTED
// ----------------------------------------------------------------------------
//
// `canAccessFeatureData` is deliberately absent from this module. The six
// `share_*` toggles gate what OVERSIGHT may pull out of a plant — a reach the
// plant did not ask for and can withdraw. A coach's reach is one the plant
// GRANTED, by name, in `coach_assignments`, and withdrawing it is ending the
// assignment rather than flipping a toggle. Consulting the toggles here would
// make a plant's decision to keep its people private silently revoke the
// coaching it had just asked for.
//
// (`canAccessFeatureData` would in fact answer `true` for a coach anyway, by way
// of `isChurchLevelUser` — a coach names no tenancy. Calling it would be a
// no-op that reads like a gate, which is worse than not calling it.)
//
// ----------------------------------------------------------------------------
// OWN RECORDS, NOT AGGREGATES — the difference from `@/lib/oversight/read`
// ----------------------------------------------------------------------------
//
// The oversight reader's header states three rules, and the third is "AGGREGATES
// ONLY: no name, email, address or person id in any SELECT". This module is the
// other side of that line on purpose: a coach sees the people, by name, because
// coaching a plant you cannot see is not coaching. The two readers never share a
// query, and neither reads the other's list of church ids — the oversight one
// starts from the ORG, this one from the ASSIGNMENTS. An account that holds both
// reaches therefore gets both answers, each in its own scope, from its own
// consent.
//
// ----------------------------------------------------------------------------
// READ ONLY, AND STRUCTURALLY SO
// ----------------------------------------------------------------------------
//
// There is no write here and there is no guard against one either, because none
// is reachable: every write verb in `@/lib/auth/seat-rules` is
// `tenancy: "plant"`, which demands a non-null `users.church_id`, and a coach
// has none. An account that coaches while holding a seat elsewhere passes those
// verbs only for ITS OWN plant, which this module never names.
// ============================================================================

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { churches, type Church, type User } from "@/db/schema";
import { listPeople } from "@/lib/people/service";
import type { PersonForClient } from "@/lib/people/types";
import { listTasks, type TaskListRow } from "@/lib/tasks/service";

import { coachesPlant } from "./assignments";

/** How many rows a coaching view opens with. Enough to be useful, not a report. */
const COACHED_PAGE_SIZE = 25;

export type CoachedPlant = {
  churchId: string;
  churchName: string;
  currentPhase: Church["currentPhase"];
  people: PersonForClient[];
  peopleTotal: number;
  tasks: TaskListRow[];
};

/**
 * Read an assigned plant, or `null`.
 *
 * `null` covers every reason alike — no such plant, no assignment, an assignment
 * that has been ended — so a coach probing church ids learns which plants exist
 * exactly as fast as they learn nothing.
 *
 * THE ASSIGNMENT IS CHECKED FIRST AND THE READS ARE NOT STARTED WITHOUT IT. The
 * same rule the oversight reader keeps for a withheld section: a refused read is
 * not issued and then discarded, it is not issued.
 */
export async function readCoachedPlant(
  user: Pick<User, "id">,
  churchId: string
): Promise<CoachedPlant | null> {
  if (!(await coachesPlant(user.id, churchId))) return null;

  const [church] = await db
    .select({ name: churches.name, currentPhase: churches.currentPhase })
    .from(churches)
    .where(eq(churches.id, churchId))
    .limit(1);

  if (!church) return null;

  const [people, tasks] = await Promise.all([
    listPeople(churchId, { limit: COACHED_PAGE_SIZE }),
    listTasks(churchId, { limit: COACHED_PAGE_SIZE }),
  ]);

  return {
    churchId,
    churchName: church.name,
    currentPhase: church.currentPhase,
    people: people.people,
    peopleTotal: people.total,
    tasks: tasks.tasks,
  };
}
