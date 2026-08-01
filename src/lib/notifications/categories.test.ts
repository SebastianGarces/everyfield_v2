import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DIGEST_CADENCE,
  OVERSIGHT_CHANNEL_DEFAULT_OVERRIDES,
  defaultChannelEnabled,
  isDigestCadence,
  isNotificationCategory,
  isNotificationChannel,
  NOTIFICATION_CATEGORIES,
  notificationCategories,
  notificationChannels,
  notificationPreferenceMatrixKeys,
  type NotificationCategory,
  type NotificationChannel,
} from "./categories";

// ----------------------------------------------------------------------------
// The category set is fixed and code-defined (N-005). These tests pin the two
// properties everything downstream leans on: the set is closed, and every
// (category, channel) pair has a coded default — because an absent preference
// row resolves to that default, so a hole in this table would be a hole in
// delivery.
// ----------------------------------------------------------------------------

test("the category set is exactly the seven the FRD defines", () => {
  // `milestones` joined the six in #224 (N-025): the three events an oversight
  // partner hears about the day they happen needed a category of their own so
  // that "oversight never receives a granular category" could be enforced by a
  // closed allow-list rather than by a convention about `type` strings.
  assert.deepEqual(
    [...notificationCategories],
    [
      "tasks",
      "meetings",
      "communication",
      "teams",
      "phase",
      "milestones",
      "digest",
    ]
  );
});

test("v1 ships exactly two channels", () => {
  assert.deepEqual([...notificationChannels], ["email", "in_app"]);
});

test("every category has a definition with a default per channel", () => {
  for (const category of notificationCategories) {
    const definition = NOTIFICATION_CATEGORIES[category];
    assert.ok(definition, `${category} has no definition`);
    assert.ok(definition.label.length > 0);
    assert.ok(definition.description.length > 0);
    for (const channel of notificationChannels) {
      assert.equal(
        typeof definition.defaults[channel],
        "boolean",
        `${category}/${channel} has no coded default`
      );
    }
  }
});

test("defaults are opt-out everywhere except the digest's in-app row", () => {
  for (const category of notificationCategories) {
    assert.equal(
      defaultChannelEnabled(category, "email"),
      true,
      `${category} email default`
    );
  }

  for (const category of notificationCategories) {
    assert.equal(
      defaultChannelEnabled(category, "in_app"),
      category !== "digest",
      `${category} in_app default`
    );
  }
});

test("an unrecognised category fails CLOSED — the default answer to 'send?' is no", () => {
  // This is a consent decision, so it defaults the safe way: a category the
  // running code cannot name has no copy, no settings row a user could ever
  // have seen, and no way for them to have opted out of it. Sending it anyway
  // is worse than waiting for the deploy that understands it.
  const unknown = "something_new" as NotificationCategory;
  assert.equal(defaultChannelEnabled(unknown, "email"), false);
  assert.equal(defaultChannelEnabled(unknown, "in_app"), false);

  // Same for a channel that is not in the coded set.
  assert.equal(
    defaultChannelEnabled("tasks", "sms" as NotificationChannel),
    false
  );
});

test("guards accept members and reject everything else", () => {
  assert.equal(isNotificationCategory("tasks"), true);
  assert.equal(isNotificationCategory("Tasks"), false);
  assert.equal(isNotificationCategory("sms"), false);
  assert.equal(isNotificationCategory(undefined), false);

  assert.equal(isNotificationChannel("in_app"), true);
  assert.equal(isNotificationChannel("push"), false);

  assert.equal(isDigestCadence("weekly"), true);
  assert.equal(isDigestCadence("monthly"), false);
});

test("the digest default cadence is weekly", () => {
  assert.equal(DEFAULT_DIGEST_CADENCE, "weekly");
});

test("the preference matrix covers every category on every channel", () => {
  const keys = notificationPreferenceMatrixKeys();

  assert.equal(
    keys.length,
    notificationCategories.length * notificationChannels.length
  );
  // Derived, not literal: the count is a consequence of the registry, and a
  // literal here would only ever record how many categories existed the day it
  // was written.
  assert.equal(
    new Set(keys.map((k) => `${k.category}:${k.channel}`)).size,
    notificationCategories.length * notificationChannels.length
  );
  // Stable order — the settings screen renders it directly.
  assert.deepEqual(keys[0], { category: "tasks", channel: "email" });
  assert.deepEqual(keys.at(-1), { category: "digest", channel: "in_app" });
});

// ----------------------------------------------------------------------------
// Audience-aware defaults (N-027)
// ----------------------------------------------------------------------------

test("an oversight recipient's digest is visible IN APP by default", () => {
  // The reason `digest`/`in_app` is off is that an in-app digest row would
  // duplicate the feed it summarises. That is true for the plant's own team and
  // false for an oversight recipient, who is refused every granular category —
  // there is no feed for their digest to duplicate. With the shared default the
  // digest was emailed and then filtered out of the feed, the unread badge and
  // mark-read, which is ruled N-027 failing quietly in the read path.
  assert.equal(defaultChannelEnabled("digest", "in_app", "church"), false);
  assert.equal(defaultChannelEnabled("digest", "in_app", "oversight"), true);
});

test("the audience defaults to the church, so no caller changes behaviour by omission", () => {
  for (const category of notificationCategories) {
    for (const channel of notificationChannels) {
      assert.equal(
        defaultChannelEnabled(category, channel),
        defaultChannelEnabled(category, channel, "church"),
        `${category}/${channel}`
      );
    }
  }
});

test("the override table is SPARSE — one exception, not a second table", () => {
  // If this grows, the reason each entry exists has to grow with it. Two full
  // tables of defaults would drift; a short list of exceptions cannot.
  assert.deepEqual(Object.keys(OVERSIGHT_CHANNEL_DEFAULT_OVERRIDES), [
    "digest",
  ]);

  for (const category of notificationCategories) {
    for (const channel of notificationChannels) {
      if (category === "digest" && channel === "in_app") continue;
      assert.equal(
        defaultChannelEnabled(category, channel, "oversight"),
        defaultChannelEnabled(category, channel, "church"),
        `${category}/${channel} diverged without an entry in the override table`
      );
    }
  }
});

test("an unknown category fails closed for BOTH audiences", () => {
  const unknown = "something_new" as NotificationCategory;
  assert.equal(defaultChannelEnabled(unknown, "in_app", "oversight"), false);
  assert.equal(defaultChannelEnabled(unknown, "email", "oversight"), false);
});
