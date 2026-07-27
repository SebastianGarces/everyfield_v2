import assert from "node:assert/strict";
import { test } from "node:test";

import {
  DEFAULT_DIGEST_CADENCE,
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

test("the category set is exactly the six the FRD defines", () => {
  assert.deepEqual(
    [...notificationCategories],
    ["tasks", "meetings", "communication", "teams", "phase", "digest"]
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
  assert.equal(new Set(keys.map((k) => `${k.category}:${k.channel}`)).size, 12);
  // Stable order — the settings screen renders it directly.
  assert.deepEqual(keys[0], { category: "tasks", channel: "email" });
  assert.deepEqual(keys.at(-1), { category: "digest", channel: "in_app" });
});
