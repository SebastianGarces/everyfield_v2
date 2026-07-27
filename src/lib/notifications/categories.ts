import {
  digestCadences,
  notificationCategories,
  notificationChannels,
  type DigestCadence,
  type NotificationCategory,
  type NotificationChannel,
} from "@/db/schema";

// ============================================================================
// The fixed, code-defined category set (N-005).
//
// The category is the unit of user preference. Everything a caller or a
// preference screen needs about a category lives here, so nothing outside this
// file has to know the set — and adding a category is a code change with a
// coded default, never a migration and never a backfill.
//
// The enum tuples themselves are declared in `src/db/schema/notifications.ts`
// (that is where every enum in this repo lives) and re-exported here so callers
// import categories from the notifications module, not from `@/db`.
// ============================================================================

export {
  digestCadences,
  notificationCategories,
  notificationChannels,
  type DigestCadence,
  type NotificationCategory,
  type NotificationChannel,
};

// ----------------------------------------------------------------------------
// Metadata — the preference screen's plain-language copy (N-006).
// ----------------------------------------------------------------------------

export interface NotificationCategoryDefinition {
  /** Short label for the preference matrix row. */
  label: string;
  /** What a user is actually turning off, in their words. */
  description: string;
  /**
   * The coded default per channel. An ABSENT preference row resolves to this —
   * absence means "default", never "off".
   */
  defaults: Record<NotificationChannel, boolean>;
}

/**
 * Defaults are opt-out (on), which is the position the FRD's user-visible
 * behaviour assumes ("I can turn off a whole category").
 *
 * The single exception is `digest` on `in_app`: the digest is a roll-up of
 * items the feed already lists one by one, so an in-app digest row would
 * duplicate the feed it summarises. The digest earns its keep in an inbox.
 *
 * Role-aware defaults are N-019 (Should Have) and whether oversight roles
 * should instead be opt-in is an explicitly unruled Open Question. When either
 * is ruled, only the `defaults` values below change — the resolver, the schema
 * and every caller stay put, because nothing is seeded into the database.
 */
export const NOTIFICATION_CATEGORIES: Record<
  NotificationCategory,
  NotificationCategoryDefinition
> = {
  tasks: {
    label: "Tasks",
    description: "Tasks due, overdue, or newly assigned to you.",
    defaults: { email: true, in_app: true },
  },
  meetings: {
    label: "Meetings",
    description: "Reminders before a meeting, and meetings newly scheduled.",
    defaults: { email: true, in_app: true },
  },
  communication: {
    label: "Messages",
    description: "Scheduled sends and delivery problems on messages you sent.",
    defaults: { email: true, in_app: true },
  },
  teams: {
    label: "Ministry teams",
    description: "Team health and training alerts for teams you lead.",
    defaults: { email: true, in_app: true },
  },
  phase: {
    label: "Plant intelligence",
    description: "New assessments and phase transitions for your plant.",
    defaults: { email: true, in_app: true },
  },
  digest: {
    label: "Digest",
    description: "A recurring roll-up of what needs your attention.",
    defaults: { email: true, in_app: false },
  },
};

/**
 * Default cadence for the `digest` category when no preference row exists.
 * Weekly is the FRD's assumption; the weekday it lands on is unruled and is a
 * dispatcher concern, not a data-model one.
 */
export const DEFAULT_DIGEST_CADENCE: DigestCadence = "weekly";

// ----------------------------------------------------------------------------
// Guards + lookups
// ----------------------------------------------------------------------------

export function isNotificationCategory(
  value: unknown
): value is NotificationCategory {
  return (
    typeof value === "string" &&
    (notificationCategories as readonly string[]).includes(value)
  );
}

export function isNotificationChannel(
  value: unknown
): value is NotificationChannel {
  return (
    typeof value === "string" &&
    (notificationChannels as readonly string[]).includes(value)
  );
}

export function isDigestCadence(value: unknown): value is DigestCadence {
  return (
    typeof value === "string" &&
    (digestCadences as readonly string[]).includes(value)
  );
}

/**
 * The coded default for one (category, channel) pair.
 *
 * An unrecognised category or channel — a row written by a newer deploy and
 * read by an older one, or one that reached the table without passing a parse —
 * resolves to DISABLED rather than throwing.
 *
 * That direction is deliberate. This function answers "should I send this?",
 * and the answer is a consent decision: defaulting an unknown input to "yes"
 * means the system's reflex when it does not understand something is to email
 * the user anyway. A category the running code has never heard of has no copy,
 * no preference row a user could ever have seen, and no label on the settings
 * screen — sending it is worse than dropping it, and the next deploy delivers
 * it correctly. Every category the code DOES define keeps its own default, so
 * this branch is unreachable in normal operation.
 */
export function defaultChannelEnabled(
  category: NotificationCategory,
  channel: NotificationChannel
): boolean {
  return NOTIFICATION_CATEGORIES[category]?.defaults[channel] ?? false;
}

/** Every (category, channel) pair, in a stable order for the settings matrix. */
export function notificationPreferenceMatrixKeys(): {
  category: NotificationCategory;
  channel: NotificationChannel;
}[] {
  return notificationCategories.flatMap((category) =>
    notificationChannels.map((channel) => ({ category, channel }))
  );
}
