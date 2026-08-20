import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { preferenceIntents, type NotificationPreference } from "@/db/schema";
import type { TenancyFields } from "@/lib/auth/tenancy";
import { sourceReader } from "@/lib/testing/source-span";

import {
  DEFAULT_DIGEST_CADENCE,
  defaultChannelEnabled,
  digestCadences,
  ineligibleCategoriesForAudience,
  notificationCategories,
  notificationChannels,
  notificationPreferenceMatrixKeys,
  OVERSIGHT_ELIGIBLE_CATEGORIES,
} from "./categories";
import {
  audienceForTenancy,
  buildPreferenceMap,
  buildPreferenceMatrixView,
  DIGEST_CADENCE_CHANNEL,
  digestCadenceWriteIsNoop,
  isChannelEnabled,
  isUnauthenticatedPreferenceError,
  OVERSIGHT_DIGEST_CADENCE_NOTE,
  OVERSIGHT_INELIGIBLE_CATEGORY_NOTE,
  PREFERENCE_SAVE_FAILED_MESSAGE,
  PREFERENCE_SESSION_EXPIRED_MESSAGE,
  preferenceKey,
  preferenceOwnerFromSession,
  preferenceSaveFailure,
  preferenceValueIsInheritable,
  preferenceWriteIsNoop,
  resolveDigestCadence,
  resolveInAppCategories,
  resolvePreference,
  resolvePreferenceMatrix,
  setDigestCadenceQuery,
  setPreferenceQuery,
  setPreferenceSchema,
  UnauthenticatedPreferenceAccessError,
  type DigestCadenceChoiceView,
  type PreferenceMatrixView,
  type PreferenceOwner,
} from "./preferences";
import {
  UNAUTHORIZED_MESSAGE,
  UnauthorizedError,
} from "@/lib/auth/unauthorized";

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

/**
 * A tenancy, with all three FKs named — the shape `audienceForTenancy` reads.
 *
 * Every fixture below spells the nulls out because the type requires it: the
 * audience is a property of WHICH tenancy a row names, and a projection that
 * omitted an oversight FK would resolve an oversight reader to the church
 * defaults, which is exactly the N-027 bug these tests exist for.
 */
function tenancy(fields: Partial<TenancyFields> = {}): TenancyFields {
  return {
    churchId: null,
    sendingChurchId: null,
    sendingNetworkId: null,
    ...fields,
  };
}

/** The tenancy shapes the five role names collapsed onto, with their audience. */
const TENANCY_AUDIENCES = [
  ["a seat in a plant", tenancy({ churchId: "church-1" }), "church"],
  ["a coach, who names no tenancy at all", tenancy(), "church"],
  [
    "a sending church's account",
    tenancy({ sendingChurchId: "sending-church-1" }),
    "oversight",
  ],
  [
    "a network's account",
    tenancy({ sendingNetworkId: "network-1" }),
    "oversight",
  ],
] as const satisfies readonly (readonly [
  string,
  TenancyFields,
  "church" | "oversight",
])[];

/** The two tenancy shapes that read with the oversight defaults. */
const OVERSIGHT_TENANCIES = TENANCY_AUDIENCES.filter(
  ([, , audience]) => audience === "oversight"
);

/** The two that read with the church ones — a plant seat, and a coach. */
const CHURCH_TENANCIES = TENANCY_AUDIENCES.filter(
  ([, , audience]) => audience === "church"
);

/**
 * A stored row, defaulting to the BY-PRODUCT stamp.
 *
 * `incidental` is the default because it is the only stamp the value-equality
 * rule has anything to say about: a test that means "somebody decided this"
 * has to say `intent: "chosen"`, so a decision is never asserted by accident.
 */
function makeRow(
  overrides: Partial<NotificationPreference> &
    Pick<NotificationPreference, "category" | "channel" | "enabled">
): NotificationPreference {
  return {
    id: `pref-${overrides.category}-${overrides.channel}`,
    userId: USER_ID,
    intent: "incidental",
    digestCadence: null,
    createdAt: new Date("2026-07-01T00:00:00.000Z"),
    updatedAt: new Date("2026-07-01T00:00:00.000Z"),
    ...overrides,
  };
}

