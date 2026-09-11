import {
  and,
  count,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql,
  type SQL,
} from "drizzle-orm";
import { db } from "@/db";
import {
  churchPrivacySettings,
  churches,
  notifications,
  type Notification,
  type NotificationCategory,
  type NotificationEntityType,
} from "@/db/schema";
import type { OversightOrg } from "@/lib/auth/tenancy";

import { OVERSIGHT_SHARING_EXEMPT_TYPES } from "./categories";
import { OVERSIGHT_ADMIN } from "./oversight-admin";

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
 * NOT exported: `feedScopedWhere` is the only door, and this is one of the two
 * things behind it. There is no conditional here on purpose — a predicate that
 * can be skipped is a predicate that will be skipped. The scoping stays
 * directly assertable through the composer: rendering any query built from a
 * plant scope shows `church_id = $n and recipient_user_id = $m` with the
 * scope's values bound.
 */
function scopedWhere(
  scope: NotificationScope,
  ...extra: (SQL | undefined)[]
): SQL {
  return and(
    eq(notifications.churchId, scope.churchId),
    eq(notifications.recipientUserId, scope.recipientUserId),
    ...extra
  ) as SQL;
}

/**
 * Scope for an OVERSIGHT viewer's feed (N-027) — one account, reading across
 * every plant its org reaches plus the org's own rows.
 *
 * It carries the ORG, not a list of church ids, and that is the safety
 * property. Which plants are in reach and which of them have consented is a
 * question about the database at the instant of the read, so it is answered in
 * the WHERE clause (`optedInPlantIds` below) rather than resolved into an array
 * somewhere upstream and passed in. An array of ids is something a caller can
 * compose, widen or forget to refresh; a subquery is not.
 *
 * `org` is minted by `oversightOrgOf` (`@/lib/auth/tenancy`) from the session's
 * tenancy — the same function every other oversight surface resolves reach
 * with, and one that answers only for a row naming EXACTLY ONE tenancy. The
 * recipient is required for the same reason it is on `NotificationScope`: an
 * optional recipient fails OPEN precisely where it must fail closed.
 */
export interface OversightNotificationScope {
  org: OversightOrg;
  recipientUserId: string;
}

/**
 * The tenancy boundary ONE user-facing read runs under: a seat in a plant, or
 * an oversight org's portfolio.
 *
 * A union rather than a widened `NotificationScope`, so neither arm can be
 * reached by leaving a field off the other. `NotificationScope` still requires
 * both of its fields; `OversightNotificationScope` requires both of its; and
 * `feedScopedWhere` is total over the two, so there is no third shape and no
 * default.
 */
export type FeedScope = NotificationScope | OversightNotificationScope;

/** Which arm of {@link FeedScope} this is. Presence of `org` is the tag. */
export function isOversightScope(
  scope: FeedScope
): scope is OversightNotificationScope {
  return "org" in scope;
}

/**
 * The plants an oversight org may be shown notifications about: in its
 * portfolio AND opted in.
 *
 * BOTH HALVES, AS A SUBQUERY, AT READ TIME. `enqueue` already refuses to WRITE
 * a consent-governed row for a plant that has not turned
 * `share_activity_with_oversight` on, so this is not the only gate — it is the
 * one that survives the plant changing its mind. A toggle flipped off on
 * Tuesday is a statement about the digests already sitting in the org's feed,
 * not only about the ones not yet enqueued, and read-time filtering is the same
 * answer this layer already gives for the in-app category preference (see the
 * header of ./feed.ts). Nothing has to sweep the queue for a consent change to
 * take effect.
 *
 * The portfolio half is `churches.<org fk> = org.id`, indexed off
 * `OVERSIGHT_ADMIN` so a third kind of oversight org widens it with the row
 * rather than by somebody remembering a column name. It is the SQL twin of
 * `getAccessibleChurchIds`'s oversight arm; a plant that has left the org has
 * a null FK and drops out of the feed with the association.
 */
