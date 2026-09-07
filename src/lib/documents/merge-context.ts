// ============================================================================
// Document Templates — merge-context resolution (F6)
// ============================================================================
//
// The ONE place the current planter's `MergeContext` is resolved, so the
// library page's auto-fill preview and the generation route name the same
// church, pastor, and launch day. Server-only (reads the session and the
// database) — deliberately NOT re-exported from ./index, which client
// components import.
// ============================================================================

import { getCurrentSession, getCurrentUserChurch } from "@/lib/auth/session";
import { getLaunchForChurch } from "@/lib/launch/queries";
import { and, eq, isNotNull, isNull } from "drizzle-orm";
import { db } from "@/db";
import { churches, users } from "@/db/schema";
import type { EvryPlantActor } from "@/lib/evry/eligibility/viewer";

import type { MergeContext } from "./merge";

/**
 * The current planter's church, resolved once: the id every church-scoped
 * write binds, and the merge values every render fills in. They travel
 * together because the church row answers both, so a caller that got a
 * context has already been told it has a church and never asks again.
 */
export type ResolvedDocumentContext = {
  churchId: string;
  merge: MergeContext;
};

/**
 * Resolve the document context for the current user's church, or `null` when
 * the session has no church behind it (no session, no `churchId`, or a
 * dangling church row). Each caller keeps its own failure shape — the route
 * answers 400, the page redirects.
 *
 * The launch date comes from the LAUNCH ENTITY (`launches.target_date`,
 * LS-001) and never from the church row, whose `launch_date` column migration
 * 0032 dropped. Resolving it here, once, is what keeps the dialog's preview
 * and the generated file agreeing about the day (#306). A request-supplied
 * `?launch_date=` still overrides it: provided values win in
 * `resolveMergeValues`, and this is only the auto-fill default.
 */
export async function resolveDocumentMergeContext(): Promise<ResolvedDocumentContext | null> {
  const church = await getCurrentUserChurch();
  if (!church) return null;

  // Cache hit, not a second DB read — `getCurrentSession` is request-cached
  // (memory/invariants.md → Request Deduplication).
  const { user } = await getCurrentSession();
  const launch = await getLaunchForChurch(church.id);

  return {
    churchId: church.id,
    merge: {
      churchName: church.name,
      userName: user?.name ?? null,
      launchDate: launch?.targetDate ?? null,
    },
  };
}

/** Resolve the same merge context from a freshly authorized Evry plant actor. */
export async function resolveDocumentMergeContextForActor(
  actor: EvryPlantActor
): Promise<ResolvedDocumentContext | null> {
  const [row] = await db
    .select({ churchName: churches.name, userName: users.name })
    .from(users)
    .innerJoin(churches, eq(churches.id, users.churchId))
    .where(
      and(
        eq(users.id, actor.userId),
        eq(users.churchId, actor.plantId),
        isNotNull(users.seat),
        isNull(users.sendingChurchId),
        isNull(users.sendingNetworkId)
      )
    )
    .limit(1);
  if (!row) return null;
  const launch = await getLaunchForChurch(actor.plantId);
  return {
    churchId: actor.plantId,
    merge: {
      churchName: row.churchName,
      userName: row.userName,
      launchDate: launch?.targetDate ?? null,
    },
  };
}
