import {
  isChurchLevelUser,
  oversightOrgOf,
  type TenancyFields,
} from "@/lib/auth/tenancy";

import type { NotificationAudience, NotificationCategory } from "./categories";
import {
  audienceForTenancy,
  getInAppCategories,
  preferenceOwnerFromSession,
  type PreferenceOwner,
} from "./preferences";
import {
  getUnreadCount,
  hasAnyNotifications,
  listNotificationPage,
  type FeedCursor,
  type FeedPage,
  type FeedScope,
} from "./queries";
import {
  markAllNotificationsRead,
  markNotificationRead,
  type MarkReadResult,
} from "./mark-read";

// ============================================================================
// What the in-app channel is allowed to show one viewer (N-008, N-009, N-005).
//
// This module exists to hold ONE rule in ONE place: every user-facing
// notification read and every mark-read write is filtered by the categories the
// viewer still wants in-app, resolved from their preferences at READ time.
//
// Why read time and not just dispatch time. Dispatch already skips a channel
// the recipient has switched off, so nothing new is written for a hidden
// category. But a preference is a live choice: a user who turns `meetings` off
// on Tuesday is talking about the eleven meeting rows already sitting in their
// feed, not only about the ones that have yet to be enqueued. Filtering at
// dispatch alone leaves those eleven on screen and in the badge forever, which
// reads as the setting having done nothing.
//
// Why a module and not an argument. `queries.ts` and `mark-read.ts` take the
// allow-list as an OPTION, because the dispatcher and the by-id path have no
// business consulting a UI preference. An option is something a caller can
// forget, and a feed that forgot it would disagree with the badge that did not.
// So the app never calls those modules directly: the page, the layout and the
// mark-read actions all come through here, one preference query per request,
// and the filter is applied to the page, the count, the cold-start probe and
// both writes from a single resolution.
//
// What it does NOT touch: `notification_deliveries`. A preference governs what
// a user is shown; the delivery log is the historical record of what was
// attempted on a channel, and hiding a row from a feed does not retro-edit the
// fact that an email went out. Nothing in this module imports it.
//
// ----------------------------------------------------------------------------
// The allow-list is resolved with the viewer's AUDIENCE (N-027, #259)
// ----------------------------------------------------------------------------
//
// "Absence means the coded default" is only a complete rule once you say WHOSE
// coded default, because there are two answers: `digest`/`in_app` is off for a
// plant's own team (an in-app digest duplicates the feed it summarises) and ON
// for an oversight recipient (who has no such feed —
// `OVERSIGHT_CHANNEL_DEFAULT_OVERRIDES` in ./categories.ts, ruled on #259
// 2026-08-02).
//
// Dispatch, the `/settings` render and the `/settings` write all already
// resolved with the audience. This module did not, and the mismatch was the
// exact bug the override was added to fix, moved one layer down: the dispatcher
// wrote an oversight admin's in-app digest row and every read path here filtered
// it straight back out. So the audience travels ON THE VIEWER — resolved once,
// from the session's tenancy, by `notificationViewer` — and every read and both
// mark-read writes take it from there rather than defaulting.
// ============================================================================

/**
 * A viewer of the in-app feed: WHO is asking (tenancy + recipient), WHOSE
 * preferences govern what they see, and WHICH coded defaults apply when they
 * have expressed no preference.
 *
 * All three are minted from a verified session and none can be assembled from
 * request input — both arms of `FeedScope` are required-field by construction,
 * `PreferenceOwner` is branded so only `preferenceOwnerFromSession` can produce
 * one, and the audience is derived from the session's tenancy.
 */
export interface NotificationViewer {
  scope: FeedScope;
  owner: PreferenceOwner;
  /**
   * Whose coded defaults an ABSENT preference row resolves to. NOT a
   * permission: what this viewer is eligible for was decided by `enqueue` at
   * dispatch, long before anything reached the feed.
   */
  audience: NotificationAudience;
}

/** The session shape a viewer needs. Structural, so any verified session fits. */
export interface ViewerSession {
  user: { id: string } & TenancyFields;
}

/**
 * Mint a viewer, or null when this user has no in-app feed at all.
 *
 * THE TENANCY DECIDES WHICH BOUNDARY, and it is asked in that order (N-027).
 * An oversight account reads its org's portfolio: `oversightOrgOf` answers only
 * for a row naming EXACTLY ONE tenancy, and `oversightScopedWhere` turns that
 * org into "the plants that have opted in, plus this org's own rows" inside the
 * WHERE clause. A seat in a plant reads that plant. Asking the org first is
 * what keeps the two-tenancy data defect out of both arms: it resolves to no
 * org, and it falls through to a `churchId` test that a defective row also
 * fails, because `getAccessibleChurchIds` refuses it on the same rule.
 *
 * Null now means one of two narrow things: an account with no tenancy at all —
 * one mid-registration whose plant does not exist yet — or a row naming TWO
 * tenancies. The second is why the plant arm asks `isChurchLevelUser` rather
 * than testing `churchId`: such a row is a data defect that reaches nothing in
 * either direction (memory/invariants.md → Seats & Tenancy), and a bare
 * `churchId` test would have handed it the plant's feed after the org arm had
 * just refused it. There is nothing to read for either rather than an empty
 * list — the callers turn that into a redirect and a hidden bell.
 *
 * The AUDIENCE is still resolved from the tenancy, independently of the
 * boundary, so an oversight viewer reads with the oversight coded defaults
 * (`OVERSIGHT_CHANNEL_DEFAULT_OVERRIDES`) — which is what makes their in-app
 * digest row visible instead of being filtered straight back out.
 */