function optedInPlantIds(org: OversightOrg) {
  return db
    .select({ id: churches.id })
    .from(churches)
    .innerJoin(
      churchPrivacySettings,
      eq(churchPrivacySettings.churchId, churches.id)
    )
    .where(
      and(
        eq(churches[OVERSIGHT_ADMIN[org.type].fk], org.id),
        eq(churchPrivacySettings.shareActivityWithOversight, true)
      )
    );
}

/**
 * The oversight WHERE: one recipient, three anchors they may be shown.
 *
 * The recipient predicate is UNCONDITIONAL and sits outside the disjunction, so
 * every arm is bounded by it — an oversight admin reads their own rows and
 * nobody else's, exactly as a plant's team does.
 *
 * The three arms, and why each is a separate one:
 *
 *   1. CONSENT-GOVERNED PLANT ROWS — the daily digest and the two gated
 *      milestones. Visible only while the plant is in the org's portfolio AND
 *      sharing is on (`optedInPlantIds`). This is the arm the privacy promise
 *      rests on: with the toggle off there is no row for that plant in the
 *      list, in the count, in the cold-start probe or by direct id.
 *
 *   2. THE ORG'S OWN RELATIONSHIP EVENTS — `OVERSIGHT_SHARING_EXEMPT_TYPES`,
 *      the three milestones ruled consent-exempt on 2026-08-01 and extended by
 *      #304 (an invitation accepted, an invitation declined, an association
 *      ended). They are plant-ANCHORED but they are not facts about the plant,
 *      and `enqueue` writes them whatever the toggle says. Filtering them out
 *      here would re-apply, on the read, the consent gate the ruling removed
 *      from the write — and it would land hardest on the one milestone the
 *      ruling was made for: at the moment an invitation is accepted the toggle
 *      is off in essentially every real case, so "they accepted your
 *      invitation" would be written and never shown. The arm reads the SAME
 *      constant `enqueue`'s gate does, so the write and the read cannot drift.
 *
 *   3. ORG-ANCHORED ROWS — a sending church's own membership of a network
 *      (#304 WS3), filed under `anchor_org_id` because they name no plant.
 *      This arm is what retires the "org-anchored notifications are write-only
 *      in-app" residual in memory/invariants.md, and it is the ONLY read of
 *      that column. #304 WS3 shipped a parallel `org*` family — its own scope
 *      type, composer, feed query, count query and two entrypoints — which
 *      reached the same rows through a bare `string` org id, applied no consent
 *      subquery and no recipient tenancy check, and had zero callers: a second
 *      door that type-checked. Deleted in #528; this arm subsumes it.
 *
 * THE ARMS OVERLAP, AND NOTHING MAY BE DERIVED FROM A ROW MATCHING ONE. They
 * used to partition — the CHECK separates `church_id` from `anchor_org_id`, and
 * arms 1 and 2 differed on `type` — and #619's `sharing_changed` row matches
 * arm 2 (its type is consent-exempt) AND arm 3 (it is org-anchored). Harmless,
 * because this is an `or`; recorded because the old sentence read like a
 * property somebody could rely on.
 */
export function oversightScopedWhere(
  scope: OversightNotificationScope,
  ...extra: (SQL | undefined)[]
): SQL {
  return and(
    eq(notifications.recipientUserId, scope.recipientUserId),
    or(
      inArray(notifications.churchId, optedInPlantIds(scope.org)),
      inArray(notifications.type, [...OVERSIGHT_SHARING_EXEMPT_TYPES]),
      eq(notifications.anchorOrgId, scope.org.id)
    ),
    ...extra
  ) as SQL;
}

/**
 * The ONE boundary composer every user-facing read and both mark-read writes go
 * through — total over {@link FeedScope}.
 *
 * Exported and total on purpose: a builder that took the union and switched
 * inside itself would be a second copy of this decision, and a builder that
 * took only `NotificationScope` would silently exclude oversight from whichever
 * path forgot to widen. There is one switch, here.
 */
