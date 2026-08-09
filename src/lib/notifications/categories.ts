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
 * WHOSE defaults are being resolved — the plant's own team, or the plant's
 * oversight partner.
 *
 * A coded default answers "what does someone who has never opened the settings
 * screen get?", and that question genuinely has two answers here, because the
 * two audiences receive different things. It is NOT a permission: eligibility
 * is decided in `enqueue`, before any preference is consulted. This only
 * decides what an ABSENT preference row means, and an explicit row from either
 * audience still wins outright.
 *
 * Deliberately an audience rather than a role, so exactly one place
 * (`audienceForRole` in `./preferences.ts`) maps the five roles onto the two
 * behaviours and the rest of the module never branches on a role string.
 */
export type NotificationAudience = "church" | "oversight";

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
 * user's effective default is "nothing" whatever this table says, and FIVE of
 * these SEVEN rows — every granular category — are unreachable for them
 * however the plant decides. (Only the invitation-accepted milestone is exempt
 * from the second question; see `oversightGateFor`.)
 *
 * The one CHANNEL default that differs by audience is `digest`/`in_app`, and it
 * is overridden below rather than restated — see
 * `OVERSIGHT_CHANNEL_DEFAULT_OVERRIDES`.
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
 * Where an OVERSIGHT recipient's coded default differs from the table above
 * (N-027). Sparse on purpose: anything absent here means "the same default as
 * everyone else", so there is one table of defaults and a short list of
 * exceptions, not two tables to keep in step.
 *
 * ----------------------------------------------------------------------------
 * Why `digest`/`in_app` is ON for oversight and OFF for the plant
 * ----------------------------------------------------------------------------
 *
 * The reason `digest`/`in_app` is off is stated where it is set: an in-app
 * digest row would DUPLICATE the feed it summarises. That reason is a fact
 * about the plant's own team, who see the granular rows the digest rolls up.
 * It is false for an oversight recipient, who is refused every granular
 * category outright (`OVERSIGHT_ELIGIBLE_CATEGORIES`): there is no feed for
 * their digest to duplicate, so suppressing it in-app removes the only thing
 * they would have had to look at.
 *
 * N-027 already rules the outcome — "a notification delivered to an oversight
 * user always has an in-app row they can see" — and with the shared default the
 * digest was delivered by email and then filtered out of the feed, the unread
 * badge and mark-read by `resolveInAppCategories`. That is the requirement
 * failing quietly, in the read path, on a category the recipient never chose.
 *
 * Note what this is NOT: it is not eligibility (that is `enqueue`'s, and it is
 * stricter), and it is not a stored row. An oversight user who switches the
 * digest's in-app channel off gets an explicit `false` and keeps it, exactly
 * like everyone else.
 */
export const OVERSIGHT_CHANNEL_DEFAULT_OVERRIDES: Partial<
  Record<NotificationCategory, Partial<Record<NotificationChannel, boolean>>>
> = {
  digest: { in_app: true },
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
 * The two events that END an org's relationship with a plant (#304, OV-006 /
 * OV-007) — and the ONLY types for which `enqueue`'s tenancy gate accepts a
 * RECORDED RELATIONSHIP instead of current access.
 *
 * ----------------------------------------------------------------------------
 * Why these two need their own list, when the consent exemption already covers
 * them
 * ----------------------------------------------------------------------------
 *
 * Consent and tenancy are different gates and only one of them is the problem
 * here. `canAccessChurch` resolves an oversight admin's reach from the PLANT'S
 * CURRENT FK (`getAccessibleChurchIds`), so for both of these events the answer
 * is false at the moment they happen, and false for the same structural reason:
 *
 *   * a DECLINED invitation never set the FK at all, so the plant was never in
 *     the org's scope;
 *   * an association that ENDED nulled the FK in the write these announce, so
 *     the plant left the org's scope in the very act being reported.
 *
 * Composed with the plant's `church_id` — the only tenant an event about a
 * plant can be filed under — both would therefore be skipped `outside_church`
 * and the org would never hear that its own relationship had changed. The
 * consent exemption cannot help: it deliberately relaxes gate 3 and nothing
 * above it.
 *
 * ----------------------------------------------------------------------------
 * This is a tenancy BASIS, not a tenancy bypass
 * ----------------------------------------------------------------------------
 *
 * What `enqueue` accepts for these types is not "no check". It is a different,
 * narrower fact, verified server-side against the database:
 * `orgHasRecordedRelationshipWithChurch` (`./oversight-relationship.ts`) — this
 * org and this plant have an invitation or an `association_events` row between
 * them. An org with no such record is refused exactly as before, and the
 * fallback is unreachable for every other notification type in the product,
 * including the two GATED milestones and the digest.
 *
 * The list is a subset of `OVERSIGHT_SHARING_EXEMPT_TYPES` below and both are
 * spelled out rather than imported from `./oversight.ts` (which imports
 * `./enqueue.ts`, which imports this file — the import would cycle).
 * `oversight.test.ts` asserts each string is the one the emitters actually
 * produce, so neither list can drift into an exemption that matches nothing.
 */