export function notificationViewer(
  session: ViewerSession
): NotificationViewer | null {
  const org = oversightOrgOf(session.user);

  const scope: FeedScope | null = org
    ? { org, recipientUserId: session.user.id }
    : isChurchLevelUser(session.user) && session.user.churchId
      ? { churchId: session.user.churchId, recipientUserId: session.user.id }
      : null;

  if (!scope) return null;

  return {
    scope,
    owner: preferenceOwnerFromSession(session),
    audience: audienceForTenancy(session.user),
  };
}

/**
 * Everything this module needs from the layers below it.
 *
 * Injectable for one reason, and it is the reason this interface exists at all:
 * the audience has to be proved to reach EVERY path, not just to be present in
 * the file. The five functions below each resolve an allow-list and hand it
 * down, and a test that captures what was handed down is the only way to show
 * the badge and the feed and both mark-read writes agree — which is precisely
 * the property that was broken here.
 *
 * `inAppCategories` takes the whole viewer rather than (owner, audience) so a
 * call site cannot pass one without the other.
 */
export interface NotificationFeedDeps {
  inAppCategories(viewer: NotificationViewer): Promise<NotificationCategory[]>;
  listPage: typeof listNotificationPage;
  unreadCount: typeof getUnreadCount;
  hasAny: typeof hasAnyNotifications;
  markOne: typeof markNotificationRead;
  markAll: typeof markAllNotificationsRead;
}

export const dbNotificationFeedDeps: NotificationFeedDeps = {
  inAppCategories: (viewer) =>
    getInAppCategories(viewer.owner, viewer.audience),
  listPage: listNotificationPage,
  unreadCount: getUnreadCount,
  hasAny: hasAnyNotifications,
  markOne: markNotificationRead,
  markAll: markAllNotificationsRead,
};

/** Everything the feed screen renders, resolved against one instant. */
export interface NotificationFeedScreen extends FeedPage {
  /** Unread across ALL visible rows, not just this page — this is the badge. */
  unreadCount: number;
  /** Has this viewer ever had a visible notification? Cold start vs. caught up. */
  hasAny: boolean;
}

export interface FeedScreenOptions {
  unreadOnly?: boolean;
  limit?: number;
  /** One instant for the page, the count and the probe alike. */
  now?: Date;
}

/**
 * The feed screen's single read.
 *
 * The three queries run against ONE resolved allow-list and ONE instant, which
 * is what keeps them from contradicting each other: the badge cannot count a
 * category the list is hiding, and the cold-start probe cannot say "nothing
 * yet" while the list has rows.
 */
export async function loadNotificationFeedScreen(
  viewer: NotificationViewer,
  options: FeedScreenOptions = {},
  deps: NotificationFeedDeps = dbNotificationFeedDeps
): Promise<NotificationFeedScreen> {
  const now = options.now ?? new Date();
  const categories = await deps.inAppCategories(viewer);

  const [page, unreadCount, hasAny] = await Promise.all([
    deps.listPage(viewer.scope, {
      unreadOnly: options.unreadOnly ?? false,
      limit: options.limit,
      categories,
      now,
    }),
    deps.unreadCount(viewer.scope, { categories, now }),
    deps.hasAny(viewer.scope, { categories, now }),
  ]);

  return { ...page, unreadCount, hasAny };
}

/**
 * The next page, older than `before` (N-008 paging).
 *
 * `unreadOnly` has to match the tab the cursor came from, or the second page
 * would be drawn from a different list than the first.
 */
export async function loadOlderNotifications(
  viewer: NotificationViewer,
  options: { before: FeedCursor; unreadOnly?: boolean; limit?: number },
  deps: NotificationFeedDeps = dbNotificationFeedDeps
): Promise<FeedPage> {
  const categories = await deps.inAppCategories(viewer);

  return deps.listPage(viewer.scope, {
    before: options.before,
    unreadOnly: options.unreadOnly ?? false,
    limit: options.limit,
    categories,
    now: new Date(),
  });
}

/** The app shell's unread badge — the same rows the feed would list. */
export async function loadUnreadBadgeCount(
  viewer: NotificationViewer,
  deps: NotificationFeedDeps = dbNotificationFeedDeps
): Promise<number> {
  const categories = await deps.inAppCategories(viewer);
  return deps.unreadCount(viewer.scope, { categories });
}

/** Mark one read — bounded to what this viewer could have been shown. */
export async function markVisibleNotificationRead(
  viewer: NotificationViewer,
  id: string,
  deps: NotificationFeedDeps = dbNotificationFeedDeps
): Promise<MarkReadResult> {
  const categories = await deps.inAppCategories(viewer);
  return deps.markOne(viewer.scope, id, { categories });
}

/** Mark all read — same bound, so a hidden category keeps its unread state. */
export async function markAllVisibleNotificationsRead(
  viewer: NotificationViewer,
  deps: NotificationFeedDeps = dbNotificationFeedDeps
): Promise<MarkReadResult> {
  const categories = await deps.inAppCategories(viewer);
  return deps.markAll(viewer.scope, { categories });
}