export function feedScopedWhere(
  scope: FeedScope,
  ...extra: (SQL | undefined)[]
): SQL {
  return isOversightScope(scope)
    ? oversightScopedWhere(scope, ...extra)
    : scopedWhere(scope, ...extra);
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
 * feed has to say which queue states are user-visible. Three things are not:
 *
 * - `cancelled` — N-011 says a cancelled notification is never delivered. The
 *   in-app feed IS a delivery channel, so a cancelled row must leave it.
 * - not yet due — a reminder enqueued three days ahead would otherwise appear,
 *   and increment the unread badge, three days early.
 * - a category the recipient has switched OFF for the `in_app` channel (N-005,
 *   ruled 2026-07-27). `categories` is the resolved allow-list from
 *   `resolveInAppCategories` (./preferences); omitting it means "no preference
 *   filter", which is what the dispatcher-adjacent and by-id callers want.
 *
 * Applied to EVERY user-facing read — the feed, the unread count and the
 * cold-start probe — so the badge can never disagree with the list it counts,
 * and "nothing yet" can never be claimed while rows are on screen.
 *
 * Exported because the MARK-READ writes (`./mark-read`) need the identical
 * predicate, not a second copy of it: "mark all read" that ignored these rules
 * would stamp `read_at` on a reminder scheduled for next week, so it would
 * arrive already-read and never be seen — and it would burn the unread state of
 * a category the user has hidden, which they would get back already-read the
 * day they turn it on again. A user can only mark read what the feed was
 * allowed to show them.
 */
export function feedVisibility(
  now: Date,
  categories?: readonly NotificationCategory[]
): (SQL | undefined)[] {
  return [
    ne(notifications.status, "cancelled"),
    lte(notifications.scheduledFor, now),
    categoryAllowList(categories),
  ];
}

/**
 * `category IN (...)`, or a predicate that matches nothing.
 *
 * The empty allow-list is the case worth spelling out: a user who has turned
 * every category off has asked to see nothing, and `inArray(col, [])` is not a
 * safe way to say so — it is the shape where an ORM is most likely to fold the
 * clause away and return everything. `false` fails closed, and it is asserted.
 */
function categoryAllowList(
  categories?: readonly NotificationCategory[]
): SQL | undefined {
  if (categories === undefined) return undefined;
  if (categories.length === 0) return sql`false`;
  return inArray(notifications.category, [...categories]);
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
 * What every user-facing read needs to know beyond WHO is asking.
 *
 * `now` is injectable so "not yet due" is assertable without waiting; the
 * allow-list is threaded rather than resolved in here so the preference query
 * happens ONCE per request (see `./feed`) instead of once per read path.
 */
export interface VisibilityOptions {
  /** Injectable clock. Defaults to now. */
  now?: Date;
  /**
   * Categories the recipient still wants in-app (N-005). Omitted means no
   * preference filter; `[]` means nothing is visible.
   */
  categories?: readonly NotificationCategory[];
}

/**
 * One row, by id — and it carries the FEED's visibility rules, not a weaker set.
 *
 * A single-row read is a delivery channel too: it returns the same projection
 * (title, body, entity link) the list does. Without `feedVisibility` here, a
 * cancelled notification — one N-011 says is never delivered — and a reminder
 * scheduled three days out would both be readable by anyone who has, or
 * guesses, the id, undoing on this path exactly what the feed and the badge
 * enforce on theirs.
 */
export function notificationByIdQuery(
  scope: FeedScope,
  id: string,
  options: VisibilityOptions = {}
) {
  return db
    .select(feedColumns)
    .from(notifications)
    .where(
      feedScopedWhere(
        scope,
        eq(notifications.id, id),
        ...feedVisibility(options.now ?? new Date(), options.categories)
      )
    )
    .limit(1);
}

export const DEFAULT_FEED_LIMIT = 30;

/** Hard ceiling on one page, whatever a caller asks for. */
export const MAX_FEED_LIMIT = 100;

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

export interface FeedOptions extends VisibilityOptions {
  /** Hard cap; the feed is never unbounded. */
  limit?: number;
  /** Keyset pagination — rows strictly older than this `(createdAt, id)`. */
  before?: FeedCursor;
  category?: NotificationCategory;
  unreadOnly?: boolean;
}

/**
 * JavaScript Dates retain milliseconds while PostgreSQL timestamps retain
 * microseconds. Canonicalize the database side to the cursor's precision so
 * two rows inside one millisecond are ordered and paged by the id tiebreaker
 * instead of disappearing behind a truncated timestamp cursor.
 */
function canonicalFeedCreatedAt(): SQL<Date> {
  return sql<Date>`date_trunc('milliseconds', ${notifications.createdAt})`.mapWith(
    notifications.createdAt
  );
}

/** `(canonical created_at, id) < (cursor.createdAt, cursor.id)`, spelled out. */
function olderThan(cursor: FeedCursor): SQL {
  const createdAt = canonicalFeedCreatedAt();
  const boundary = sql<Date>`${cursor.createdAt.toISOString()}::timestamptz`;
  return or(
    lt(createdAt, boundary),
    and(eq(createdAt, boundary), lt(notifications.id, cursor.id))
  ) as SQL;
}

/**
 * A tenancy scope, as the ONE thing a read needs from it: "give me a WHERE that
 * opens with your boundary predicates, then these".
 *
 * The plant composer is `scopedWhere` and the oversight one is
 * `oversightScopedWhere`, `feedScopedWhere` picks between them, and this type is
 * the only thing the builders below know about any of it. That is deliberate: a
 * feed and its badge that were written out twice, once per boundary, are two
 * implementations of one rule, and the copy is always the one that misses the
 * fix (memory/invariants.md says this about `daysUntilTarget`,
 * `peopleTextSearch` and `lookupInvitingOrgName` alike). Ordering, projection,
 * the limit clamp, the keyset predicate and every visibility rule are now
 * written once; only the boundary varies, which is the only thing that differs.
 */
type ScopedWhere = (...extra: (SQL | undefined)[]) => SQL;

/** One page's row count, clamped so a caller can neither ask for 0 nor for 10,000. */
function clampFeedLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_FEED_LIMIT, 1), MAX_FEED_LIMIT);
}