export const OVERSIGHT_OWN_RELATIONSHIP_TYPES = [
  "oversight.milestone.invitation_declined",
  "oversight.milestone.association_ended",
] as const;

/**
 * Is this the kind of event whose tenancy basis is a RECORDED relationship
 * rather than current access? Asked by `enqueue` only after `canAccessChurch`
 * has already said no.
 */
export function isOwnRelationshipType(type: string): boolean {
  return (OVERSIGHT_OWN_RELATIONSHIP_TYPES as readonly string[]).includes(type);
}

/**
 * May this AUDIENCE ever be served this category at all?
 *
 * The same question `isOversightEligibleCategory` answers, asked the way the
 * settings screen has to ask it: it knows the reader's audience, not whether the
 * reader happens to be an oversight one. A church reader is served every
 * category, so the answer is unconditionally true for them and the caller needs
 * no role branch of its own.
 *
 * This is NOT the delivery gate. `recipientMayBeNotified` is, and it is
 * stricter — it also asks about the plant's sharing toggle and about tenancy.
 * This is the WEAKER, category-only question, which is the one a screen can
 * answer without knowing which plant a hypothetical notification would be about.
 */
export function audienceMayReceiveCategory(
  audience: NotificationAudience,
  category: NotificationCategory
): boolean {
  if (audience !== "oversight") return true;
  return isOversightEligibleCategory(category);
}

/**
 * The categories this audience is NEVER served, in the matrix's own order.
 *
 * Derived from `OVERSIGHT_ELIGIBLE_CATEGORIES`, never listed — that is the
 * point. A screen that hides, disables or labels these rows must not carry its
 * own copy of the five granular category names: a category added to the enum
 * tomorrow is ineligible for oversight until someone deliberately adds it to the
 * allow-list, and this function has to say so on the day it is added, with no
 * second edit.
 *
 * Empty for a church reader, which is the whole answer for four of the five
 * roles (ruled 2026-08-09, extending #254's principle from the cadence control
 * to the category rows: a user is not offered a control that cannot change what
 * they receive).
 */
export function ineligibleCategoriesForAudience(
  audience: NotificationAudience
): NotificationCategory[] {
  return notificationCategories.filter(
    (category) => !audienceMayReceiveCategory(audience, category)
  );
}

