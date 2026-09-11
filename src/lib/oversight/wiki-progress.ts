import {
  and,
  count,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  or,
  sql,
} from "drizzle-orm";
import type { Database } from "@/db";

import { users, wikiArticles, wikiProgress } from "@/db/schema";

/**
 * Current members' carried reading progress, not activity attributed to a plant.
 * Progress is keyed by account and slug. Only currently available articles count;
 * EXISTS keeps a global article plus its local override from counting twice.
 * No account identity, article slug or reading timestamp leaves this query.
 */
export function wikiProgressAggregateQuery(
  database: Database,
  churchId: string
) {
  return database
    .select({ status: wikiProgress.status, total: count() })
    .from(wikiProgress)
    .innerJoin(users, eq(users.id, wikiProgress.userId))
    .where(
      and(
        eq(users.churchId, churchId),
        isNotNull(users.seat),
        isNull(users.sendingChurchId),
        isNull(users.sendingNetworkId),
        inArray(wikiProgress.status, ["completed", "in_progress"]),
        exists(
          database
            .select({ present: sql`1` })
            .from(wikiArticles)
            .where(
              and(
                eq(wikiArticles.slug, wikiProgress.articleSlug),
                eq(wikiArticles.status, "published"),
                or(
                  isNull(wikiArticles.churchId),
                  eq(wikiArticles.churchId, churchId)
                )
              )
            )
        )
      )
    )
    .groupBy(wikiProgress.status);
}

/** Called only after the plant membership and wiki-sharing gates in read.ts. */
export async function readWikiProgressAggregate(churchId: string) {
  const { db } = await import("@/db");
  const rows = await wikiProgressAggregateQuery(db, churchId);
  return {
    completed: rows.find((row) => row.status === "completed")?.total ?? 0,
    inProgress: rows.find((row) => row.status === "in_progress")?.total ?? 0,
  };
}
