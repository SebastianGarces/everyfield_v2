import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/db";
import { churches, users } from "@/db/schema";
import { getLaunchForChurch } from "@/lib/launch/queries";
import { buildResolvedChurchMergeData } from "./merge";

/** The Owner belongs to this plant alone, including on legacy malformed rows. */
export function churchMergeFactsQuery(churchId: string) {
  return db
    .select({
      name: churches.name,
      leadershipStatus: churches.leadershipStatus,
      ownerName: users.name,
    })
    .from(churches)
    .leftJoin(
      users,
      and(
        eq(users.churchId, churches.id),
        eq(users.seat, "owner"),
        isNull(users.sendingChurchId),
        isNull(users.sendingNetworkId)
      )
    )
    .where(eq(churches.id, churchId))
    .limit(1);
}

/** Trusted server callers pass their session's church id; this is not an action. */
export async function getChurchMergeData(
  churchId: string
): Promise<Record<string, string>> {
  const [[church], launch] = await Promise.all([
    churchMergeFactsQuery(churchId),
    getLaunchForChurch(churchId),
  ]);
  if (!church) throw new Error("Church not found");
  return buildResolvedChurchMergeData({
    name: church.name,
    ownerName: church.ownerName,
    leadershipStatus: church.leadershipStatus,
    targetDate: launch?.targetDate ?? null,
  });
}
