import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import {
  digestCadences,
  notificationCategories,
  notificationChannels,
  notificationPreferences,
  type DigestCadence,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationPreference,
  type User,
} from "@/db/schema";

import {
  DEFAULT_DIGEST_CADENCE,
  defaultChannelEnabled,
  notificationPreferenceMatrixKeys,
} from "./categories";

// ============================================================================
// Preference resolution (N-005).
//
// The rule this file exists to enforce: an ABSENT row means the category's
// coded default, not "off". Nothing is ever seeded, so a category added in a
// later deploy works for every existing user with no backfill, and a user who
// has never opened the settings screen has no rows at all.
//
// Resolution is pure (`resolvePreference`, `buildPreferenceMap`) so the
// dispatcher can load a user's rows once and answer many questions from them
// without a query per channel.
//
// ----------------------------------------------------------------------------
// Whose preferences? — `PreferenceOwner`, and why it is not a `string`
// ----------------------------------------------------------------------------
//
// A preference row is a CONSENT record, and every entrypoint here — read and
// write alike — is addressed by user id. A bare `userId: string` parameter puts
// no distance at all between "the logged-in user" and "a uuid that arrived in a
// query string": anyone holding or guessing another user's id could read their
// consent records and flip them in either direction (silently re-enabling a
// deliberate opt-out is as damaging as disabling one). A uuid parse is a FORMAT
// check and nothing more; it cannot tell those two apart.
//
// So ownership is a TYPE here, exactly as `NotificationScope` is in queries.ts:
// `PreferenceOwner` is branded and cannot be constructed by a caller. The only
// way to mint one is `preferenceOwnerFromSession(session)`, which takes an
// already-verified session and throws when there is none — so the failure mode
// is a compile error at the call site, not a missing runtime check.
//
// NO UNAUTHENTICATED CALLER IS SUPPORTED YET. The logged-out email-footer
// unsubscribe (N-007) needs a signed token — an HMAC over (user_id, category,
// channel, expiry), verified server-side — and that token does not exist in
// this unit. When it lands it gets its OWN minting function
// (`preferenceOwnerFromUnsubscribeToken`) beside this one, and it is the
// verification inside that function, not a comment, that earns the brand. Until
// then, an unsubscribe link that passes a raw user id is not something this
// module will accept, and that is deliberate.
// ============================================================================

// ----------------------------------------------------------------------------
// Validation
// ----------------------------------------------------------------------------

export const setPreferenceSchema = z.object({
  category: z.enum(notificationCategories),
  channel: z.enum(notificationChannels),
  enabled: z.boolean(),
  /** Only meaningful on the `digest` category; ignored elsewhere. */
  digestCadence: z.enum(digestCadences).optional(),
});

export type SetPreferenceInput = z.infer<typeof setPreferenceSchema>;

// ----------------------------------------------------------------------------
// Ownership
// ----------------------------------------------------------------------------

declare const preferenceOwnerBrand: unique symbol;

/**
 * A user id that has been PROVEN to be the caller's own.
 *
 * Structurally a string, but nominally distinct: no assignment, cast-free
 * construction or `z.string().uuid()` parse produces one. `string` is not
 * assignable to it, so a route that reaches for `searchParams.get("user")` does
 * not compile — which is the entire point, and the same technique
 * `NotificationScope` uses in queries.ts.
 */
export type PreferenceOwner = string & {
  readonly [preferenceOwnerBrand]: true;
};

/** Thrown when a preference read or write is attempted with no session. */
export class UnauthenticatedPreferenceAccessError extends Error {
  constructor() {
    super(
      "notification preferences: no authenticated session — a preference is a consent record and is only ever addressed to the session's own user"
    );
    this.name = "UnauthenticatedPreferenceAccessError";
  }
}

/**
 * Format check on a minted owner. Kept because it is cheap and catches a
 * malformed id before it reaches Postgres — but note what it is NOT: it says
 * nothing about ownership. `PreferenceOwner` does that, and only the minting
 * functions below can produce one.
 */
export const preferenceUserIdSchema = z.string().uuid();

