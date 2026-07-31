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
 * An oversight user reaches these defaults only after passing TWO stricter
 * questions, both asked in `recipientMayBeNotified` (`enqueue.ts`): is the
 * category oversight-eligible at all (`OVERSIGHT_ELIGIBLE_CATEGORIES` — only
 * `milestones` and `digest` are), and has the plant turned on
 * `share_activity_with_oversight`, which defaults to off. So an oversight
 * user's effective default is "nothing", whatever this table says, and four of
 * these six rows are unreachable for them however the plant decides.
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
  milestones: {
    label: "Milestones",
    description:
      "The few moments worth an interruption: an invitation accepted, a new stage, a launch date.",
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
// What an oversight recipient may be told (N-025 / N-026, ruled 2026-07-27)
// ----------------------------------------------------------------------------

/**
 * The ONLY categories an oversight recipient (`sending_church_admin`,
 * `network_admin`) is ever eligible for.
 *
 * The ruling: oversight receives a daily activity SUMMARY (`digest`, sent only
 * on a day that had activity) and three MILESTONES (`milestones` — planter
 * accepted an invitation, phase/stage advanced, launch date set or changed).
 * Everything else — the per-event stream a plant's own team lives in — is for
 * the plant. So the five granular categories are refused for an oversight
 * recipient outright: not "off by default", not "unless the plant shares
 * tasks", but never.
 *
 * This supersedes `OVERSIGHT_PRIVACY_FEATURE`, the per-category map shipped
 * with #130, in which each category pointed at its own `share_*` toggle. That
 * model let a plant that shared its task list hand an oversight admin a
 * verbatim copy of every task notification — item-level feature copy ("No
 * contact in 30 days: Jane Doe") arriving one row at a time, which is exactly
 * what memory/invariants.md → Hierarchical Access Control says oversight does
 * not get.
 *
 * Why an ALLOW-LIST of categories and not a rule about `type` strings: a rule
 * about types is a convention a future caller can forget. This is checked in
 * one place (`recipientMayBeNotified`) against a closed tuple, so a category
 * added tomorrow is refused for oversight until someone deliberately adds it
 * here.
 */
export const OVERSIGHT_ELIGIBLE_CATEGORIES = [
  "milestones",
  "digest",
] as const satisfies readonly NotificationCategory[];

/**
 * Is this category one an oversight recipient may receive AT ALL?
 *
 * Answered BEFORE the sharing toggle is read, and independently of it. A
 * granular category is refused with the plant's toggle on and with it off —
 * turning sharing on buys the digest and the milestones, never the per-event
 * stream.
 */
export function isOversightEligibleCategory(
  category: NotificationCategory
): boolean {
  return (OVERSIGHT_ELIGIBLE_CATEGORIES as readonly string[]).includes(
    category
  );
}

/**
 * The single privacy toggle gating everything oversight receives (N-026).
 *
 * One key, not a per-category lookup: with the category model gone there is
 * nothing left to vary. `church_privacy_settings.share_activity_with_oversight`
 * defaults to false, so a plant that has decided nothing shares nothing —
 * enqueue writes no row for an oversight recipient at all.
 *
 * Church-level roles (planter, coach, team_member) never reach this:
 * `canAccessFeatureData` returns true for them without consulting a toggle.
 */
export const OVERSIGHT_SHARING_FEATURE: PrivacyFeatureKey =
  "oversight_activity";

/**
 * The plant-side toggle's copy — the single source of truth for what the
 * setting screen says, so the promise the UI makes and the gate the code
 * enforces cannot drift apart.
 *
 * The copy is load-bearing, not decoration (N-026 names it as a requirement).
 * A planter deciding whether to share has to know the SHAPE of what leaves:
 * counts, not names; a summary once a day, not a live feed of everything that
 * happened. "Share activity" on its own reads like "let them watch me work",
 * which is both frightening and wrong.
 *
 * ----------------------------------------------------------------------------
 * The copy may only claim what this toggle actually governs
 * ----------------------------------------------------------------------------
 *
 * This toggle gates what is PUSHED: the digest and the three milestones, via
 * `enqueue`. It does not gate what oversight may PULL. `getOversightPlantHealth`
 * (`src/lib/phase-engine/oversight/read.ts`) already returns each accessible
 * plant's name, `currentPhase`, `daysUntilLaunch` and health classification to
 * any `sending_church_admin` / `network_admin` with no privacy gate at all —
 * that portfolio view is the oversight dashboard's whole reason to exist, and
 * the six `share_*` columns gate the FEATURE data inside it, not the listing.
 *
 * So an earlier draft of this screen ("they see nothing about this plant unless
 * you turn sharing on") was false the moment it shipped, and false about
 * precisely the two facts — current stage, launch date — the milestones below
 * mention. The fourth bullet exists to say that out loud. A consent control
 * whose promise overstates its own reach is worse than no promise: the planter
 * makes a decision about a guarantee the system does not offer.
 *
 * If a future ruling brings the portfolio's phase/launch exposure under this
 * toggle, that bullet comes out — and not before.
 */
export const OVERSIGHT_SHARING_TOGGLE = {
  label: "Share activity with your sending church or network",
  /** One line, for a switch's own description. */
  summary:
    "They get a once-a-day summary — how many meetings, people and tasks — plus a few milestones.",
  /**
   * The full explanation, as separate sentences so the screen can lay them out
   * however it likes without re-writing them.
   */
  detail: [
    "Once a day, on days something happened, they get counts: meetings held, people added, tasks finished, stages reached.",
    "They also hear about three milestones — you accept an invitation, you move to a new stage, you set or change a launch date.",
    "They never see names, notes, messages, giving, or a list of what you did. This is a summary, not an activity feed.",
    "One thing this setting does not cover: your plant is already listed on their dashboard with its name, current stage and launch date. This is about the updates they receive, not that listing.",
    "Turn it off whenever you like. Sharing stops at the next update — nothing already sent is recalled.",
  ],
} as const;

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
