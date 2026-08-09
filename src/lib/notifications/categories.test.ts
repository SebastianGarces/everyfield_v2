import assert from "node:assert/strict";
import { test } from "node:test";

import {
  audienceMayReceiveCategory,
  DEFAULT_DIGEST_CADENCE,
  ineligibleCategoriesForAudience,
  isOversightEligibleCategory,
  OVERSIGHT_CHANNEL_DEFAULT_OVERRIDES,
  OVERSIGHT_ELIGIBLE_CATEGORIES,
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

// ----------------------------------------------------------------------------
// What an oversight reader is never served (ruled 2026-08-09, extending #254)
//
// The settings screen has to know which rows it may offer, and it must derive
// that from `OVERSIGHT_ELIGIBLE_CATEGORIES` rather than carrying its own list.
// These tests pin the derivation, not a snapshot of today's five names.
// ----------------------------------------------------------------------------

test("a church reader is served every category, so nothing is ineligible", () => {
  assert.deepEqual(ineligibleCategoriesForAudience("church"), []);

  for (const category of notificationCategories) {
    assert.equal(
      audienceMayReceiveCategory("church", category),
      true,
      `church reader refused ${category}`
    );
  }
});

test("an oversight reader is served the allow-list and nothing else", () => {
  const ineligible = ineligibleCategoriesForAudience("oversight");

  // Stated as the COMPLEMENT of the allow-list, so adding a category to
  // `OVERSIGHT_ELIGIBLE_CATEGORIES` moves it out of this set with no edit here.
  assert.deepEqual(
    ineligible,
    notificationCategories.filter(
      (category) =>
        !(OVERSIGHT_ELIGIBLE_CATEGORIES as readonly string[]).includes(category)
    )
  );

  // And it is not empty — the ruling exists because five rows are offered today
  // that never arrive.
  assert.equal(ineligible.length, 5);
  assert.equal(ineligible.includes("milestones"), false);
  assert.equal(ineligible.includes("digest"), false);
});

test("the two questions agree, category by category, for both audiences", () => {
  for (const category of notificationCategories) {
    assert.equal(
      audienceMayReceiveCategory("oversight", category),
      isOversightEligibleCategory(category),
      `${category}: the audience question disagreed with the allow-list`
    );

    assert.equal(
      ineligibleCategoriesForAudience("oversight").includes(category),
      !audienceMayReceiveCategory("oversight", category),
      `${category}: the set disagreed with the predicate`
    );
  }
});

test("ineligibility is stated in the matrix's own order", () => {
  // The screen renders `notificationCategories` in order; a set in a different
  // order would make a row-by-row comparison in review harder than it needs to
  // be, and would make "the first ineligible row" mean two different things.
  const ineligible = ineligibleCategoriesForAudience("oversight");
  const positions = ineligible.map((category) =>
    notificationCategories.indexOf(category)
  );
  assert.deepEqual(
    positions,
    [...positions].sort((a, b) => a - b)
  );
});

test("an oversight reader is refused a category the code has never heard of", () => {
  // Fails CLOSED, like `defaultChannelEnabled` above: the allow-list is an
  // allow-list, so anything not on it is refused whether or not it is real.
  const unknown = "something_new" as NotificationCategory;
  assert.equal(audienceMayReceiveCategory("oversight", unknown), false);
  assert.equal(audienceMayReceiveCategory("church", unknown), true);
});