/**
 * The one supported way to obtain a `PreferenceOwner`: from a session that
 * `src/lib/auth/session.ts` has already validated.
 *
 * Takes the resolved session rather than reading the cookie itself, so this
 * module stays free of `next/headers` and remains directly testable — and so
 * the caller cannot skip validation without it being visible at the call site.
 *
 * @throws UnauthenticatedPreferenceAccessError when there is no session.
 */
export function preferenceOwnerFromSession(
  session: { user: Pick<User, "id"> } | null | undefined
): PreferenceOwner {
  if (!session?.user?.id) {
    throw new UnauthenticatedPreferenceAccessError();
  }
  return preferenceUserIdSchema.parse(session.user.id) as PreferenceOwner;
}

// ----------------------------------------------------------------------------
// Pure resolution
// ----------------------------------------------------------------------------

/** Where a resolved value came from — surfaced by the settings screen. */
export type PreferenceSource = "explicit" | "default";

export interface ResolvedPreference {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
  source: PreferenceSource;
  /** Resolved cadence; null on every category except `digest`. */
  digestCadence: DigestCadence | null;
}

/** Stable key for the (category, channel) pair. */
export function preferenceKey(
  category: NotificationCategory,
  channel: NotificationChannel
): string {
  return `${category}:${channel}`;
}

/** Index a user's stored rows for O(1) lookup during resolution. */
export function buildPreferenceMap(
  rows: readonly NotificationPreference[]
): Map<string, NotificationPreference> {
  const map = new Map<string, NotificationPreference>();
  for (const row of rows) {
    map.set(preferenceKey(row.category, row.channel), row);
  }
  return map;
}

/**
 * Resolve one (category, channel) against a user's stored rows.
 *
 * - row present  → its `enabled`, marked `explicit` (true AND false alike; a
 *                  stored `false` is a deliberate opt-out and must not be
 *                  re-defaulted back on).
 * - row absent   → the category's coded default, marked `default`.
 *
 * `rows` is whatever `loadUserPreferences` returned, or a pre-built map when
 * resolving many pairs for the same user.
 */
export function resolvePreference(
  rows: readonly NotificationPreference[] | Map<string, NotificationPreference>,
  category: NotificationCategory,
  channel: NotificationChannel
): ResolvedPreference {
  const map = rows instanceof Map ? rows : buildPreferenceMap(rows);
  const row = map.get(preferenceKey(category, channel));

  if (!row) {
    return {
      category,
      channel,
      enabled: defaultChannelEnabled(category, channel),
      source: "default",
      digestCadence: category === "digest" ? DEFAULT_DIGEST_CADENCE : null,
    };
  }

  return {
    category,
    channel,
    enabled: row.enabled,
    source: "explicit",
    digestCadence:
      category === "digest"
        ? (row.digestCadence ?? DEFAULT_DIGEST_CADENCE)
        : null,
  };
}

/** Convenience for the dispatcher: is this channel on for this category? */
export function isChannelEnabled(
  rows: readonly NotificationPreference[] | Map<string, NotificationPreference>,
  category: NotificationCategory,
  channel: NotificationChannel
): boolean {
  return resolvePreference(rows, category, channel).enabled;
}

/**
 * The full category × channel matrix the preferences screen renders (N-006),
 * with every cell resolved and its source attributed.
 */
export function resolvePreferenceMatrix(
  rows: readonly NotificationPreference[]
): ResolvedPreference[] {
  const map = buildPreferenceMap(rows);
  return notificationPreferenceMatrixKeys().map(({ category, channel }) =>
    resolvePreference(map, category, channel)
  );
}

/**
 * The categories this user still wants IN THE APP — the allow-list the feed and
 * the unread badge are filtered by (N-005 at read time, ruled 2026-07-27).
 *
 * A preference is honoured when the notification is READ, not only when it is
 * dispatched. Dispatch already skips a suppressed channel, but a preference
 * turned off after the row was written would otherwise leave that row sitting
 * in the feed and counted by the badge forever.
 *
 * It resolves through `isChannelEnabled`, so absence is the coded default here
 * exactly as it is everywhere else — including `digest`/`in_app`, whose default
 * is off because an in-app digest row would duplicate the feed it summarises.
 * Nothing about the defaults is restated in this function; that is the point.
 *
 * The result can legitimately be EMPTY (a user who turned every category off),
 * and callers must treat that as "nothing is visible" rather than as "no
 * filter" — see `feedVisibility` in ./queries.
 */