// ----------------------------------------------------------------------------
// present-enabled / present-disabled / absent
// ----------------------------------------------------------------------------

test("a present INCIDENTAL row that AGREES with the coded default is inheritable", () => {
  // `tasks`/`in_app` defaults to on, so a stored `true` nobody chose says
  // nothing the default did not — and reading it as a CHOICE is what pinned
  // users to today's defaults, keeping N-019's role-aware defaults from ever
  // reaching them. The value is the same either way; the attribution is the fix.
  const rows = [
    makeRow({ category: "tasks", channel: "in_app", enabled: true }),
  ];
  const resolved = resolvePreference(rows, "tasks", "in_app");

  assert.equal(resolved.enabled, true);
  assert.equal(resolved.enabled, defaultChannelEnabled("tasks", "in_app"));
  assert.equal(resolved.source, "default");
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

/**
 * The `do update set ...` clause alone — `returning` names every column.
 *
 * Both anchors are REQUIRED here, which is why this is a `span` and not a pair
 * of `indexOf` calls: an upsert that lost its conflict clause, or a builder
 * that stopped rendering ` returning `, would otherwise be sliced into the
 * whole statement or the empty string and the "does not clobber" assertions
 * below would go quiet instead of red.
 */
function updateClause(sql: string): string {
  return sourceReader(sql, "setPreferenceQuery SQL").span(
    "do update set",
    " returning "
  );
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

test("the intent stamp is a real column, closed by a CHECK and backfilled", () => {
  // The stamp is what `preferenceValueIsInheritable` decides on, so a deploy
  // whose database lacks the column answers no preference at all. The CHECK
  // matters for the same reason the other three do: `.$type<>()` vanishes at
  // runtime, and a stamp the code cannot name puts a consent record in a state
  // no resolver has a rule for.
  const sql = readFileSync(
    path.join(
      process.cwd(),
      "src/db/migrations/0047_preference_intent_stamp.sql"
    ),
    "utf8"
  );

  assert.match(
    sql,
    /ADD COLUMN "intent" varchar\(16\) DEFAULT 'chosen' NOT NULL/
  );
  assert.ok(sql.includes("notification_preferences_intent_check"));
  for (const intent of preferenceIntents) {
    assert.ok(sql.includes(`'${intent}'`), intent);
  }

  // Existing rows are stamped to REPRODUCE the answer the channel-inferred rule
  // gave them, so nobody's resolved preference moves on the day this applies.
  // The migration header states the assumption; this pins the statement.
  assert.match(
    sql,
    /UPDATE "notification_preferences" SET "intent" = 'incidental' WHERE "channel" <> 'email' OR "category" = 'digest'/
  );
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

/**
 * The cadence area as a SELECTOR, refusing anything else.
 *
 * `assert.ok` narrows the union, so a test that expects a control cannot
 * quietly pass against the oversight variant that has none (#254).
 */
function cadenceChoice(view: PreferenceMatrixView): DigestCadenceChoiceView {
  const { digest } = view;
  assert.ok(digest.kind === "choice", "expected a cadence selector");
  return digest;
}

test("the cadence selector offers every coded cadence, within the digest category", () => {
  const view = buildPreferenceMatrixView([]);
  const digest = cadenceChoice(view);

  assert.equal(digest.category, "digest");
  assert.deepEqual(
    digest.options.map((option) => option.value),
    [...digestCadences]
  );
  assert.ok(digest.options.every((option) => option.label.length > 0));

  // It is attached to a category the matrix actually renders, so "within the
  // digest category" is structural rather than a layout accident.
  assert.ok(view.categories.some((row) => row.category === digest.category));
});

test("cadence copy is scoped to the reader's own digest, never the oversight one", () => {
  // The boundary this protects: N-013 is the user's own open-items roll-up and
  // is the only digest whose cadence anyone chooses here. The OVERSIGHT
  // activity digest (N-025) is fixed daily and is gated by a plant-side sharing
  // toggle (N-026) on another screen. Copy here that mentioned sharing, sending
  // churches or networks would tell a planter that this control decides what
  // leaves their plant — which is a different toggle, owned elsewhere.
  const view = buildPreferenceMatrixView([]);
  const digest = cadenceChoice(view);
  const copy =
    `${digest.label} ${digest.description} ` +
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

test("audienceForTenancy maps every tenancy onto one of the two audiences", () => {
  // The five role names were four tenancies: the three church roles differed
  // only in seat, and the seat has nothing to say about which defaults an
  // absent row falls back to.
  for (const [who, fields, audience] of TENANCY_AUDIENCES) {
    assert.equal(audienceForTenancy(fields), audience, who);
  }
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
    intent: "chosen",
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

test("the settings matrix resolves with the SAME audience the feed does", () => {
  // The divergence this closes: `/settings` used to build the matrix with the
  // church defaults for everyone, so an oversight admin with no stored rows saw
  // `digest`/`in_app` unchecked while `resolveInAppCategories` — the feed and
  // the badge — had it ON. The screen was describing a different product than
  // the one running.
  const cellFor = (view: ReturnType<typeof buildPreferenceMatrixView>) =>
    view.categories
      .find((row) => row.category === "digest")!
      .cells.find((cell) => cell.channel === "in_app")!;

  const church = cellFor(buildPreferenceMatrixView([]));
  const oversight = cellFor(buildPreferenceMatrixView([], "oversight"));

  assert.equal(church.enabled, false);
  assert.equal(oversight.enabled, true);
  assert.equal(oversight.source, "default");

  // Stated as the invariant rather than as two literals: every cell of the
  // rendered matrix agrees with what the read path would answer for that
  // audience, for both audiences and every pair.
  for (const audience of ["church", "oversight"] as const) {
    for (const row of buildPreferenceMatrixView([], audience).categories) {
      for (const cell of row.cells) {
        assert.equal(
          cell.enabled,
          defaultChannelEnabled(cell.category, cell.channel, audience),
          `${audience} ${cell.key}`
        );
      }
    }
  }
});

test("an oversight admin switching their in-app digest OFF is not a no-op", () => {
  // The write side of the same divergence, and the more damaging half: with the
  // church defaults the answer to "is it already off?" was YES, so the action
  // returned success, wrote nothing, and the digest kept appearing in the feed
  // the admin had just told it to leave.
  assert.equal(
    preferenceWriteIsNoop([], "digest", "in_app", false, "oversight"),
    false
  );
  assert.equal(
    preferenceWriteIsNoop([], "digest", "in_app", true, "oversight"),
    true
  );

  // And the church audience keeps exactly today's answers.
  assert.equal(preferenceWriteIsNoop([], "digest", "in_app", false), true);
  assert.equal(preferenceWriteIsNoop([], "digest", "in_app", true), false);
});

// ----------------------------------------------------------------------------
// Changing only the cadence must not pin the user to today's defaults (#237)
// ----------------------------------------------------------------------------

/**
 * The row a cadence-only save actually creates.
 *
 * Built from `setDigestCadenceQuery`'s own inputs rather than hand-written, so
 * it cannot drift from what the write path inserts: the channel it writes to,
 * the coded default it has to supply for the NOT NULL `enabled` column, and the
 * `incidental` stamp that says nobody picked it.
 */
function cadenceOnlyRow(cadence: (typeof digestCadences)[number]) {
  return makeRow({
    category: "digest",
    channel: DIGEST_CADENCE_CHANNEL,
    enabled: defaultChannelEnabled("digest", DIGEST_CADENCE_CHANNEL),
    intent: "incidental",
    digestCadence: cadence,
  });
}

test("a cadence-only save leaves the (digest, email) cell attributed default", () => {
  // The defect: the row the cadence write has to create was read back as an
  // EXPLICIT preference, so a user who touched nothing but the dropdown left
  // with a recorded choice about whether their digest email is on at all.
  const rows = [cadenceOnlyRow("daily")];

  const resolved = resolvePreference(rows, "digest", DIGEST_CADENCE_CHANNEL);

  assert.equal(resolved.source, "default");
  assert.equal(
    resolved.enabled,
    defaultChannelEnabled("digest", DIGEST_CADENCE_CHANNEL)
  );

  // And the screen agrees — `data-source` is read straight off this cell.
  const cell = buildPreferenceMatrixView(rows)
    .categories.find((row) => row.category === "digest")!
    .cells.find((c) => c.channel === DIGEST_CADENCE_CHANNEL)!;

  assert.equal(cell.source, "default");
});

test("the cadence itself still persists and is still honoured", () => {
  // The other half: inheritable is about `enabled`, never about the cadence.
  // A fix that dropped the cadence with the choice would be no fix at all.
  const rows = [cadenceOnlyRow("daily")];

  assert.notEqual("daily", DEFAULT_DIGEST_CADENCE);
  assert.equal(resolveDigestCadence(rows), "daily");
  assert.equal(
    resolvePreference(rows, "digest", DIGEST_CADENCE_CHANNEL).digestCadence,
    "daily"
  );
  assert.equal(cadenceChoice(buildPreferenceMatrixView(rows)).cadence, "daily");

  // Re-selecting it is then a no-op, so a reload followed by a re-save writes
  // nothing further.
  assert.equal(digestCadenceWriteIsNoop(rows, "daily"), true);
});

test("a cadence-only row does not pin EITHER audience's defaults", () => {
  // The N-019 guarantee stated as the property it protects: whichever coded
  // default a user's tenancy turns out to select, the row a cadence save left
  // behind is still inheritable, so the new default reaches them.
  const rows = [cadenceOnlyRow("daily")];

  for (const audience of ["church", "oversight"] as const) {
    const resolved = resolvePreference(
      rows,
      "digest",
      DIGEST_CADENCE_CHANNEL,
      audience
    );

    assert.equal(resolved.source, "default", audience);
    assert.equal(
      resolved.enabled,
      defaultChannelEnabled("digest", DIGEST_CADENCE_CHANNEL, audience),
      audience
    );
  }
});

test("no write materialises a row that only restates a default", () => {
  // The `preferenceWriteIsNoop` guarantee, over every pair and both audiences:
  // asking for the value you already have — by default or by an inheritable row
  // that agrees with it — writes nothing.
  for (const audience of ["church", "oversight"] as const) {
    for (const { category, channel } of notificationPreferenceMatrixKeys()) {
      const coded = defaultChannelEnabled(category, channel, audience);
      const label = `${audience} ${preferenceKey(category, channel)}`;

      assert.equal(
        preferenceWriteIsNoop([], category, channel, coded, audience),
        true,
        label
      );

      // Same answer once a row restating that default exists — so a
      // double-submit, or a cadence save that created one, cannot turn into a
      // second write that pins the value.
      const restating = [makeRow({ category, channel, enabled: coded })];
      assert.equal(
        preferenceWriteIsNoop(restating, category, channel, coded, audience),
        true,
        label
      );

      // And a real change is still a real change.
      assert.equal(
        preferenceWriteIsNoop(restating, category, channel, !coded, audience),
        false,
        label
      );
    }
  }
});

test("inheritable is decided against the CURRENT default, per audience", () => {
  // `digest`/`in_app` is the one pair whose coded default differs by audience
  // (N-027), which makes it the one place the rule is observable: the same
  // stored `true` says nothing to an oversight reader and is a deliberate
  // opt-in for the plant's team.
  assert.equal(
    preferenceValueIsInheritable(
      "digest",
      "in_app",
      true,
      "incidental",
      "oversight"
    ),
    true
  );
  assert.equal(
    preferenceValueIsInheritable(
      "digest",
      "in_app",
      true,
      "incidental",
      "church"
    ),
    false
  );

  const optIn = [
    makeRow({ category: "digest", channel: "in_app", enabled: true }),
  ];

  assert.equal(resolvePreference(optIn, "digest", "in_app").source, "explicit");
  assert.equal(
    resolvePreference(optIn, "digest", "in_app", "oversight").source,
    "default"
  );
});

// ----------------------------------------------------------------------------
// Inheritable vs explicit is decided from the row's own stamp
// ----------------------------------------------------------------------------

test("a CHOSEN row is a choice even when it agrees with the default", () => {
  // The case the stamp exists for: the unsubscribe undo writes a value that
  // happens to equal the coded default, and that write is still the reader's
  // own decision about their consent. Asserted over EVERY pair, both audiences,
  // so a seventh category is covered on the day it is added — and so the rule
  // cannot quietly acquire a channel or a category it does not apply to.
  for (const audience of ["church", "oversight"] as const) {
    for (const { category, channel } of notificationPreferenceMatrixKeys()) {
      const coded = defaultChannelEnabled(category, channel, audience);
      const rows = [
        makeRow({ category, channel, enabled: coded, intent: "chosen" }),
      ];
      const resolved = resolvePreference(rows, category, channel, audience);
      const label = `${audience} ${preferenceKey(category, channel)}`;

      assert.equal(
        preferenceValueIsInheritable(
          category,
          channel,
          coded,
          "chosen",
          audience
        ),
        false,
        label
      );
      assert.equal(resolved.source, "explicit", label);
      // The VALUE is unchanged — only the attribution, and with it what a later
      // change to the default can do to this reader.
      assert.equal(resolved.enabled, coded, label);
    }
  }
});

test("an INCIDENTAL row that agrees stays inheritable, on every pair", () => {
  // The other half, and the one that keeps the value-equality rule alive: a row
  // whose value was written to carry something else says nothing, so the coded
  // default still reaches its owner. Derived from the matrix, so a third
  // channel is held to the same rule by default rather than by an edit here.
  for (const audience of ["church", "oversight"] as const) {
    for (const { category, channel } of notificationPreferenceMatrixKeys()) {
      const coded = defaultChannelEnabled(category, channel, audience);
      const rows = [
        makeRow({ category, channel, enabled: coded, intent: "incidental" }),
      ];
      const label = `${audience} ${preferenceKey(category, channel)}`;

      assert.equal(
        preferenceValueIsInheritable(
          category,
          channel,
          coded,
          "incidental",
          audience
        ),
        true,
        label
      );
      assert.equal(
        resolvePreference(rows, category, channel, audience).source,
        "default",
        label
      );
    }
  }
});

test("the stamp, not the channel, is what the two answers differ on", () => {
  // The property this unit is for, stated as the one comparison that proves it:
  // two rows on the SAME (category, channel) cell, both carrying the coded
  // default, resolve differently — and the only thing that differs is why each
  // row exists. Asserted on every pair, so no cell keeps a channel rule of its
  // own; the pair the old carve-out named is in here with the rest.
  for (const { category, channel } of notificationPreferenceMatrixKeys()) {
    const coded = defaultChannelEnabled(category, channel);
    const label = preferenceKey(category, channel);

    const chosen = resolvePreference(
      [makeRow({ category, channel, enabled: coded, intent: "chosen" })],
      category,
      channel
    );
    const incidental = resolvePreference(
      [makeRow({ category, channel, enabled: coded, intent: "incidental" })],
      category,
      channel
    );

    assert.equal(chosen.source, "explicit", label);
    assert.equal(incidental.source, "default", label);
    assert.equal(chosen.enabled, incidental.enabled, label);
  }
});

test("the stamp changes no VALUE, so no write becomes a non-no-op", () => {
  // `preferenceWriteIsNoop` asks about the resolved value, never about its
  // attribution. If the stamp had moved a value, a screen that saves what it
  // rendered would start materialising rows again — the defect the
  // value-equality rule closed.
  for (const audience of ["church", "oversight"] as const) {
    for (const intent of preferenceIntents) {
      for (const { category, channel } of notificationPreferenceMatrixKeys()) {
        const coded = defaultChannelEnabled(category, channel, audience);
        const rows = [makeRow({ category, channel, enabled: coded, intent })];
        const label = `${audience} ${intent} ${preferenceKey(category, channel)}`;

        assert.equal(
          resolvePreference(rows, category, channel, audience).enabled,
          coded,
          label
        );
        assert.equal(
          preferenceWriteIsNoop(rows, category, channel, coded, audience),
          true,
          label
        );
      }
    }
  }
});

test("the settings toggle stamps a choice and the cadence save does not", () => {
  // The two write paths, read off the SQL they actually issue. The stamp is
  // never request input, so this is the only place it is decided — and the
  // cadence save must leave an existing stamp alone on the update, exactly as
  // it leaves `enabled` alone, or changing a cadence would demote a deliberate
  // choice to a by-product.
  const toggle = setPreferenceQuery(OWNER, {
    category: "digest",
    channel: DIGEST_CADENCE_CHANNEL,
    enabled: true,
  }).toSQL();

  assert.ok(toggle.params.includes("chosen"), String(toggle.params));
  assert.ok(updateClause(toggle.sql).includes("intent"), toggle.sql);

  const cadence = setDigestCadenceQuery(OWNER, "daily").toSQL();

  assert.ok(cadence.params.includes("incidental"), String(cadence.params));
  assert.ok(!cadence.params.includes("chosen"), String(cadence.params));
  assert.ok(!updateClause(cadence.sql).includes("intent"), cadence.sql);
});

test("a stamp is never something a caller can send", () => {
  // A preference write is reachable as a POST with no UI, so a stamp the
  // request could name would let a by-product claim to be a decision — the
  // whole point of storing it. The schema is the boundary and it has no such
  // key; `z.object` strips it rather than storing it.
  const parsed = setPreferenceSchema.parse({
    category: "tasks",
    channel: "email",
    enabled: true,
    intent: "chosen",
  });

  assert.ok(!("intent" in parsed));
});

test("a stored value that DIFFERS from the default is still a choice", () => {
  // The rule may not be allowed to swallow an opt-out. Asserted over every pair
  // rather than a sample, so no future default change can make one of them
  // inheritable by accident.
  for (const audience of ["church", "oversight"] as const) {
    for (const { category, channel } of notificationPreferenceMatrixKeys()) {
      const coded = defaultChannelEnabled(category, channel, audience);
      const rows = [makeRow({ category, channel, enabled: !coded })];
      const resolved = resolvePreference(rows, category, channel, audience);

      assert.equal(
        resolved.source,
        "explicit",
        `${audience} ${preferenceKey(category, channel)}`
      );
      assert.equal(resolved.enabled, !coded);
    }
  }
});

// ----------------------------------------------------------------------------
// The cadence control an oversight recipient cannot use is not offered (#254)
// ----------------------------------------------------------------------------

test("oversight readers are given an explanation, not a cadence selector", () => {
  // Both oversight org kinds, and driven through `audienceForTenancy` rather
  // than a hardcoded audience, so the divergence is asserted at the same seam
  // `/settings` builds the view through.
  for (const [who, fields] of OVERSIGHT_TENANCIES) {
    const view = buildPreferenceMatrixView([], audienceForTenancy(fields));

    assert.equal(view.digest.kind, "fixed", who);
    assert.equal(view.digest.category, "digest", who);
    assert.ok(!("options" in view.digest), who);
    assert.ok(!("cadence" in view.digest), who);
  }
});

test("the church readers' cadence selector is unchanged", () => {
  // The plant's control is the one this must not touch. A coach rides the same
  // audience and is asserted with it.
  for (const [who, fields] of CHURCH_TENANCIES) {
    const digest = cadenceChoice(
      buildPreferenceMatrixView([], audienceForTenancy(fields))
    );

    assert.equal(digest.kind, "choice", who);
    assert.equal(digest.cadence, DEFAULT_DIGEST_CADENCE, who);
    assert.deepEqual(
      digest.options.map((option) => option.value),
      [...digestCadences],
      who
    );
  }
});

test("the oversight note says what decides the timing, and offers nothing", () => {
  // better-writing: removing a control with no explanation reads as a missing
  // feature. The note has to answer the question the selector used to answer.
  const view = buildPreferenceMatrixView([], "oversight");
  assert.ok(view.digest.kind === "fixed");

  assert.equal(view.digest.description, OVERSIGHT_DIGEST_CADENCE_NOTE);
  assert.ok(OVERSIGHT_DIGEST_CADENCE_NOTE.endsWith("."));
  assert.match(OVERSIGHT_DIGEST_CADENCE_NOTE, /once a day/i);
  assert.match(OVERSIGHT_DIGEST_CADENCE_NOTE, /fixed/i);

  // It must not imply a choice that does not exist, and must not leak internal
  // vocabulary the way a requirement id or a category slug would.
  for (const forbidden of [
    /\bchoose\b/i,
    /how often would/i,
    /\bN-\d{3}\b/,
    /in_app/,
    /\bcadence\b/i,
  ]) {
    assert.doesNotMatch(
      OVERSIGHT_DIGEST_CADENCE_NOTE,
      forbidden,
      OVERSIGHT_DIGEST_CADENCE_NOTE
    );
  }
});

// ----------------------------------------------------------------------------
// A save that fails has to say so (#236)
// ----------------------------------------------------------------------------

test("an expired session becomes a message, not a throw", () => {
  // The realistic case the AC names: a settings tab left open long enough for
  // the session to go. `preferenceOwnerFromSession` throws, and before this the
  // throw rejected the action's promise — the client's `toast.error` was never
  // reached and the switch just snapped back.
  let thrown: unknown;
  try {
    preferenceOwnerFromSession(null);
  } catch (error) {
    thrown = error;
  }

  assert.ok(thrown instanceof UnauthenticatedPreferenceAccessError);
  assert.equal(isUnauthenticatedPreferenceError(thrown), true);

  const result = preferenceSaveFailure(thrown);
  assert.equal(result.success, false);
  assert.equal(result.error, PREFERENCE_SESSION_EXPIRED_MESSAGE);
});

test("verifySession's own Unauthorized is the same case to the user", () => {
  // THE ACTUAL THROWN OBJECT, not a hand-built stand-in for it (#508):
  // `verifySession()` throws `UnauthorizedError`, so this is the value the
  // mapping really receives.
  assert.equal(isUnauthenticatedPreferenceError(new UnauthorizedError()), true);
  assert.equal(
    preferenceSaveFailure(new UnauthorizedError()).error,
    PREFERENCE_SESSION_EXPIRED_MESSAGE
  );

  // A bare Error carrying the same message is the same fact to the user, and
  // the mapping matches on the MESSAGE, so it must still be.
  assert.equal(
    isUnauthenticatedPreferenceError(new Error(UNAUTHORIZED_MESSAGE)),
    true
  );

  // There is no longer a source-text pin here, because there is no longer a
  // second copy of the string to pin: this module imports the constant from
  // `@/lib/auth/unauthorized`, where the throw is built. A test that read
  // `session.ts` as text and matched `throw new Error("Unauthorized")` failed
  // on the day the throw became a subclass carrying the same message — a pin
  // reporting on a spelling rather than on the property.
});

test("any other failure still surfaces something, and leaks nothing", () => {
  // A database that is down is the other half of the AC. The user gets a
  // sentence they can act on; the driver's text stays in the server log, where
  // it cannot put a table name in a toast.
  const dbError = new Error(
    'relation "notification_preferences" does not exist'
  );

  assert.equal(isUnauthenticatedPreferenceError(dbError), false);

  const result = preferenceSaveFailure(dbError);
  assert.equal(result.success, false);
  assert.equal(result.error, PREFERENCE_SAVE_FAILED_MESSAGE);
  assert.doesNotMatch(result.error, /notification_preferences/);

  // Non-Error throws resolve too — a rejected promise carrying a string would
  // otherwise reach the `instanceof` checks and fall through to nothing.
  assert.equal(
    preferenceSaveFailure("boom").error,
    PREFERENCE_SAVE_FAILED_MESSAGE
  );
  assert.equal(
    preferenceSaveFailure(undefined).error,
    PREFERENCE_SAVE_FAILED_MESSAGE
  );
});

test("both failure messages tell the user what to do next", () => {
  for (const message of [
    PREFERENCE_SESSION_EXPIRED_MESSAGE,
    PREFERENCE_SAVE_FAILED_MESSAGE,
  ]) {
    assert.ok(message.length > 0);
    assert.ok(message.endsWith("."), message);
    assert.doesNotMatch(message, /\bError\b|\bnull\b|undefined/, message);
  }
});

// ----------------------------------------------------------------------------
// Rows this reader is never served (ruled 2026-08-09, extending #254)
//
// The view model carries the FACT — `eligible` per row, and one note for the
// screen — and says nothing about what a screen should do with it. These tests
// pin the fact for both audiences and both oversight org kinds, and pin that a
// plant reader's screen is untouched.
// ----------------------------------------------------------------------------

test("a church reader's rows are all eligible, and there is no note", () => {
  const view = buildPreferenceMatrixView([], "church");

  assert.equal(
    view.categories.every((row) => row.eligible),
    true
  );
  assert.equal(view.ineligibleNote, null);

  // The default audience is the church one, so a caller that does not know the
  // reader's tenancy still gets today's screen — the same promise
  // `defaultChannelEnabled` makes about its own audience parameter.
  assert.deepEqual(
    buildPreferenceMatrixView([]).categories.map((row) => row.eligible),
    view.categories.map((row) => row.eligible)
  );
});

test("an oversight reader's rows are eligible exactly where the allow-list says", () => {
  const view = buildPreferenceMatrixView([], "oversight");

  const eligible = view.categories
    .filter((row) => row.eligible)
    .map((row) => row.category);
  const ineligible = view.categories
    .filter((row) => !row.eligible)
    .map((row) => row.category);

  assert.deepEqual(eligible, [...OVERSIGHT_ELIGIBLE_CATEGORIES]);
  assert.deepEqual(ineligible, ineligibleCategoriesForAudience("oversight"));
  assert.equal(view.ineligibleNote, OVERSIGHT_INELIGIBLE_CATEGORY_NOTE);
});

test("both oversight org kinds produce the same ineligible rows", () => {
  // `audienceForTenancy` collapses a sending church's account and a network's
  // account onto one audience, so that seam — not the browser — is where the
  // two are proved to agree. The dev seed has no sending-church account.
  const rowsFor = (fields: TenancyFields) =>
    buildPreferenceMatrixView([], audienceForTenancy(fields)).categories.map(
      (row) => [row.category, row.eligible] as const
    );

  const [[, sendingChurch], [, network]] = OVERSIGHT_TENANCIES;
  assert.deepEqual(rowsFor(sendingChurch), rowsFor(network));
  assert.notDeepEqual(
    rowsFor(network),
    rowsFor(tenancy({ churchId: "church-1" }))
  );

  for (const [who, fields] of CHURCH_TENANCIES) {
    assert.deepEqual(
      rowsFor(fields).filter(([, eligible]) => !eligible),
      [],
      `${who} lost a row they are served`
    );
  }
});

test("the rows themselves are unchanged — only the flag is new", () => {
  // The ruling is about what is OFFERED, not about what is resolved. An
  // ineligible row still carries its resolved cells, so ruling for "hide" and
  // ruling for "disable" both read the same view model, and neither changes
  // what `dispatch` or the feed would compute for the same user.
  const view = buildPreferenceMatrixView([], "oversight");

  for (const row of view.categories) {
    assert.equal(row.cells.length, notificationChannels.length, row.category);
    for (const cell of row.cells) {
      assert.equal(
        cell.enabled,
        defaultChannelEnabled(row.category, cell.channel, "oversight"),
        `${cell.key} stopped resolving against the oversight defaults`
      );
      assert.equal(cell.source, "default");
    }
  }
});

test("the note explains without naming a role or a permission", () => {
  // It is the reader's sentence, not the system's. "Your role", "permission",
  // "eligible" and "not available" are all words about the mechanism; the
  // reader's question is who these updates are for.
  const note = OVERSIGHT_INELIGIBLE_CATEGORY_NOTE;

  for (const jargon of [
    /role/i,
    /permission/i,
    /eligib/i,
    /unavailable/i,
    /oversight/i,
  ]) {
    assert.doesNotMatch(note, jargon, String(jargon));
  }

  // And it says what DOES arrive, so the reader learns the product rather than
  // an absence. Both eligible categories are named in plain words.
  assert.match(note, /milestone/i);
  assert.match(note, /summary/i);
  assert.equal(note.trim().endsWith("."), true);
});
