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

import type { Church } from "@/db/schema";
import { getCurrentSession, getCurrentUserChurch } from "@/lib/auth/session";
import { getLaunchForChurch } from "@/lib/launch/queries";

import type { MergeContext } from "./merge";

/**
 * Resolve the current user's church and the merge context for it, or `null`
 * when the session has no church behind it (no session, no `churchId`, or a
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
export async function resolveDocumentMergeContext(): Promise<{
  church: Church;
  context: MergeContext;
} | null> {
  const church = await getCurrentUserChurch();
  if (!church) return null;

  // Cache hit, not a second DB read — `getCurrentSession` is request-cached
  // (memory/invariants.md → Request Deduplication).
  const { user } = await getCurrentSession();
  const launch = await getLaunchForChurch(church.id);

  return {
    church,
    context: {
      churchName: church.name,
      userName: user?.name ?? null,
      launchDate: launch?.targetDate ?? null,
    },
  };
}
