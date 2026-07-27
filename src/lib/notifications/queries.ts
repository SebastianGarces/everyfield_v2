import { and, count, desc, eq, isNull, lt, type SQL } from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  type Notification,
  type NotificationCategory,
} from "@/db/schema";

// ============================================================================
// Notification read paths (N-010).
//
// Tenancy is structural here, not a habit: every function in this file takes a
// `NotificationScope` whose `churchId` is REQUIRED, and every query is built
// through `scopedWhere`, which puts `church_id = ?` first and cannot be called
// without it. A read that forgets the tenant does not type-check.
//
// That includes fetch-by-id: `getNotificationById` is scoped too, so a
// notification belonging to another church is not "hidden from the UI", it is
// absent from the result set.
// ============================================================================

/**
 * Tenant scope for a notification read. `churchId` is required — this type is
 * what makes N-010 a compile-time property of the read paths.
 */
export interface NotificationScope {
  churchId: string;
  /** Narrow to one recipient. Every user-facing read supplies it. */
  recipientUserId?: string;
}

/**
 * Compose a WHERE clause that always begins with the tenancy predicate.
 *
 * Exported so the scoping is directly assertable: rendering any query built
 * from it shows `church_id = $n` with the scope's value bound.
 */
export function scopedWhere(
  scope: NotificationScope,
  ...extra: (SQL | undefined)[]
): SQL {
  const conditions: (SQL | undefined)[] = [
    eq(notifications.churchId, scope.churchId),
  ];

  if (scope.recipientUserId !== undefined) {
    conditions.push(eq(notifications.recipientUserId, scope.recipientUserId));
  }

  conditions.push(...extra);

  // `and()` of a non-empty list is always defined; the cast keeps callers from
  // having to handle an impossible undefined.
  return and(...conditions) as SQL;
}

// ----------------------------------------------------------------------------
// Query builders — exported so their SQL can be asserted without a database.
// ----------------------------------------------------------------------------

export function notificationByIdQuery(scope: NotificationScope, id: string) {
  return db
    .select()
    .from(notifications)
    .where(scopedWhere(scope, eq(notifications.id, id)))
    .limit(1);
}

export const DEFAULT_FEED_LIMIT = 30;

export interface FeedOptions {
  /** Hard cap; the feed is never unbounded. */
  limit?: number;
  /** Keyset pagination — rows strictly older than this `createdAt`. */
  before?: Date;
  category?: NotificationCategory;
  unreadOnly?: boolean;
}

/** Newest-first feed for one recipient within one church (N-008). */
export function notificationFeedQuery(
  scope: NotificationScope,
  options: FeedOptions = {}
) {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_FEED_LIMIT, 1), 100);

  return db
    .select()
    .from(notifications)
    .where(
      scopedWhere(
        scope,
        options.before
          ? lt(notifications.createdAt, options.before)
          : undefined,
        options.category
          ? eq(notifications.category, options.category)
          : undefined,
        options.unreadOnly ? isNull(notifications.readAt) : undefined
      )
    )
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
}

/** Unread count for the app shell. */
export function unreadCountQuery(scope: NotificationScope) {
  return db
    .select({ value: count() })
    .from(notifications)
    .where(scopedWhere(scope, isNull(notifications.readAt)));
}

// ----------------------------------------------------------------------------
// Read paths
// ----------------------------------------------------------------------------

/**
 * Fetch one notification by id, scoped to a church.
 *
 * Returns null for a row that exists but belongs to another church — the id is
 * not a capability.
 */
export async function getNotificationById(
  scope: NotificationScope,
  id: string
): Promise<Notification | null> {
  const [row] = await notificationByIdQuery(scope, id);
  return row ?? null;
}

export async function listNotifications(
  scope: NotificationScope,
  options: FeedOptions = {}
): Promise<Notification[]> {
  return notificationFeedQuery(scope, options);
}

export async function getUnreadCount(
  scope: NotificationScope
): Promise<number> {
  const [row] = await unreadCountQuery(scope);
  return row?.value ?? 0;
}
