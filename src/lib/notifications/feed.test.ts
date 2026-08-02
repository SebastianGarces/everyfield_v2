import assert from "node:assert/strict";
import { test } from "node:test";

import type { NotificationCategory } from "./categories";
import {
  dbNotificationFeedDeps,
  loadNotificationFeedScreen,
  loadOlderNotifications,
  loadUnreadBadgeCount,
  markAllVisibleNotificationsRead,
  markVisibleNotificationRead,
  notificationViewer,
  type NotificationFeedDeps,
  type NotificationViewer,
  type ViewerSession,
} from "./feed";
import { resolveInAppCategories } from "./preferences";

// ----------------------------------------------------------------------------
// The read path resolves with the viewer's AUDIENCE (N-027, ruled on #259).
//
// The bug these tests pin: `OVERSIGHT_CHANNEL_DEFAULT_OVERRIDES` turns
// `digest`/`in_app` ON for an oversight recipient, dispatch honoured it, and
// then every read path in this module resolved with CHURCH defaults and
// filtered the row it had just written straight back out. The digest arrived by
// email and was invisible in the app — exactly the outcome N-027 forbids.
//
// So the assertions are about the ALLOW-LIST each path hands down, captured at
// the seam. Five paths, one resolution: if any of them stops carrying the
// audience, the corresponding assertion below fails rather than the whole thing
// quietly agreeing on church defaults again.
//
// DATABASE_URL is present in this environment because importing this module
// pulls in `@/db` through the query layer; nothing here touches Postgres —
// every dependency is injected.
// ----------------------------------------------------------------------------

const PLANT = "11111111-1111-4111-8111-111111111111";
const PLANTER = "22222222-2222-4222-8222-222222222222";
const OVERSIGHT_ADMIN = "33333333-3333-4333-8333-333333333333";

function session(
  id: string,
  role: ViewerSession["user"]["role"],
  churchId: string | null = PLANT
): ViewerSession {
  return { user: { id, churchId, role } };
}

function viewerFor(
  id: string,
  role: ViewerSession["user"]["role"]
): NotificationViewer {
  const viewer = notificationViewer(session(id, role));
  assert.ok(viewer, "the fixture produced no viewer");
  return viewer;
}

/**
 * Captures the allow-list every path hands down.
 *
 * `inAppCategories` is the REAL resolver over an empty preference set — "a
 * recipient who has never opened the settings screen" is the whole case under
 * test, and faking the resolution would test nothing. Everything below it is a
 * recorder.
 */
class RecordingFeedDeps implements NotificationFeedDeps {
  readonly handedDown: Record<string, NotificationCategory[]> = {};

  async inAppCategories(viewer: NotificationViewer) {
    // No explicit rows: absence resolves to the coded default for the viewer's
    // audience, which is the property this whole file is about.
    return resolveInAppCategories([], viewer.audience);
  }

  listPage: NotificationFeedDeps["listPage"] = async (_scope, options) => {
    this.handedDown.listPage = [...(options?.categories ?? [])];
    return { rows: [], nextCursor: null };
  };

  unreadCount: NotificationFeedDeps["unreadCount"] = async (
    _scope,
    options
  ) => {
    this.handedDown.unreadCount = [...(options?.categories ?? [])];
    return 0;
  };

  hasAny: NotificationFeedDeps["hasAny"] = async (_scope, options) => {
    this.handedDown.hasAny = [...(options?.categories ?? [])];
    return false;
  };

  markOne: NotificationFeedDeps["markOne"] = async (_scope, _id, options) => {
    this.handedDown.markOne = [...(options?.categories ?? [])];
    return { markedIds: [], markedCount: 0 };
  };

  markAll: NotificationFeedDeps["markAll"] = async (_scope, options) => {
    this.handedDown.markAll = [...(options?.categories ?? [])];
    return { markedIds: [], markedCount: 0 };
  };
}

