import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";

import { churches, sendingChurches, type User } from "@/db/schema";
import { oversightOrgOf } from "@/lib/auth/tenancy";

/** Organization identity and plant existence are relationship context, not private feature data. */
export async function getNetworkSendingChurchDetail(
  user: User,
  sendingChurchId: string
) {
  const org = oversightOrgOf(user);
  if (org?.type !== "network" || !z.uuid().safeParse(sendingChurchId).success)
    return null;

  const { db } = await import("@/db");
  const [member] = await db
    .select({ id: sendingChurches.id, name: sendingChurches.name })
    .from(sendingChurches)
    .where(
      and(
        eq(sendingChurches.id, sendingChurchId),
        eq(sendingChurches.sendingNetworkId, org.id)
      )
    )
    .limit(1);
  if (!member) return null;

  // Membership alone does not give a network access to every plant of this sending church.
  const plants = await db
    .select({
      id: churches.id,
      name: churches.name,
      currentPhase: churches.currentPhase,
    })
    .from(churches)
    .where(
      and(
        eq(churches.sendingChurchId, member.id),
        eq(churches.sendingNetworkId, org.id)
      )
    )
    .orderBy(asc(churches.name), asc(churches.id));

  return { ...member, plants };
}
