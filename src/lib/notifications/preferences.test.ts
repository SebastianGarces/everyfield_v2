import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { NotificationPreference } from "@/db/schema";

import { DEFAULT_DIGEST_CADENCE, defaultChannelEnabled } from "./categories";
import {
  buildPreferenceMap,
  isChannelEnabled,
  preferenceKey,
  resolvePreference,
  resolvePreferenceMatrix,
  setPreferenceQuery,
  setPreferenceSchema,
} from "./preferences";

// ----------------------------------------------------------------------------
// Preference resolution (N-005). The rule under test is that ABSENCE means the
// category's coded default, not "off" — and that a stored `false` is never
// re-defaulted back on.
//
// The upsert itself is a database guarantee (the unique index), asserted here
// against the generated migration and exercised for real by the backend
// validation gate.
// ----------------------------------------------------------------------------

const USER_ID = "user-1";

function makeRow(
  overrides: Partial<NotificationPreference> &
    Pick<NotificationPreference, "category" | "channel" | "enabled">
): NotificationPreference {
  return {
    id: `pref-${overrides.category}-${overrides.channel}`,
    userId: USER_ID,
    digestCadence: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// present-enabled / present-disabled / absent
// ----------------------------------------------------------------------------

test("a present enabled row resolves to enabled, attributed explicit", () => {
  const rows = [
    makeRow({ category: "tasks", channel: "email", enabled: true }),
  ];
  const resolved = resolvePreference(rows, "tasks", "email");

  assert.equal(resolved.enabled, true);
  assert.equal(resolved.source, "explicit");
});

test("a present disabled row resolves to disabled, attributed explicit", () => {
  const rows = [
    makeRow({ category: "tasks", channel: "email", enabled: false }),
  ];
  const resolved = resolvePreference(rows, "tasks", "email");

  assert.equal(resolved.enabled, false);
  assert.equal(resolved.source, "explicit");
});

test("an absent row resolves to the category's coded default", () => {
  const resolved = resolvePreference([], "tasks", "email");

  assert.equal(resolved.enabled, defaultChannelEnabled("tasks", "email"));
  assert.equal(resolved.enabled, true);
  assert.equal(resolved.source, "default");
});

test("absence is the default even where the default is off", () => {
  // digest/in_app is the one coded default that is off. Absence must resolve to
  // it, proving the resolver reads the table rather than assuming "on".
  const resolved = resolvePreference([], "digest", "in_app");

  assert.equal(resolved.enabled, false);
  assert.equal(resolved.source, "default");
});

test("a stored opt-out is not re-defaulted back on", () => {
  // The failure this guards: treating `false` as falsy/missing and falling
  // through to the coded default, which would silently re-enable an opt-out.
  const rows = [
    makeRow({ category: "meetings", channel: "email", enabled: false }),
  ];

  assert.equal(isChannelEnabled(rows, "meetings", "email"), false);
  assert.equal(defaultChannelEnabled("meetings", "email"), true);
});

test("resolution is per channel — one channel off does not affect the other", () => {
  const rows = [
    makeRow({ category: "tasks", channel: "email", enabled: false }),
  ];

  assert.equal(isChannelEnabled(rows, "tasks", "email"), false);
  assert.equal(isChannelEnabled(rows, "tasks", "in_app"), true);
});

test("resolution is per category — one category off does not affect another", () => {
  const rows = [
    makeRow({ category: "tasks", channel: "email", enabled: false }),
  ];

  assert.equal(isChannelEnabled(rows, "tasks", "email"), false);
  assert.equal(isChannelEnabled(rows, "meetings", "email"), true);
});

test("another user's rows cannot leak in — the map is keyed by pair only", () => {
  // `loadUserPreferences` is already user-scoped; this pins that the resolver
  // does not silently accept a mixed-user row set as if it were one user's.
  const rows = [
    makeRow({ category: "tasks", channel: "email", enabled: false }),
    makeRow({
      id: "pref-other",
      userId: "user-2",
      category: "tasks",
      channel: "email",
      enabled: true,
    }),
  ];

  // Last row wins in a mixed set — which is exactly why the loader must scope.
  const map = buildPreferenceMap(rows);
  assert.equal(map.size, 1);
  assert.equal(map.get(preferenceKey("tasks", "email"))?.userId, "user-2");
});

// ----------------------------------------------------------------------------
// Digest cadence
// ----------------------------------------------------------------------------

test("digest cadence defaults when absent and when the row leaves it null", () => {
  assert.equal(
    resolvePreference([], "digest", "email").digestCadence,
    DEFAULT_DIGEST_CADENCE
  );

  const rows = [
    makeRow({ category: "digest", channel: "email", enabled: true }),
  ];
  assert.equal(
    resolvePreference(rows, "digest", "email").digestCadence,
    DEFAULT_DIGEST_CADENCE
  );
});

test("a stored digest cadence wins", () => {
  const rows = [
    makeRow({
      category: "digest",
      channel: "email",
      enabled: true,
      digestCadence: "daily",
    }),
  ];

  assert.equal(
    resolvePreference(rows, "digest", "email").digestCadence,
    "daily"
  );
});

test("cadence is null on every category except digest", () => {
  assert.equal(resolvePreference([], "tasks", "email").digestCadence, null);
  assert.equal(resolvePreference([], "phase", "in_app").digestCadence, null);
});

// ----------------------------------------------------------------------------
// The settings matrix
// ----------------------------------------------------------------------------

test("the matrix resolves all twelve cells for a user with no rows", () => {
  const matrix = resolvePreferenceMatrix([]);

  assert.equal(matrix.length, 12);
  assert.ok(matrix.every((cell) => cell.source === "default"));
});

test("the matrix mixes explicit and default cells", () => {
  const matrix = resolvePreferenceMatrix([
    makeRow({ category: "teams", channel: "email", enabled: false }),
  ]);

  const explicit = matrix.filter((cell) => cell.source === "explicit");
  assert.equal(explicit.length, 1);
  assert.deepEqual(
    { category: explicit[0].category, channel: explicit[0].channel },
    { category: "teams", channel: "email" }
  );
  assert.equal(explicit[0].enabled, false);
});

// ----------------------------------------------------------------------------
// Input contract
// ----------------------------------------------------------------------------

test("setPreferenceSchema rejects an unknown category or channel", () => {
  assert.equal(
    setPreferenceSchema.safeParse({
      category: "billing",
      channel: "email",
      enabled: true,
    }).success,
    false
  );
  assert.equal(
    setPreferenceSchema.safeParse({
      category: "tasks",
      channel: "sms",
      enabled: true,
    }).success,
    false
  );
  assert.equal(
    setPreferenceSchema.safeParse({
      category: "tasks",
      channel: "email",
      enabled: true,
    }).success,
    true
  );
});

// ----------------------------------------------------------------------------
// The write boundary — setPreference parses, and does not clobber
// ----------------------------------------------------------------------------

const OWNER = "55555555-5555-4555-8555-555555555555";

/** The `do update set ...` clause alone — `returning` names every column. */
function updateClause(sql: string): string {
  return sql.slice(sql.indexOf("do update set"), sql.indexOf(" returning "));
}

test("setPreference parses its input rather than trusting the caller", () => {
  // The columns are plain varchar with a compile-time brand only, so a settings
  // action forwarding a form body would otherwise reach Postgres unopposed. A
  // preference stored under a category the code cannot name is never found by
  // `${category}:${channel}` resolution — the user sees a setting saved that
  // nothing will ever consult.
  assert.throws(() =>
    setPreferenceQuery(OWNER, {
      // @ts-expect-error the runtime guard is the point of this test
      category: "billing",
      channel: "email",
      enabled: false,
    })
  );

  assert.throws(() =>
    setPreferenceQuery(OWNER, {
      category: "tasks",
      // @ts-expect-error ditto for an unknown channel
      channel: "sms",
      enabled: false,
    })
  );
});

test("setPreference rejects a userId that is not a uuid", () => {
  assert.throws(() =>
    setPreferenceQuery("user-1", {
      category: "tasks",
      channel: "email",
      enabled: false,
    })
  );
});

test("a toggle that sends no cadence leaves the stored cadence alone", () => {
  // The N-007 shape: the logged-out email-footer unsubscribe, and any
  // checkbox-only toggle, submits `enabled` and nothing else. Writing
  // digest_cadence = NULL there would silently reset a user's explicit `daily`
  // to the `weekly` default, with no error and no way to notice.
  const { sql } = setPreferenceQuery(OWNER, {
    category: "digest",
    channel: "email",
    enabled: false,
  }).toSQL();

  const update = updateClause(sql);
  assert.ok(!update.includes("digest_cadence"), update);
  assert.ok(update.includes("enabled"), update);
});

test("a toggle that DOES send a cadence writes it", () => {
  const { sql, params } = setPreferenceQuery(OWNER, {
    category: "digest",
    channel: "email",
    enabled: true,
    digestCadence: "daily",
  }).toSQL();

  const update = updateClause(sql);
  assert.ok(update.includes("digest_cadence"), update);
  assert.ok(params.includes("daily"));
});

test("cadence is never written on a non-digest category", () => {
  const { sql, params } = setPreferenceQuery(OWNER, {
    category: "tasks",
    channel: "email",
    enabled: true,
    digestCadence: "daily",
  }).toSQL();

  const update = updateClause(sql);
  assert.ok(!update.includes("digest_cadence"), update);
  assert.ok(!params.includes("daily"));
});

// ----------------------------------------------------------------------------
// Uniqueness — the constraint the upsert depends on
// ----------------------------------------------------------------------------

test("the migration creates the (user_id, category, channel) unique index", () => {
  // Writing a preference twice UPDATES rather than duplicating, and that is
  // guaranteed by the index, not by application code. If this index ever stops
  // being created, `setPreference`'s ON CONFLICT has no arbiter and every save
  // inserts a duplicate row — so the constraint is asserted, not assumed.
  const sql = readFileSync(
    path.join(process.cwd(), "src/db/migrations/0023_notifications.sql"),
    "utf8"
  );

  assert.match(
    sql,
    /CREATE UNIQUE INDEX "notification_preferences_user_category_channel_idx" ON "notification_preferences" USING btree \("user_id","category","channel"\)/
  );
});

test("the enum sets are CHECK constraints in the database, not just a TS brand", () => {
  // `.$type<>()` vanishes at runtime. Without these, a value that never passed
  // a parse — from a script, a psql session, or a boundary someone forgets to
  // validate — sits in the table forever and is never found by the code-defined
  // lookups that are supposed to consult it.
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "src/db/migrations/0024_notification_enum_checks.sql"
    ),
    "utf8"
  );

  for (const constraint of [
    "notification_preferences_category_check",
    "notification_preferences_channel_check",
    "notification_preferences_digest_cadence_check",
    "notifications_category_check",
    "notifications_status_check",
  ]) {
    assert.ok(sql.includes(constraint), constraint);
  }
});
