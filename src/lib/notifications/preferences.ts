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

// ----------------------------------------------------------------------------
// Persistence
// ----------------------------------------------------------------------------

/**
 * Load a user's explicit preference rows. Preferences are per user, not per
 * church — a coach across two churches keeps one set of choices — so this read
 * takes no `churchId`, unlike every notification read path.
 */
export async function loadUserPreferences(
  userId: string
): Promise<NotificationPreference[]> {
  return db
    .select()
    .from(notificationPreferences)
    .where(eq(notificationPreferences.userId, userId));
}

/** The resolved matrix for a user, straight from storage. */
export async function getPreferenceMatrix(
  userId: string
): Promise<ResolvedPreference[]> {
  return resolvePreferenceMatrix(await loadUserPreferences(userId));
}

/**
 * Write one preference, upserting on the (user_id, category, channel) unique
 * index — so writing the same pair twice UPDATES rather than duplicating. The
 * database, not a read-then-write in application code, is what guarantees that
 * (see memory/invariants.md → Atomicity).
 *
 * `digestCadence` is only stored on the `digest` category; passing it elsewhere
 * is ignored rather than rejected, so a settings form can send the whole row.
 */
export async function setPreference(
  userId: string,
  input: SetPreferenceInput
): Promise<NotificationPreference> {
  const digestCadence =
    input.category === "digest" ? (input.digestCadence ?? null) : null;

  const [row] = await db
    .insert(notificationPreferences)
    .values({
      userId,
      category: input.category,
      channel: input.channel,
      enabled: input.enabled,
      digestCadence,
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.category,
        notificationPreferences.channel,
      ],
      set: {
        enabled: input.enabled,
        digestCadence,
        updatedAt: new Date(),
      },
    })
    .returning();

  return row;
}