export function resolveInAppCategories(
  rows: readonly NotificationPreference[]
): NotificationCategory[] {
  const map = buildPreferenceMap(rows);
  return notificationCategories.filter((category) =>
    isChannelEnabled(map, category, "in_app")
  );
}

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------

/**
 * Load the OWNER's explicit preference rows. Preferences are per user, not per
 * church — a coach across two churches keeps one set of choices — so this read
 * takes no `churchId`, unlike every notification read path. `PreferenceOwner`
 * is what replaces that missing tenancy argument: the boundary here is the
 * user, and it is a type rather than a convention.
 */
export async function loadUserPreferences(
  owner: PreferenceOwner
): Promise<NotificationPreference[]> {
  return db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, owner));
}

/** The resolved matrix for the owner, straight from storage. */
export async function getPreferenceMatrix(
  owner: PreferenceOwner
): Promise<ResolvedPreference[]> {
  return resolvePreferenceMatrix(await loadUserPreferences(owner));
}

/** The owner's in-app allow-list, straight from storage. */
export async function getInAppCategories(
  owner: PreferenceOwner
): Promise<NotificationCategory[]> {
  return resolveInAppCategories(await loadUserPreferences(owner));
}

/**
 * The write for one preference, as a builder — exported so the statement it
 * produces can be asserted with `.toSQL()` without a live Postgres.
 *
 * It upserts on the (user_id, category, channel) unique
 * index — so writing the same pair twice UPDATES rather than duplicating. The
 * database, not a read-then-write in application code, is what guarantees that
 * (see memory/invariants.md → Atomicity).
 *
 * `digestCadence` is only stored on the `digest` category; passing it elsewhere
 * is ignored rather than rejected, so a settings form can send the whole row.
 *
 * Three things this function is careful about:
 *
 * 1. It writes for a `PreferenceOwner`, never a bare id. See the module header:
 *    a preference is a consent record, so whose it is has to be a type.
 * 2. It PARSES. `setPreferenceSchema` is the boundary, and it is applied here
 *    rather than trusted to a caller — the columns are plain `varchar` with a
 *    compile-time brand, and a preference stored under a category the code does
 *    not define is never found by resolution, so an opt-out written that way is
 *    silently ignored forever.
 * 3. It does not clobber a cadence the caller did not send. A checkbox-only
 *    toggle submits `enabled` and nothing else; writing `digest_cadence = NULL`
 *    there would quietly reset a user's stored `daily` back to the `weekly`
 *    default. `digest_cadence` is therefore left out of the update entirely
 *    unless a cadence was actually supplied.
 */
export function setPreferenceQuery(
  owner: PreferenceOwner,
  input: SetPreferenceInput
) {
  const ownerId = preferenceUserIdSchema.parse(owner);
  const parsed = setPreferenceSchema.parse(input);

  const suppliedCadence =
    parsed.category === "digest" ? (parsed.digestCadence ?? null) : null;

  const set: {
    enabled: boolean;
    updatedAt: Date;
    digestCadence?: DigestCadence;
  } = {
    enabled: parsed.enabled,
    updatedAt: new Date(),
  };

  // Present only when the caller actually chose one — an absent key leaves the
  // stored value alone, which is the whole point.
  if (suppliedCadence !== null) {
    set.digestCadence = suppliedCadence;
  }

  return db
    .insert(notificationPreferences)
    .values({
      userId: ownerId,
      category: parsed.category,
      channel: parsed.channel,
      enabled: parsed.enabled,
      digestCadence: suppliedCadence,
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.category,
        notificationPreferences.channel,
      ],
      set,
    })
    .returning();
}

/** Write one preference. See `setPreferenceQuery` for what it does and why. */
export async function setPreference(
  owner: PreferenceOwner,
  input: SetPreferenceInput
): Promise<NotificationPreference> {
  const [row] = await setPreferenceQuery(owner, input);
  return row;
}