/** Newest-first feed under whichever tenancy boundary `where` names. */
function feedQueryWithin(where: ScopedWhere, options: FeedOptions) {
  return (
    db
      .select(feedColumns)
      .from(notifications)
      .where(
        where(
          ...feedVisibility(options.now ?? new Date(), options.categories),
          options.before ? olderThan(options.before) : undefined,
          options.category
            ? eq(notifications.category, options.category)
            : undefined,
          options.unreadOnly ? isNull(notifications.readAt) : undefined
        )
      )
      // `id` is the tiebreaker, and it is in the cursor for the same reason.
      .orderBy(desc(canonicalFeedCreatedAt()), desc(notifications.id))
      .limit(clampFeedLimit(options.limit))
  );
}

/** The unread count under whichever tenancy boundary `where` names. */
function unreadCountWithin(where: ScopedWhere, options: VisibilityOptions) {
  return db
    .select({ value: count() })
    .from(notifications)
    .where(
      where(
        isNull(notifications.readAt),
        ...feedVisibility(options.now ?? new Date(), options.categories)
      )
    );
}

/** Newest-first feed for one recipient within one church (N-008). */
export function notificationFeedQuery(
  scope: FeedScope,
  options: FeedOptions = {}
) {
  return feedQueryWithin(
    (...extra) => feedScopedWhere(scope, ...extra),
    options
  );
}

/**
 * Unread count for the app shell — the same visibility rules as the feed, so
 * the badge counts exactly the rows the feed lists.
 */
export function unreadCountQuery(
  scope: FeedScope,
  options: VisibilityOptions = {}
) {
  return unreadCountWithin(
    (...extra) => feedScopedWhere(scope, ...extra),
    options
  );
}