/**
 * The notification types an oversight recipient receives WHETHER OR NOT the
 * plant has turned sharing on (ruled 2026-08-01, amending N-026).
 *
 * Three, and the reason is whose event each one is. "Your invitation was
 * accepted" is the SENDING CHURCH'S OWN event: they composed the invitation,
 * they issued it, and the acceptance is the answer to a question they asked. It
 * discloses nothing about how the plant is doing — only that a handshake the
 * sending church initiated completed. A plant's consent governs what leaves the
 * plant ABOUT the plant; it was never a power to withhold from someone the
 * answer to their own question.
 *
 * #304 / OV-006 + OV-007 add the two events that CLOSE that same relationship,
 * on exactly the same reasoning: an invitation DECLINED is the other answer to
 * the org's own question, and an association ENDED is the org being told that a
 * relationship it is a party to has stopped. Neither says anything about how the
 * plant is doing, and both are facts the org can already see in its own
 * invitations list and its own plants directory a moment later. Gating them
 * would mean the org's own relationship changing under it in silence — which is
 * the same "structurally unreachable control" the 2026-08-01 ruling rejected,
 * only worse: a plant that leaves has, by definition, stopped sharing.
 *
 * It also un-breaks the ordinary sequence. The toggle defaults to off and a
 * planter decides about it AFTER joining, so at the moment of acceptance it was
 * off in essentially every real case: the milestone was composed, refused by
 * gate 3, and never retried. The one milestone guaranteed to matter — someone
 * joined you — was the one guaranteed never to arrive. A control that is
 * structurally unreachable is not a privacy guarantee, it is dead code.
 *
 * The two OTHER milestones stay gated, and the line between them is the same
 * one: a phase advance and a launch date are facts about the PLANT'S OWN
 * progress, so the sending church learns them only if the plant says so.
 *
 * The literal is spelled out here rather than imported from `./oversight.ts`
 * (which imports `./enqueue.ts`, which imports this file, so the import would
 * cycle). `oversight.test.ts` asserts this string is the one
 * `oversightMilestoneType("invitation_accepted")` actually produces, so the two
 * cannot drift into an exemption that matches nothing.
 */
export const OVERSIGHT_SHARING_EXEMPT_TYPES = [
  "oversight.milestone.invitation_accepted",
  ...OVERSIGHT_OWN_RELATIONSHIP_TYPES,
] as const;

/**
 * What the oversight gate decides for one (category, type) pair.
 *
 * - `denied`            never, whatever the plant decided.
 * - `requires_sharing`  only with `share_activity_with_oversight` on.
 * - `exempt`            the sending church's own event; consent does not apply.
 */
export type OversightGate = "denied" | "requires_sharing" | "exempt";

/**
 * The whole oversight rule in one function, so `recipientMayBeNotified` has one
 * question to ask and a reviewer has one place to read the answer.
 *
 * ORDER IS THE SAFETY PROPERTY. Category eligibility is decided FIRST, so the
 * exemption can only ever relax the CONSENT question — an exempt `type` smuggled
 * into `tasks` is refused exactly as any other granular row would be, and no
 * addition to the exempt list can promote a granular category into oversight's
 * reach.
 *
 * Two things this deliberately does NOT do:
 *   * It does not touch `canAccessChurch`. An admin with no reach over the plant
 *     is refused, exemption or not — this bypasses CONSENT, never TENANCY.
 *   * It does not read request input. `type` is composed server-side by the
 *     emitters in `./oversight.ts`, so the exempt list is not an input surface.
 */
export function oversightGateFor(
  category: NotificationCategory,
  type: string
): OversightGate {
  if (!isOversightEligibleCategory(category)) return "denied";
  if ((OVERSIGHT_SHARING_EXEMPT_TYPES as readonly string[]).includes(type)) {
    return "exempt";
  }
  return "requires_sharing";
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
 * This toggle gates what is PUSHED: the digest and TWO of the three milestones,
 * via `enqueue`. The invitation-accepted milestone is exempt
 * (`OVERSIGHT_SHARING_EXEMPT_TYPES`) because it is the sending church's own
 * event, so the second and fifth bullets below say two milestones and name the
 * third as an exception rather than listing all three as governed. That is a
 * deliberate amendment of copy that was previously frozen: the ruling changed
 * the facts, and copy whose only virtue is that it has not changed is not
 * truthful copy.
 *
 * It does not gate what oversight may PULL either. `getOversightPlantHealth`
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
    "They also hear about two milestones — you move to a new stage, you set or change a launch date.",
    "They never see names, notes, messages, giving, or a list of what you did. This is a summary, not an activity feed.",
    "Two things this setting does not cover. Your plant is already listed on their dashboard with its name, current stage and launch date — this is about the updates they receive, not that listing.",
    "And if they invited you, they were told the moment you accepted. That is their own invitation being answered, so it reaches them either way.",
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
  channel: NotificationChannel,
  audience: NotificationAudience = "church"
): boolean {
  if (audience === "oversight") {
    const override = OVERSIGHT_CHANNEL_DEFAULT_OVERRIDES[category]?.[channel];
    if (override !== undefined) return override;
  }
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
