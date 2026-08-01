import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import type { NotificationPreference } from "@/db/schema";

import {
  DEFAULT_DIGEST_CADENCE,
  defaultChannelEnabled,
  digestCadences,
  notificationCategories,
  notificationChannels,
  notificationPreferenceMatrixKeys,
} from "./categories";
import {
  audienceForRole,
  buildPreferenceMap,
  buildPreferenceMatrixView,
  DIGEST_CADENCE_CHANNEL,
  digestCadenceWriteIsNoop,
  isChannelEnabled,
  preferenceKey,
  preferenceOwnerFromSession,
  preferenceWriteIsNoop,
  resolveDigestCadence,
  resolveInAppCategories,
  resolvePreference,
  resolvePreferenceMatrix,
  setDigestCadenceQuery,
  setPreferenceQuery,
  setPreferenceSchema,
  UnauthenticatedPreferenceAccessError,
  type PreferenceOwner,
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

test("the matrix resolves every cell for a user with no rows", () => {
  const matrix = resolvePreferenceMatrix([]);

  assert.equal(
    matrix.length,
    notificationCategories.length * notificationChannels.length
  );
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

const OWNER_ID = "55555555-5555-4555-8555-555555555555";

/**
 * Minted the ONLY supported way — from a verified session. There is no cast
 * here on purpose: if `preferenceOwnerFromSession` stopped being the sole
 * entrance, this line would still compile but the tests below would no longer
 * be exercising the real call shape.
 */
const OWNER = preferenceOwnerFromSession({ user: { id: OWNER_ID } });

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

// ----------------------------------------------------------------------------
// Ownership — a preference is a consent record, so whose it is is a TYPE
// ----------------------------------------------------------------------------

test("a bare user id does not compile as a PreferenceOwner", () => {
  // The security property, checked by the COMPILER rather than at runtime: a
  // route reaching for `searchParams.get("user")` cannot call these functions
  // at all. The `@ts-expect-error` below is the assertion — `pnpm typecheck`
  // fails if this call ever starts type-checking — and it cannot rot into a
  // comment, because an unused directive is itself an error.
  const builder = setPreferenceQuery(
    // @ts-expect-error a plain string is not proof of ownership
    OWNER_ID,
    { category: "tasks", channel: "email", enabled: false }
  );

  // At runtime the id happens to be well-formed and the statement builds fine.
  // That is exactly why a runtime check could never have caught this, and why
  // ownership had to become a type.
  assert.ok(builder.toSQL().sql.includes("notification_preferences"));
});

test("minting an owner requires a session, and throws without one", () => {
  // The unauthenticated caller the module header says is not supported yet:
  // the N-007 email-footer unsubscribe needs a signed token, and until that
  // lands there is no second way to mint an owner.
  assert.throws(
    () => preferenceOwnerFromSession(null),
    UnauthenticatedPreferenceAccessError
  );
  assert.throws(
    () => preferenceOwnerFromSession(undefined),
    UnauthenticatedPreferenceAccessError
  );
  assert.equal(
    preferenceOwnerFromSession({ user: { id: OWNER_ID } }),
    OWNER_ID
  );
});

test("a minted owner still has to be a uuid", () => {
  // Belt to the type's braces: the brand proves ownership, the parse catches a
  // malformed id before it reaches Postgres. They answer different questions.
  assert.throws(() => preferenceOwnerFromSession({ user: { id: "user-1" } }));

  assert.throws(() =>
    setPreferenceQuery("user-1" as PreferenceOwner, {
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

// ----------------------------------------------------------------------------
// The in-app allow-list the feed and the badge are filtered by (N-005 at read
// time, ruled 2026-07-27)
// ----------------------------------------------------------------------------

test("with no stored rows the allow-list is the coded defaults, not everything", () => {
  const allowed = resolveInAppCategories([]);

  // Everything except `digest`/`in_app`, the one coded default that is off,
  // because an in-app digest row would duplicate the feed it summarises. A
  // "filter" that returned every category would be indistinguishable from no
  // filter. `milestones` IS in the list: an oversight partner is told about a
  // launch date once, and that row has to be somewhere they can see it (N-027).
  assert.deepEqual(allowed, [
    "tasks",
    "meetings",
    "communication",
    "teams",
    "phase",
    "milestones",
  ]);
  assert.ok(!allowed.includes("digest"));
});

test("a category switched off in-app leaves the allow-list", () => {
  const allowed = resolveInAppCategories([
    makeRow({ category: "meetings", channel: "in_app", enabled: false }),
  ]);

  assert.ok(!allowed.includes("meetings"));
  assert.ok(allowed.includes("tasks"));
});

test("the allow-list is per channel — turning off email keeps the feed row", () => {
  // The requirement in N-005's own words: a user can disable `tasks` email
  // while keeping `tasks` in-app.
  const allowed = resolveInAppCategories([
    makeRow({ category: "tasks", channel: "email", enabled: false }),
  ]);

  assert.ok(allowed.includes("tasks"));
});

test("an explicit opt-IN overrides a default that is off", () => {
  const allowed = resolveInAppCategories([
    makeRow({ category: "digest", channel: "in_app", enabled: true }),
  ]);

  assert.ok(allowed.includes("digest"));
});

test("a viewer who turned every category off gets an empty allow-list", () => {
  // Empty is a real answer and callers must treat it as "show nothing" — the
  // SQL side of that is asserted in queries.test.ts.
  const allowed = resolveInAppCategories(
    notificationCategories.map((category) =>
      makeRow({ category, channel: "in_app", enabled: false })
    )
  );

  assert.deepEqual(allowed, []);
});

// ----------------------------------------------------------------------------
// Screen 2 — the preferences screen's view model (N-006)
// ----------------------------------------------------------------------------

test("the matrix view renders every category × channel pair from the registry", () => {
  // AC: every combination is visible and toggleable, DRIVEN BY THE REGISTRY.
  // The expectation is derived from the same code-defined tuples the dispatcher
  // consults, never from a list written out here — so a seventh category that
  // the screen forgot to render fails this test, and a screen that hardcodes
  // today's six fails it the day a seventh is added.
  const view = buildPreferenceMatrixView([]);

  assert.deepEqual(
    view.categories.map((row) => row.category),
    [...notificationCategories]
  );

  assert.deepEqual(
    view.channels.map((column) => column.channel),
    [...notificationChannels]
  );

  const rendered = view.categories
    .flatMap((row) => row.cells.map((cell) => cell.key))
    .sort();

  const expected = notificationPreferenceMatrixKeys()
    .map(({ category, channel }) => preferenceKey(category, channel))
    .sort();

  assert.deepEqual(rendered, expected);
  assert.equal(
    rendered.length,
    notificationCategories.length * notificationChannels.length
  );
});

test("a user with no stored preferences sees their defaults, not everything off", () => {
  // AC (fresh user): the screen must not render an all-off matrix. Absence is
  // the coded default — the same rule the dispatcher applies — so a new user
  // opening settings sees what they are actually going to receive.
  const view = buildPreferenceMatrixView([]);

  for (const row of view.categories) {
    for (const cell of row.cells) {
      assert.equal(
        cell.enabled,
        defaultChannelEnabled(cell.category, cell.channel),
        cell.key
      );
      assert.equal(cell.source, "default", cell.key);
    }
  }

  // And at least one cell is genuinely ON, so "matches the defaults" cannot be
  // satisfied by defaults that are all off.
  assert.ok(
    view.categories.some((row) => row.cells.some((cell) => cell.enabled))
  );
});

test("a stored row shows through the view, attributed explicit", () => {
  const view = buildPreferenceMatrixView([
    makeRow({ category: "tasks", channel: "email", enabled: false }),
  ]);

  const cell = view.categories
    .flatMap((row) => row.cells)
    .find((c) => c.key === preferenceKey("tasks", "email"));

  assert.equal(cell?.enabled, false);
  assert.equal(cell?.source, "explicit");

  // The other cell of the same category is untouched.
  const sibling = view.categories
    .flatMap((row) => row.cells)
    .find((c) => c.key === preferenceKey("tasks", "in_app"));

  assert.equal(sibling?.source, "default");
});

test("every category states its purpose in plain language", () => {
  // better-writing: a user deciding whether to switch something off has to be
  // told what they would stop hearing about. A label alone does not do that,
  // and neither does a description that only restates the label.
  const view = buildPreferenceMatrixView([]);

  for (const row of view.categories) {
    assert.ok(row.label.length > 0, row.category);
    assert.ok(
      row.description.length >= 20,
      `${row.category}: "${row.description}"`
    );
    assert.ok(
      row.description.endsWith("."),
      `${row.category}: descriptions are sentences`
    );
    assert.notEqual(
      row.description.toLowerCase(),
      row.label.toLowerCase(),
      `${row.category}: the description must say more than the label`
    );
    // No internal vocabulary — a requirement id or a category slug in
    // user-facing copy is a leak, not an explanation.
    assert.doesNotMatch(
      row.description,
      /\bN-\d{3}\b|in_app|enqueue|dispatch/i,
      `${row.category}: "${row.description}"`
    );
  }
});

// ----------------------------------------------------------------------------
// Digest cadence — the user's OWN open-items digest (N-013), and only that
// ----------------------------------------------------------------------------

test("the cadence selector offers every coded cadence, within the digest category", () => {
  const view = buildPreferenceMatrixView([]);

  assert.equal(view.digest.category, "digest");
  assert.deepEqual(
    view.digest.options.map((option) => option.value),
    [...digestCadences]
  );
  assert.ok(view.digest.options.every((option) => option.label.length > 0));

  // It is attached to a category the matrix actually renders, so "within the
  // digest category" is structural rather than a layout accident.
  assert.ok(
    view.categories.some((row) => row.category === view.digest.category)
  );
});

test("cadence copy is scoped to the reader's own digest, never the oversight one", () => {
  // The boundary this protects: N-013 is the user's own open-items roll-up and
  // is the only digest whose cadence anyone chooses here. The OVERSIGHT
  // activity digest (N-025) is fixed daily and is gated by a plant-side sharing
  // toggle (N-026) on another screen. Copy here that mentioned sharing, sending
  // churches or networks would tell a planter that this control decides what
  // leaves their plant — which is a different toggle, owned elsewhere.
  const view = buildPreferenceMatrixView([]);
  const copy =
    `${view.digest.label} ${view.digest.description} ` +
    (view.categories.find((row) => row.category === "digest")?.description ??
      "");

  assert.match(copy, /\byour\b/i, copy);

  for (const forbidden of [
    /sending church/i,
    /\bnetwork\b/i,
    /oversight/i,
    /\bshar(e|ed|ing)\b/i,
    /\bcoach\b/i,
    /\bplant(?:'s)? activity\b/i,
  ]) {
    assert.doesNotMatch(
      copy,
      forbidden,
      `digest copy implies sharing: ${copy}`
    );
  }
});

test("the cadence is one category-level answer, not one per channel", () => {
  assert.equal(resolveDigestCadence([]), DEFAULT_DIGEST_CADENCE);

  assert.equal(
    resolveDigestCadence([
      makeRow({
        category: "digest",
        channel: DIGEST_CADENCE_CHANNEL,
        enabled: true,
        digestCadence: "daily",
      }),
    ]),
    "daily"
  );

  // A cadence written to the OTHER digest row — by `setPreference`, or by an
  // older shape of this code — is still honoured rather than silently
  // reverting the user to the default.
  const other = notificationChannels.find(
    (channel) => channel !== DIGEST_CADENCE_CHANNEL
  )!;
  assert.equal(
    resolveDigestCadence([
      makeRow({
        category: "digest",
        channel: other,
        enabled: true,
        digestCadence: "daily",
      }),
    ]),
    "daily"
  );

  // A cadence on a non-digest row is not a digest cadence.
  assert.equal(
    resolveDigestCadence([
      makeRow({
        category: "tasks",
        channel: "email",
        enabled: true,
        digestCadence: "daily",
      }),
    ]),
    DEFAULT_DIGEST_CADENCE
  );
});

test("setDigestCadence writes the cadence and leaves `enabled` alone", () => {
  // Cadence and "is the digest on at all" are separate controls. A user who
  // switched their digest email off and then changed the cadence has not asked
  // for it back on, so `enabled` must not appear in the update clause.
  const { sql, params } = setDigestCadenceQuery(OWNER, "daily").toSQL();

  const update = updateClause(sql);
  assert.ok(update.includes("digest_cadence"), update);
  assert.ok(!update.includes("enabled"), update);
  assert.ok(params.includes("daily"));
  assert.ok(params.includes("digest"));
  assert.ok(params.includes(OWNER_ID));

  // The INSERT arm supplies the CODED DEFAULT for the row it creates, so the
  // row is behaviourally identical to the absence it replaces.
  assert.ok(
    params.includes(defaultChannelEnabled("digest", DIGEST_CADENCE_CHANNEL))
  );
});

test("setDigestCadence rejects a cadence the code does not define", () => {
  assert.throws(() =>
    // @ts-expect-error the runtime guard is the point of this test
    setDigestCadenceQuery(OWNER, "hourly")
  );
});

test("a bare user id does not compile as a PreferenceOwner on the cadence write", () => {
  // The same ownership property as `setPreferenceQuery`, asserted for the
  // second write path so it cannot be the loose one. A `@ts-expect-error` that
  // stopped being an error would itself fail `pnpm typecheck`.
  const builder = setDigestCadenceQuery(
    // @ts-expect-error a plain string is not proof of ownership
    OWNER_ID,
    "daily"
  );

  assert.ok(builder.toSQL().sql.length > 0);
});

// ----------------------------------------------------------------------------
// Only write a row on an ACTUAL change
// ----------------------------------------------------------------------------

test("writing the value a user already has by DEFAULT is a no-op", () => {
  // If the screen saved every control it rendered, a user who opened settings
  // and changed one thing would leave with twelve explicit rows restating
  // today's defaults — and would then be pinned to them when N-019 (role-aware
  // defaults) lands or a default is reconsidered. Absence has to survive.
  for (const { category, channel } of notificationPreferenceMatrixKeys()) {
    assert.equal(
      preferenceWriteIsNoop(
        [],
        category,
        channel,
        defaultChannelEnabled(category, channel)
      ),
      true,
      preferenceKey(category, channel)
    );

    assert.equal(
      preferenceWriteIsNoop(
        [],
        category,
        channel,
        !defaultChannelEnabled(category, channel)
      ),
      false,
      preferenceKey(category, channel)
    );
  }
});

test("writing the value a user already chose EXPLICITLY is a no-op too", () => {
  const rows = [
    makeRow({ category: "tasks", channel: "email", enabled: false }),
  ];

  assert.equal(preferenceWriteIsNoop(rows, "tasks", "email", false), true);
  assert.equal(preferenceWriteIsNoop(rows, "tasks", "email", true), false);
});

test("re-selecting the cadence a user already has is a no-op", () => {
  assert.equal(digestCadenceWriteIsNoop([], DEFAULT_DIGEST_CADENCE), true);

  const other = digestCadences.find(
    (cadence) => cadence !== DEFAULT_DIGEST_CADENCE
  )!;
  assert.equal(digestCadenceWriteIsNoop([], other), false);

  const rows = [
    makeRow({
      category: "digest",
      channel: DIGEST_CADENCE_CHANNEL,
      enabled: true,
      digestCadence: other,
    }),
  ];
  assert.equal(digestCadenceWriteIsNoop(rows, other), true);
  assert.equal(digestCadenceWriteIsNoop(rows, DEFAULT_DIGEST_CADENCE), false);
});

test("a toggle the user really changed does reach the database", () => {
  // The other half of the no-op rule: a real change must not be swallowed. The
  // statement carries the owner, the pair and the new value, and it is an
  // upsert on the (user_id, category, channel) index — which is what makes the
  // next dispatch read the new value (dispatch.test.ts asserts the read side).
  const rows = [
    makeRow({ category: "tasks", channel: "email", enabled: true }),
  ];
  assert.equal(preferenceWriteIsNoop(rows, "tasks", "email", false), false);

  const { sql, params } = setPreferenceQuery(OWNER, {
    category: "tasks",
    channel: "email",
    enabled: false,
  }).toSQL();

  assert.ok(sql.includes("on conflict"), sql);
  assert.ok(params.includes(OWNER_ID));
  assert.ok(params.includes("tasks"));
  assert.ok(params.includes(false));
});

// ----------------------------------------------------------------------------
// The audience only ever decides what an ABSENT row means (N-027)
// ----------------------------------------------------------------------------

test("audienceForRole maps the five roles onto the two audiences", () => {
  assert.equal(audienceForRole("planter"), "church");
  assert.equal(audienceForRole("coach"), "church");
  assert.equal(audienceForRole("team_member"), "church");
  assert.equal(audienceForRole("sending_church_admin"), "oversight");
  assert.equal(audienceForRole("network_admin"), "oversight");
});

test("an oversight recipient's in-app allow-list includes the digest", () => {
  // No stored rows at all — the state every user starts in.
  assert.equal(resolveInAppCategories([]).includes("digest"), false);
  assert.equal(
    resolveInAppCategories([], "oversight").includes("digest"),
    true
  );
});

test("an EXPLICIT preference beats the audience default, both ways", () => {
  // The audience decides what absence means and nothing else: an oversight user
  // who switched the in-app digest off keeps it off.
  const off: NotificationPreference = {
    id: "pref-1",
    userId: "user-1",
    category: "digest",
    channel: "in_app",
    enabled: false,
    digestCadence: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  assert.equal(
    resolveInAppCategories([off], "oversight").includes("digest"),
    false
  );
  assert.equal(
    resolvePreference([off], "digest", "in_app", "oversight").source,
    "explicit"
  );

  const on: NotificationPreference = { ...off, id: "pref-2", enabled: true };
  assert.equal(resolveInAppCategories([on]).includes("digest"), true);
});