/** Run every one of the five paths once and return what each handed down. */
async function allowListsFor(viewer: NotificationViewer) {
  const deps = new RecordingFeedDeps();

  await loadNotificationFeedScreen(viewer, {}, deps);
  const feed = deps.handedDown.listPage;
  const badgeInsideFeed = deps.handedDown.unreadCount;
  const coldStart = deps.handedDown.hasAny;

  await loadOlderNotifications(
    viewer,
    { before: { createdAt: new Date("2026-08-01T00:00:00.000Z"), id: "x" } },
    deps
  );
  const older = deps.handedDown.listPage;

  await loadUnreadBadgeCount(viewer, deps);
  const badge = deps.handedDown.unreadCount;

  await markVisibleNotificationRead(viewer, "row-1", deps);
  const markOne = deps.handedDown.markOne;

  await markAllVisibleNotificationsRead(viewer, deps);
  const markAll = deps.handedDown.markAll;

  return { feed, badgeInsideFeed, coldStart, older, badge, markOne, markAll };
}

// ----------------------------------------------------------------------------
// The audience travels on the viewer
// ----------------------------------------------------------------------------

test("the viewer's audience is derived from the session role", () => {
  assert.equal(viewerFor(PLANTER, "planter").audience, "church");
  assert.equal(viewerFor(PLANTER, "coach").audience, "church");
  assert.equal(viewerFor(PLANTER, "team_member").audience, "church");
  assert.equal(
    viewerFor(OVERSIGHT_ADMIN, "sending_church_admin").audience,
    "oversight"
  );
  assert.equal(
    viewerFor(OVERSIGHT_ADMIN, "network_admin").audience,
    "oversight"
  );
});

test("a session naming no church still has no feed, whatever its role", () => {
  // Unchanged, and it is the ONLY thing between an oversight user and the feed
  // now that the audience is settled: their rows are scoped to each plant they
  // oversee, and deciding which plants one feed spans is #225's question.
  assert.equal(notificationViewer(session(PLANTER, "planter", null)), null);
  assert.equal(
    notificationViewer(session(OVERSIGHT_ADMIN, "network_admin", null)),
    null
  );
});

// ----------------------------------------------------------------------------
// ...and every read and both mark-read writes resolve with it
// ----------------------------------------------------------------------------

test("an oversight recipient with NO preference sees the digest everywhere", async () => {
  const lists = await allowListsFor(
    viewerFor(OVERSIGHT_ADMIN, "sending_church_admin")
  );

  for (const [path, categories] of Object.entries(lists)) {
    assert.ok(
      categories.includes("digest"),
      `${path} filtered the oversight digest back out`
    );
  }

  // The badge counts exactly the rows the feed lists — the invariant this
  // module exists to hold, restated for the audience-aware resolution.
  assert.deepEqual(lists.badge, lists.feed);
  assert.deepEqual(lists.markOne, lists.feed);
  assert.deepEqual(lists.markAll, lists.feed);
});

test("a planter's allow-list is unchanged — the digest stays out in-app", async () => {
  const lists = await allowListsFor(viewerFor(PLANTER, "planter"));

  for (const [path, categories] of Object.entries(lists)) {
    assert.equal(
      categories.includes("digest"),
      false,
      `${path} started showing the plant an in-app digest`
    );
    // The pinned shape: every category on, the digest's in-app row off.
    assert.deepEqual(
      categories,
      ["tasks", "meetings", "communication", "teams", "phase", "milestones"],
      `${path} drifted from the church coded defaults`
    );
  }
});

test("the two audiences differ by exactly one category", async () => {
  const church = await allowListsFor(viewerFor(PLANTER, "planter"));
  const oversight = await allowListsFor(
    viewerFor(OVERSIGHT_ADMIN, "network_admin")
  );

  assert.deepEqual(
    oversight.feed.filter((category) => !church.feed.includes(category)),
    ["digest"]
  );
  assert.deepEqual(
    church.feed.filter((category) => !oversight.feed.includes(category)),
    []
  );
});

// ----------------------------------------------------------------------------
// The production wiring
// ----------------------------------------------------------------------------

test("the default deps resolve the allow-list with the viewer's audience", () => {
  // The deps object is what production runs; the tests above prove the paths
  // route through whatever it provides. This pins the remaining link — that the
  // real `inAppCategories` is a function OF the viewer, so the audience cannot
  // be dropped on the way to `getInAppCategories`.
  assert.equal(dbNotificationFeedDeps.inAppCategories.length, 1);
});
