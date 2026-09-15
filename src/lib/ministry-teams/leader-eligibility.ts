import { db } from "@/db";
import { persons, users } from "@/db/schema";
import {
  and,
  eq,
  exists,
  isNotNull,
  isNull,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

/** CRM contacts need no login. A linked account removed under AS-016 must
 * regain a seat in this plant before it can be appointed leader again.
 * Evaluate inside the batch, after acquiring the plant leadership lock.
 */
export function canLeadTeam(
  churchId: string,
  personId: string | SQL
): SQL<boolean> {
  return sql<boolean>`${exists(
    db
      .select({ one: sql`1` })
      .from(persons)
      .where(
        and(
          eq(persons.id, personId),
          eq(persons.churchId, churchId),
          isNull(persons.deletedAt),
          or(
            isNull(persons.userId),
            exists(
              db
                .select({ one: sql`1` })
                .from(users)
                .where(
                  and(
                    eq(users.id, persons.userId),
                    eq(users.churchId, churchId),
                    isNull(users.sendingChurchId),
                    isNull(users.sendingNetworkId),
                    isNotNull(users.seat)
                  )
                )
            )
          )
        )
      )
  )}`;
}
