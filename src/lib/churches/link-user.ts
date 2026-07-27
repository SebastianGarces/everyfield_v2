import { users } from "@/db/schema";
import { and, eq, isNull, type SQL } from "drizzle-orm";

/**
 * Compare-and-set filter for linking a user to a newly created church.
 *
 * BOTH predicates are load-bearing (#183): `eq(users.id, userId)` scopes the
 * write to the caller — without it the update claims every church-less user on
 * the platform, including oversight admins whose church_id is null by design.
 * `isNull(users.churchId)` makes the update a true compare-and-set so a
 * double-submit race matches zero rows instead of relinking.
 */
export function linkUserToChurchFilter(userId: string): SQL {
  const filter = and(eq(users.id, userId), isNull(users.churchId));
  if (!filter) throw new Error("unreachable: both conditions are defined");
  return filter;
}