/**
 * Does this recipient have ANY visible notification at all (N-008, Screen 1)?
 *
 * This is the cold-start question, and it is genuinely different from "is the
 * feed page empty right now". A church whose first week has produced nothing
 * has to read as intentional ("nothing yet"), while a user whose UNREAD filter
 * has run dry has to read as finished ("all caught up") — the same empty box
 * cannot say both, and an empty box that says neither reads as broken.
 *
 * It carries the SAME visibility rules as the feed on purpose, preference
 * allow-list included: `hasAny` false must imply the feed is empty, or the UI
 * could claim a cold start while listing rows (or, worse, greet a church that
 * has never been notified of anything as though it had read everything).
 * `limit(1)` because the answer is a boolean — the count is the badge's job,
 * not this one's.
 */
export function hasAnyNotificationsQuery(
  scope: FeedScope,
  options: VisibilityOptions = {}
) {
  return db
    .select({ id: notifications.id })
    .from(notifications)
    .where(
      feedScopedWhere(
        scope,
        ...feedVisibility(options.now ?? new Date(), options.categories)
      )
    )
    .limit(1);
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
  scope: FeedScope,
  id: string,
  options: VisibilityOptions = {}
): Promise<FeedNotification | null> {
  const [row] = await notificationByIdQuery(scope, id, options);
  return row ?? null;
}

export async function listNotifications(
  scope: FeedScope,
  options: FeedOptions = {}
): Promise<FeedNotification[]> {
  return notificationFeedQuery(scope, options);
}

/**
 * One page of the feed, plus the cursor that fetches the next one.
 *
 * `nextCursor` is null exactly when there is nothing older left, and that has
 * to be knowable BEFORE the user clicks: a "Load more" that returns nothing is
 * indistinguishable, to the person clicking it, from one that is broken. So the
 * page is read with one extra row — the peek — which is dropped from the result
 * and never leaves the server.
 */
export interface FeedPage {
  rows: FeedNotification[];
  nextCursor: FeedCursor | null;
}

/**
 * Split a peeked read (`limit + 1` rows) into the page and its cursor.
 *
 * Pure and exported so the paging arithmetic — off-by-one at the boundary, the
 * cursor taken from the LAST row of the page and not from the peek — is
 * testable without a database.
 */
export function feedPageFrom(
  rows: FeedNotification[],
  limit: number
): FeedPage {
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];

  return {
    rows: page,
    nextCursor: hasMore && last ? feedCursorFrom(last) : null,
  };
}

/**
 * Rows per page, clamped BELOW the hard ceiling so the peek row still fits
 * under it.
 *
 * Without the `- 1`, a caller asking for the maximum page would have its peek
 * clamped away by `notificationFeedQuery`, and the feed would report "that is
 * everything" with rows still unread behind it.
 */
export function feedPageLimit(limit?: number): number {
  return Math.min(Math.max(limit ?? DEFAULT_FEED_LIMIT, 1), MAX_FEED_LIMIT - 1);
}

/**
 * The feed's paging entrypoint: one page, newest-first, with the keyset cursor
 * for the page after it (N-008).
 */
export async function listNotificationPage(
  scope: FeedScope,
  options: FeedOptions = {}
): Promise<FeedPage> {
  const limit = feedPageLimit(options.limit);
  const rows = await listNotifications(scope, { ...options, limit: limit + 1 });

  return feedPageFrom(rows, limit);
}

export async function getUnreadCount(
  scope: FeedScope,
  options: VisibilityOptions = {}
): Promise<number> {
  const [row] = await unreadCountQuery(scope, options);
  return row?.value ?? 0;
}

/**
 * True when this recipient has at least one visible notification — the flag the
 * feed's empty state needs to tell "nothing yet" from "all caught up".
 */
export async function hasAnyNotifications(
  scope: FeedScope,
  options: VisibilityOptions = {}
): Promise<boolean> {
  const rows = await hasAnyNotificationsQuery(scope, options);
  return rows.length > 0;
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
