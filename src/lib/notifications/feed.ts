import {
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
  type NotificationScope,
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
// ============================================================================

/**
 * A viewer of the in-app feed: WHO is asking (tenancy + recipient) and WHOSE
 * preferences govern what they see.
 *
 * Both halves are minted from a verified session and neither can be assembled
 * from request input — `NotificationScope` is required-field by construction,
 * and `PreferenceOwner` is branded so only `preferenceOwnerFromSession` can
 * produce one.
 */
export interface NotificationViewer {
  scope: NotificationScope;
  owner: PreferenceOwner;
}

/** The session shape a viewer needs. Structural, so any verified session fits. */
export interface ViewerSession {
  user: { id: string; churchId: string | null };
}

/**
 * Mint a viewer, or null when this user has no in-app feed at all.
 *
 * Null means one specific thing: no church. Every notification row is
 * church-scoped, so a user without one has nothing to read rather than an empty
 * list — the callers turn that into a redirect and a hidden bell. (Whether
 * oversight users, who have no `churchId` by construction, should reach the
 * in-app channel at all is the open spec question on #133; this function is
 * where that answer will land when it is ruled.)
 */
export function notificationViewer(
  session: ViewerSession
): NotificationViewer | null {
  if (!session.user.churchId) return null;

  return {
    scope: {
      churchId: session.user.churchId,
      recipientUserId: session.user.id,
    },
    owner: preferenceOwnerFromSession(session),
  };
}

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
  options: FeedScreenOptions = {}
): Promise<NotificationFeedScreen> {
  const now = options.now ?? new Date();
  const categories = await getInAppCategories(viewer.owner);

  const [page, unreadCount, hasAny] = await Promise.all([
    listNotificationPage(viewer.scope, {
      unreadOnly: options.unreadOnly ?? false,
      limit: options.limit,
      categories,
      now,
    }),
    getUnreadCount(viewer.scope, { categories, now }),
    hasAnyNotifications(viewer.scope, { categories, now }),
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
  options: { before: FeedCursor; unreadOnly?: boolean; limit?: number }
): Promise<FeedPage> {
  const categories = await getInAppCategories(viewer.owner);

  return listNotificationPage(viewer.scope, {
    before: options.before,
    unreadOnly: options.unreadOnly ?? false,
    limit: options.limit,
    categories,
    now: new Date(),
  });
}

/** The app shell's unread badge — the same rows the feed would list. */
export async function loadUnreadBadgeCount(
  viewer: NotificationViewer
): Promise<number> {
  const categories = await getInAppCategories(viewer.owner);
  return getUnreadCount(viewer.scope, { categories });
}

/** Mark one read — bounded to what this viewer could have been shown. */
export async function markVisibleNotificationRead(
  viewer: NotificationViewer,
  id: string
): Promise<MarkReadResult> {
  const categories = await getInAppCategories(viewer.owner);
  return markNotificationRead(viewer.scope, id, { categories });
}

/** Mark all read — same bound, so a hidden category keeps its unread state. */
export async function markAllVisibleNotificationsRead(
  viewer: NotificationViewer
): Promise<MarkReadResult> {
  const categories = await getInAppCategories(viewer.owner);
  return markAllNotificationsRead(viewer.scope, { categories });
}
