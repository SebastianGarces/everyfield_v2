"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { verifySession } from "@/lib/auth/session";
import {
  markAllNotificationsRead,
  markNotificationRead,
} from "@/lib/notifications/mark-read";

// ============================================================================
// Mark-read actions (N-009).
//
// Both actions derive the SCOPE from the session — never from the caller. The
// only thing a client is trusted with is a notification id, and an id is not a
// capability: it is intersected with the session's church and the session's
// user inside the UPDATE's WHERE clause (`src/lib/notifications/mark-read.ts`),
// so a forged id belonging to another church, or to a colleague in the same
// church, updates zero rows and returns `markedCount: 0` — the same answer as
// an id that was already read. There is no oracle here.
//
// `refresh()` rather than `revalidatePath("/notifications")` because the unread
// badge does not live on this page: it lives in the dashboard LAYOUT's header,
// which every route renders. `refresh()` re-renders the current tree including
// its layouts, so the count in the app shell reconciles with the same server
// state the feed just re-read. The feed itself does not wait for it — it holds
// an optimistic row state (memory/contracts/data-patterns.md) — so the visible
// effect is instant and the badge follows.
// ============================================================================

/** What a mark-read action tells the caller. */
export type MarkReadActionResult =
  | { success: true; markedCount: number }
  | { success: false; error: string };

const notificationIdSchema = z.string().uuid();

/**
 * Resolve the session into a read scope, or say why there isn't one.
 *
 * A user with no church has no notifications — every row is church-scoped — so
 * this is a real (if rare) state rather than an assertion: an oversight user
 * mid-association, or an account whose church was removed.
 */
async function currentScope(): Promise<
  | { ok: true; scope: { churchId: string; recipientUserId: string } }
  | { ok: false; error: string }
> {
  const { user } = await verifySession();

  if (!user.churchId) {
    return { ok: false, error: "You are not associated with a church" };
  }

  return {
    ok: true,
    scope: { churchId: user.churchId, recipientUserId: user.id },
  };
}

/**
 * Mark one notification read.
 *
 * Idempotent: marking an already-read notification succeeds with
 * `markedCount: 0` and leaves the original read instant alone.
 */
export async function markNotificationReadAction(
  notificationId: string
): Promise<MarkReadActionResult> {
  const parsed = notificationIdSchema.safeParse(notificationId);
  if (!parsed.success) {
    return { success: false, error: "Invalid notification" };
  }

  const resolved = await currentScope();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const { markedCount } = await markNotificationRead(
    resolved.scope,
    parsed.data
  );

  refresh();

  return { success: true, markedCount };
}

/** Mark every visible unread notification read (N-009). */
export async function markAllNotificationsReadAction(): Promise<MarkReadActionResult> {
  const resolved = await currentScope();
  if (!resolved.ok) {
    return { success: false, error: resolved.error };
  }

  const { markedCount } = await markAllNotificationsRead(resolved.scope);

  refresh();

  return { success: true, markedCount };
}
