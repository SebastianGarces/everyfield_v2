import {
  and,
  count,
  desc,
  eq,
  isNull,
  lt,
  lte,
  ne,
  or,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  notifications,
  type Notification,
  type NotificationCategory,
  type NotificationEntityType,
} from "@/db/schema";

// ============================================================================
// Notification read paths (N-008, N-010).
//
// Two boundaries are structural here rather than habitual, and both are
// enforced by the TYPES, not by remembering to pass an argument:
//
//   1. Tenancy.  `NotificationScope.churchId` is required.
//   2. Recipient. `NotificationScope.recipientUserId` is required TOO.
//
// (2) is not decoration. A notification body is arbitrary feature copy — task,
// meeting, financial and message content — so within one church a bare id must
// not be a capability any more than it is across churches. An optional
// recipient fails OPEN on precisely the case where it must fail closed (an
// absent session user), and `scopedWhere` therefore has no branch that can omit
// it: there is no code path in this file that reads one user's rows without
// naming that user.
//
// A church-wide read is a different thing with a different name and a different
// type: `listForDispatch(DispatcherScope)`. The dispatcher legitimately spans
// recipients; it has to ask for that by name, and a reviewer can grep for it.
// `cancelByEntity` (src/lib/notifications/enqueue.ts) is the only other
// church-wide reader, and it is a write that returns ids, never bodies.
//
// The user-facing reads are also PROJECTED, not `select()`: the feed row lands
// in an RSC payload, so it carries what the UI renders and none of the queue's
// internals (`dedupe_key` in particular, which is caller-composed and embeds
// entity ids by convention).
//
// Note on `exactOptionalPropertyTypes`: the repo does not set it (52 pre-existing
// errors elsewhere), and it is not load-bearing here. It only matters for keys
// that are OPTIONAL and explicitly passed as undefined. `recipientUserId` is
// required and typed `string`, so the failure it would have guarded —
// `recipientUserId: session?.user.id` on a null session — is already a type
// error, not a silently-dropped predicate.
// ============================================================================

/**
 * Scope for a user-facing notification read. BOTH fields are required — this
 * type is what makes N-010 and the intra-church recipient boundary compile-time
 * properties of the read paths rather than route-level diligence.
 */
export interface NotificationScope {
  churchId: string;
  recipientUserId: string;
}

/**
 * Scope for the one legitimate church-wide reader: the dispatcher, which claims
 * due rows across every recipient in a church.
 *
 * Deliberately a separate, separately-named type. It is not a `NotificationScope`
 * with a field left out, so it cannot be reached by forgetting something — and
 * every church-wide read is greppable as `listForDispatch`.
 */
export interface DispatcherScope {
  churchId: string;
}

/**
 * Compose a WHERE clause that always begins with BOTH boundary predicates.
 *
 * Exported so the scoping is directly assertable: rendering any query built
 * from it shows `church_id = $n and recipient_user_id = $m` with the scope's
 * values bound. There is no conditional here on purpose — a predicate that can
 * be skipped is a predicate that will be skipped.
 */
export function scopedWhere(
  scope: NotificationScope,
  ...extra: (SQL | undefined)[]
): SQL {
  return and(
    eq(notifications.churchId, scope.churchId),
    eq(notifications.recipientUserId, scope.recipientUserId),
    ...extra
  ) as SQL;
}

/** The church-only WHERE, reachable only through the dispatcher entrypoints. */
export function dispatcherWhere(
  scope: DispatcherScope,
  ...extra: (SQL | undefined)[]
): SQL {
  return and(eq(notifications.churchId, scope.churchId), ...extra) as SQL;
}

// ----------------------------------------------------------------------------
// What the in-app feed is allowed to show
// ----------------------------------------------------------------------------

/**
 * The queue row and the feed row are one record (see the schema header), so the
 * feed has to say which queue states are user-visible. Two are not:
 *
 * - `cancelled` — N-011 says a cancelled notification is never delivered. The
 *   in-app feed IS a delivery channel, so a cancelled row must leave it.
 * - not yet due — a reminder enqueued three days ahead would otherwise appear,
 *   and increment the unread badge, three days early.
 *
 * Applied to EVERY user-facing read — the feed, the unread count and the
 * single-row fetch by id — so the badge can never disagree with the list it
 * counts, and the by-id path can never hand back what the list is hiding.
 */
function feedVisibility(now: Date): (SQL | undefined)[] {
  return [
    ne(notifications.status, "cancelled"),
    lte(notifications.scheduledFor, now),
  ];
}

// ----------------------------------------------------------------------------
// Projection — what a feed row is allowed to carry off the server
// ----------------------------------------------------------------------------

const feedColumns = {
  id: notifications.id,
  category: notifications.category,
  type: notifications.type,
  title: notifications.title,
  body: notifications.body,
  entityType: notifications.entityType,
  entityId: notifications.entityId,
  readAt: notifications.readAt,
  createdAt: notifications.createdAt,
};

/**
 * A notification as the UI sees it. Deliberately narrower than `Notification`:
 * `dedupeKey`, `status`, `scheduledFor` and `updatedAt` are queue internals and
 * do not cross into a client payload.
 */
export interface FeedNotification {
  id: string;
  category: NotificationCategory;
  type: string;
  title: string;
  body: string;
  entityType: NotificationEntityType | null;
  entityId: string | null;
  readAt: Date | null;
  createdAt: Date;
}

// ----------------------------------------------------------------------------
// Query builders — exported so their SQL can be asserted without a database.
// ----------------------------------------------------------------------------

