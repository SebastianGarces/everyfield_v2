import {
  digestCadences,
  notificationCategories,
  notificationChannels,
  notificationEntityTypes,
  type DigestCadence,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationEntityType,
} from "@/db/schema";
import type { PrivacyFeatureKey } from "@/lib/auth/access";

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
  notificationEntityTypes,
  type DigestCadence,
  type NotificationCategory,
  type NotificationChannel,
  type NotificationEntityType,
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
 * Role-aware defaults are N-019 (Should Have) and still unbuilt. The values
 * below are the CHURCH-level defaults; when N-019 lands, only they change —
 * the resolver, the schema and every caller stay put, because nothing is
 * seeded into the database.
 *
 * An oversight user reaches these defaults only after passing the privacy
 * gate, which is a separate and stricter question — see
 * `oversightPrivacyFeature` below and `recipientMayBeNotified` in `enqueue.ts`.
 * FRD Open Question #3 is ruled: oversight eligibility is opt-in per church
 * and defaults to off, so an oversight user's effective default is "nothing"
 * until their plant turns a toggle on, whatever this table says.
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
// What an oversight recipient's church must be sharing for this category
// ----------------------------------------------------------------------------

/**
 * The privacy toggle that governs whether an OVERSIGHT user
 * (`sending_church_admin`, `network_admin`) may be told about this category.
 *
 * memory/invariants.md → Hierarchical Access Control: oversight users see
 * aggregate metrics only, and `canAccessFeatureData(user, churchId, feature)`
 * gates every feature read against `church_privacy_settings` (default: all
 * false / opt-in). A notification `body` is arbitrary feature copy — "No
 * contact in 30 days: Jane Doe", a giving figure, a message that failed — so
 * enqueue is a feature read wearing a different hat, and it inherits the same
 * gate. `canAccessChurch` alone is not that gate: it returns true for a network
 * admin on every plant in the network, regardless of any toggle.
 *
 * EVERY category maps to a toggle. `phase` and `digest` used to map to `null`
 * — a categorical refusal — and FRD Open Question #3 has since been ruled the
 * other way: oversight roles ARE eligible for both, gated by the church's
 * privacy settings and DEFAULT OFF (`share_phase`, `share_digest`, added by
 * migration 0026, both `default false`). Eligibility is the church's to grant,
 * not the code's to withhold, and because the columns default to false an
 * existing church sees no change in behaviour until it opts in.
 *
 * Two notes on `digest` specifically. It gets its OWN toggle rather than being
 * inferred from the other five: a digest is its own recurring contact, and a
 * church that shares its task list has not thereby asked for a weekly email
 * about itself to leave the building. And that toggle governs ELIGIBILITY
 * only — whatever assembles the digest's contents (N-013) still has to gate
 * each line against that line's own feature toggle, because `share_digest`
 * says "you may receive a digest", not "you may see everything in one".
 *
 * The `| null` arm is kept in the type: a category added later with no ruling
 * yet should be able to say so explicitly and fail closed, rather than being
 * pointed at whichever existing toggle looked closest.
 *
 * Church-level roles (planter, coach, team_member) are unaffected by any of
 * this — `canAccessFeatureData` returns true for them without consulting a
 * toggle at all.
 */
export const OVERSIGHT_PRIVACY_FEATURE: Record<
  NotificationCategory,
  PrivacyFeatureKey | null
> = {
  tasks: "tasks",
  meetings: "meetings",
  // Message content is about PEOPLE — recipients, contact details, failures.
  communication: "people",
  teams: "ministry_teams",
  phase: "phase",
  digest: "digest",
};

/** The privacy toggle governing this category, or null if none covers it. */
export function oversightPrivacyFeature(
  category: NotificationCategory
): PrivacyFeatureKey | null {
  return OVERSIGHT_PRIVACY_FEATURE[category] ?? null;
}

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
