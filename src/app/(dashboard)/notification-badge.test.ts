import assert from "node:assert/strict";
import { beforeEach, mock, test } from "node:test";

import { notFound, redirect } from "next/navigation";

import type { NotificationViewer } from "@/lib/notifications/feed";

import { loadUnreadBadgeCountSafely } from "./notification-badge";

// ----------------------------------------------------------------------------
// Failure isolation for the shell's unread badge (#227).
//
// The fault is injected at the loader, which is exactly where it appeared in
// production: `loadUnreadBadgeCount` rejected (a missing table on dev Neon) and
// the dashboard layout awaited it unguarded, so every dashboard route 500'd.
// What these assert is that the same rejection now RESOLVES to something the
// shell can render — the layout can finish, so every route still renders —
// while Next.js control-flow errors, which are thrown but are not failures,
// still escape.
//
// What it resolves TO is `"unavailable"`, not a number (#528). A failure that
// spelled itself `0` was indistinguishable from "none unread", so the shell
// answered a question it had not read the answer to.
//
// The viewer is a cast rather than a real one on purpose: `notificationViewer`
// needs a session and `PreferenceOwner` is branded so it cannot be assembled
// here, and none of these assertions look at the viewer at all — it is passed
// through to the injected loader untouched.
// ----------------------------------------------------------------------------

const VIEWER = {
  scope: { churchId: "church-a", recipientUserId: "user-1" },
  owner: { churchId: "church-a", userId: "user-1" },
} as unknown as NotificationViewer;

// The degraded path logs on purpose (a silently zeroed badge is how this bug
// hides). Silenced here so an expected log does not read as a test failure.
beforeEach(() => {
  mock.method(console, "error", () => {});
});

class NotificationsUnavailable extends Error {
  constructor() {
    super('relation "notifications" does not exist');
    this.name = "NotificationsUnavailable";
  }
}

test("a rejecting unread-count query reports 'unavailable' instead of throwing", async () => {
  const count = await loadUnreadBadgeCountSafely(VIEWER, async () => {
    throw new NotificationsUnavailable();
  });

  assert.equal(count, "unavailable");
  // The specific value this replaced. Zero is what "none unread" looks like,
  // and a failed read has not earned that sentence.
  assert.notEqual(count, 0);
});

test("a loader that throws synchronously reports the same way", async () => {
  const count = await loadUnreadBadgeCountSafely(VIEWER, () => {
    throw new NotificationsUnavailable();
  });

  assert.equal(count, "unavailable");
});

test("the happy path is unchanged — the real count passes straight through", async () => {
  const seen: NotificationViewer[] = [];

  const count = await loadUnreadBadgeCountSafely(VIEWER, async (viewer) => {
    seen.push(viewer);
    return 7;
  });

  assert.equal(count, 7);
  // The viewer reaches the loader untouched, so the badge still counts exactly
  // the categories the feed lists.
  assert.deepEqual(seen, [VIEWER]);
});

test("zero unread stays zero — 'all caught up' is an answer, not a failure", async () => {
  assert.equal(await loadUnreadBadgeCountSafely(VIEWER, async () => 0), 0);
});

test("a nonsense count is reported unavailable rather than reaching the header", async () => {
  assert.equal(
    await loadUnreadBadgeCountSafely(VIEWER, async () => NaN),
    "unavailable"
  );
  assert.equal(
    await loadUnreadBadgeCountSafely(VIEWER, async () => -3),
    "unavailable"
  );
  assert.equal(
    await loadUnreadBadgeCountSafely(VIEWER, async () => Infinity),
    "unavailable"
  );
  assert.equal(await loadUnreadBadgeCountSafely(VIEWER, async () => 12.7), 12);
});

// ----------------------------------------------------------------------------
// What must still escape: a Next.js control-flow error is thrown, but it is an
// instruction to the framework, not a failure. Swallowing one would turn a
// working redirect into a silently zeroed badge.
// ----------------------------------------------------------------------------

test("a redirect() thrown under the badge read is rethrown, not swallowed", async () => {
  await assert.rejects(
    loadUnreadBadgeCountSafely(VIEWER, async () => {
      redirect("/login");
    }),
    (error: unknown) => error instanceof Error
  );
});

test("a notFound() thrown under the badge read is rethrown, not swallowed", async () => {
  await assert.rejects(
    loadUnreadBadgeCountSafely(VIEWER, async () => {
      notFound();
    }),
    (error: unknown) => error instanceof Error
  );
});

test("a control-flow error wrapped as a cause is still rethrown", async () => {
  await assert.rejects(
    loadUnreadBadgeCountSafely(VIEWER, async () => {
      try {
        redirect("/login");
      } catch (cause) {
        throw new Error("badge read failed", { cause });
      }
    }),
    (error: unknown) => error instanceof Error
  );
});