/**
 * One row, by id — and it carries the FEED's visibility rules, not a weaker set.
 *
 * A single-row read is a delivery channel too: it returns the same projection
 * (title, body, entity link) the list does. Without `feedVisibility` here, a
 * cancelled notification — one N-011 says is never delivered — and a reminder
 * scheduled three days out would both be readable by anyone who has, or
 * guesses, the id, undoing on this path exactly what the feed and the badge
 * enforce on theirs. `now` is injectable for the same reason it is on the feed:
 * so "not yet due" is assertable.
 */
export function notificationByIdQuery(
  scope: NotificationScope,
  id: string,
  now?: Date
) {
  return db
    .select(feedColumns)
    .from(notifications)
    .where(
      scopedWhere(
        scope,
        eq(notifications.id, id),
        ...feedVisibility(now ?? new Date())
      )
    )
    .limit(1);
}

export const DEFAULT_FEED_LIMIT = 30;

/**
 * Keyset cursor. It is a PAIR because `created_at` is not unique: it defaults
 * to `now()`, which in Postgres is the TRANSACTION timestamp, and
 * memory/invariants.md mandates `db.batch([...])` for writes known up front —
 * so a fan-out enqueue produces rows with byte-identical `created_at`. Paging
 * on the timestamp alone would drop every sibling that straddled a page
 * boundary.
 */
export interface FeedCursor {
  createdAt: Date;
  id: string;
}

/** The cursor to pass as `before` to fetch the page after `row`. */
export function feedCursorFrom(row: FeedNotification): FeedCursor {
  return { createdAt: row.createdAt, id: row.id };
}

export interface FeedOptions {
  /** Hard cap; the feed is never unbounded. */
  limit?: number;
  /** Keyset pagination — rows strictly older than this `(createdAt, id)`. */
  before?: FeedCursor;
  category?: NotificationCategory;
  unreadOnly?: boolean;
  /** Injectable clock, so "not yet due" is assertable. Defaults to now. */
  now?: Date;
}

/** `(created_at, id) < (cursor.createdAt, cursor.id)`, spelled out. */
function olderThan(cursor: FeedCursor): SQL {
  return or(
    lt(notifications.createdAt, cursor.createdAt),
    and(
      eq(notifications.createdAt, cursor.createdAt),
      lt(notifications.id, cursor.id)
    )
  ) as SQL;
}

/** Newest-first feed for one recipient within one church (N-008). */
export function notificationFeedQuery(
  scope: NotificationScope,
  options: FeedOptions = {}
) {
  const limit = Math.min(Math.max(options.limit ?? DEFAULT_FEED_LIMIT, 1), 100);

  return (
    db
      .select(feedColumns)
      .from(notifications)
      .where(
        scopedWhere(
          scope,
          ...feedVisibility(options.now ?? new Date()),
          options.before ? olderThan(options.before) : undefined,
          options.category
            ? eq(notifications.category, options.category)
            : undefined,
          options.unreadOnly ? isNull(notifications.readAt) : undefined
        )
      )
      // `id` is the tiebreaker, and it is in the cursor for the same reason.
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(limit)
  );
}

/**
 * Unread count for the app shell — the same visibility rules as the feed, so
 * the badge counts exactly the rows the feed lists.
 */
export function unreadCountQuery(scope: NotificationScope, now?: Date) {
  return db
    .select({ value: count() })
    .from(notifications)
    .where(
      scopedWhere(
        scope,
        isNull(notifications.readAt),
        ...feedVisibility(now ?? new Date())
      )
    );
}

/**
 * Due, unclaimed rows across every recipient in a church — the dispatcher's
 * read, and the only church-wide one in this file.
 */
export function dispatchQueueQuery(
  scope: DispatcherScope,
  options: { now?: Date; limit?: number } = {}
) {
  const now = options.now ?? new Date();

  return db
    .select()
    .from(notifications)
    .where(
      dispatcherWhere(
        scope,
        eq(notifications.status, "pending"),
        lte(notifications.scheduledFor, now)
      )
    )
    .orderBy(notifications.scheduledFor, notifications.id)
    .limit(Math.min(Math.max(options.limit ?? 100, 1), 500));
}

// ----------------------------------------------------------------------------
// Read paths
// ----------------------------------------------------------------------------

/**
 * Fetch one notification by id, scoped to a church AND a recipient.
 *
 * Returns null for a row that exists but belongs to another church, and equally
 * for one that belongs to another user in the SAME church. The id is not a
 * capability in either direction — nor is it a way around the feed's visibility
 * rules: a cancelled or not-yet-due row is null here too.
 */
export async function getNotificationById(
  scope: NotificationScope,
  id: string,
  now?: Date
): Promise<FeedNotification | null> {
  const [row] = await notificationByIdQuery(scope, id, now);
  return row ?? null;
}

export async function listNotifications(
  scope: NotificationScope,
  options: FeedOptions = {}
): Promise<FeedNotification[]> {
  return notificationFeedQuery(scope, options);
}

export async function getUnreadCount(
  scope: NotificationScope,
  now?: Date
): Promise<number> {
  const [row] = await unreadCountQuery(scope, now);
  return row?.value ?? 0;
}

/**
 * The dispatcher's church-wide read. Named so it cannot be reached by accident
 * and can be grepped for in review; returns FULL queue rows because the
 * dispatcher needs the internals the feed projection withholds.
 */
export async function listForDispatch(
  scope: DispatcherScope,
  options: { now?: Date; limit?: number } = {}
): Promise<Notification[]> {
  return dispatchQueueQuery(scope, options);
}
