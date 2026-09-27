import { and, asc, eq, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@/db";
import { persons } from "@/db/schema";
import { peopleTextSearch } from "@/lib/people/service";
import { canLeadTeam } from "./leader-eligibility";

export interface LeaderCandidate {
  id: string;
  firstName: string;
  lastName: string;
}

/** The picker uses the same eligibility predicate rechecked by the write. */
export async function searchLeaderCandidates(
  churchId: string,
  query: string
): Promise<LeaderCandidate[]> {
  const candidate = alias(persons, "leader_candidate");
  return db
    .select({
      id: candidate.id,
      firstName: candidate.firstName,
      lastName: candidate.lastName,
    })
    .from(candidate)
    .where(
      and(
        eq(candidate.churchId, churchId),
        canLeadTeam(churchId, sql`${candidate.id}`),
        query
          ? sql`${candidate.id} in (${db
              .select({ id: persons.id })
              .from(persons)
              .where(
                and(eq(persons.churchId, churchId), peopleTextSearch(query))
              )})`
          : undefined
      )
    )
    .orderBy(
      asc(candidate.lastName),
      asc(candidate.firstName),
      asc(candidate.id)
    )
    .limit(50);
}
