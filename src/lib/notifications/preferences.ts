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
  type PreferenceIntent,
  type User,
  type UserRole,
} from "@/db/schema";
import { OVERSIGHT_ROLES } from "@/lib/auth/roles";

import {
  audienceMayReceiveCategory,
  DEFAULT_DIGEST_CADENCE,
  defaultChannelEnabled,
  ineligibleCategoriesForAudience,
  NOTIFICATION_CATEGORIES,
  notificationPreferenceMatrixKeys,
  type NotificationAudience,
} from "./categories";
import {
  verifyUnsubscribeToken,
  type UnsubscribeTokenPurpose,
  type UnsubscribeTokenRejection,
} from "./channels/unsubscribe-token";

// ============================================================================
// Preference resolution (N-005).
//
// The rule this file exists to enforce: an ABSENT row means the category's
// coded default, not "off". Nothing is ever seeded, so a category added in a
// later deploy works for every existing user with no backfill, and a user who
// has never opened the settings screen has no rows at all.
//
// ----------------------------------------------------------------------------
// Absence is not the only way to have chosen nothing
// ----------------------------------------------------------------------------
//
// A row can exist without its `enabled` being a CHOICE. The cadence selector is
// the case that forced this: cadence has nowhere to live but a (digest, email)
// row (see `DIGEST_CADENCE_CHANNEL`), so changing only the cadence has to
// INSERT one, and that row's `enabled` is a copy of today's coded default that
// nobody picked. Read back as a choice, it pins the user to a value they never
// made — precisely what `preferenceWriteIsNoop` exists to prevent on the toggle
// path, arriving through the other door.
//
// SO THE ROW RECORDS WHY IT EXISTS. `notification_preferences.intent` is
// stamped by the write path, and `preferenceValueIsInheritable` decides from
// that stamp:
//
//   `incidental`  a save wrote this value to carry something else, so it says
//                 nothing on its own. While it equals the coded default it is
//                 INHERITABLE — resolved as `source: "default"`, carrying the
//                 coded default's value, so a later change to that default
//                 (N-019, role-aware defaults) still reaches the user.
//   `chosen`      a human decided this value, so it is honoured as written
//                 however it agrees with today's default. The logged-out
//                 unsubscribe undo (`./channels/unsubscribe.ts`) is the case
//                 that makes this load-bearing: "keep sending these" writes
//                 `true`, which EQUALS every category's coded email default,
//                 and a rule that read the value alone would reverse that
//                 reader's own decision about their consent the day the default
//                 flipped.
//
// A stored value that DIFFERS from the coded default is explicit under either
// stamp, whoever wrote it and whichever direction it points — an opt-out is
// never re-defaulted back on, and an opt-IN against a default that is off is
// never dropped.
//
// THE STAMP IS NEVER REQUEST INPUT, which is what makes it trustworthy: it is
// absent from `setPreferenceSchema`, and each write path states its own (see
// `setPreferenceQuery` and `setDigestCadenceQuery`), so no caller can claim a
// by-product was a decision.
//
// The rule is therefore UNIFORM ACROSS CHANNELS. It was once inferred from the
// channel instead — every row on the emailed link's channel honoured as a
// choice, with the cadence cell carved back out again — because nothing stored
// said who wrote a row. The stamp says, so neither the exemption nor the
// carve-out is left.
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
// THERE IS EXACTLY ONE UNAUTHENTICATED CALLER, and it is minted here too.
// The logged-out email-footer unsubscribe (N-007) has its own minting function,
// `preferenceOwnerFromUnsubscribeToken`, below — and it is the verification
// INSIDE that function, not a comment, that earns the brand. It takes an opaque
// sealed token (`./channels/unsubscribe-token`), not a user id: a link that
// passes a raw user id is still not something this module will accept, and that
// is deliberate.
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

export type UnsubscribeOwnerResolution =
  | {
      ok: true;
      owner: PreferenceOwner;
      /** The ONE category this token may change. */
      category: NotificationCategory;
      /** The ONE direction it may change it in. */
      purpose: UnsubscribeTokenPurpose;
      expiresAt: Date;
    }
  | { ok: false; reason: UnsubscribeTokenRejection };

/**
 * The second — and only other — way to obtain a `PreferenceOwner`: from a
 * sealed unsubscribe token that this function has just opened and validated.
 *
 * It sits beside `preferenceOwnerFromSession` on purpose. Both entrypoints mint
 * the brand, both do it only after PROVING whose consent record is being
 * addressed, and there is nowhere else in the codebase that can. A route that
 * wants to unsubscribe someone therefore has exactly one door, and the door
 * does the verification.
 *
 * It RETURNS a refusal rather than throwing, because the caller is a public
 * route handler rendering a page for a stranger: the refusal is an outcome to
 * display, not an exception to log. `reason` is for the log; the page says the
 * same thing whatever it is (see `UnsubscribeTokenRejection`).
 *
 * The category comes out of the token, never out of the request. A query
 * string that could name the category would let a holder of one category's
 * link switch off a different one. So does the DIRECTION: the caller declares
 * which way it is about to write, and the token is opened with that
 * direction's key, so an emailed (disable) token resolves to nothing at all
 * when a re-enable is what is being attempted.
 */
export function preferenceOwnerFromUnsubscribeToken(
  token: string,
  options: {
    purpose?: UnsubscribeTokenPurpose;
    now?: Date;
    secret?: string;
  } = {}
): UnsubscribeOwnerResolution {
  const verified = verifyUnsubscribeToken(token, options);
  if (!verified.valid) {
    return { ok: false, reason: verified.reason };
  }

  return {
    ok: true,
    owner: preferenceUserIdSchema.parse(verified.userId) as PreferenceOwner,
    category: verified.category,
    purpose: verified.purpose,
    expiresAt: verified.expiresAt,
  };
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
 * Is a stored `enabled` indistinguishable from having chosen nothing?
 *
 * Decided from the row's own `intent` stamp, never from its channel:
 *
 *   `chosen`      NEVER inheritable. Somebody decided this value, so it is
 *                 honoured as written however it agrees with today's coded
 *                 default — which is the whole reason the stamp is stored (see
 *                 the module header, and `preferenceIntents` in the schema).
 *   `incidental`  inheritable while it equals the coded default. Such a value
 *                 tells us nothing the default did not already say, so treating
 *                 it as a choice only freezes today's default into a user's
 *                 record — and the user is then the one person a change to that
 *                 default cannot reach.
 *
 * For an `incidental` row the comparison is against the CURRENT coded default,
 * deliberately. It asks "does this row still say anything?", not "was this
 * written deliberately?" — the stamp answers that one. A row that stops
 * agreeing with the default starts saying something, and from then on it is
 * honoured as a choice whatever its stamp.
 *
 * `audience` matters for the same reason it matters everywhere else here: the
 * coded default for `digest`/`in_app` differs between the plant's team and an
 * oversight recipient (N-027), so the same stored `false` is inheritable for
 * one and a deliberate opt-out for the other.
 *
 * `intent` is REQUIRED and sits ahead of the optional `audience`, so a caller
 * that has a row but does not say what kind of row it is does not compile.
 * There is no channel branch and no per-cell exception left: every (category,
 * channel) pair is decided the same way.
 */
export function preferenceValueIsInheritable(
  category: NotificationCategory,
  channel: NotificationChannel,
  enabled: boolean,
  intent: PreferenceIntent,
  audience: NotificationAudience = "church"
): boolean {
  if (intent === "chosen") return false;
  return enabled === defaultChannelEnabled(category, channel, audience);
}

/**
 * Resolve one (category, channel) against a user's stored rows.
 *
 * - row absent       → the category's coded default, marked `default`.
 * - row inheritable  → the coded default, marked `default`. The row is stamped
 *                      `incidental` and its stored value agrees with the
 *                      default, so it adds nothing; see
 *                      `preferenceValueIsInheritable` and the module header. A
 *                      row stamped `chosen` is never inheritable, so an
 *                      agreeing row there is a CHOICE and takes the branch
 *                      below.
 * - row differs      → its `enabled`, marked `explicit` (true AND false alike;
 *                      a stored `false` is a deliberate opt-out and must not be
 *                      re-defaulted back on, and a stored `true` against a
 *                      default that is off is a deliberate opt-in).
 *
 * A row's `digestCadence` survives all three branches: the cadence is a
 * separate answer from "is the digest on at all", and an inheritable `enabled`
 * says nothing about it.
 *
 * `rows` is whatever `loadUserPreferences` returned, or a pre-built map when
 * resolving many pairs for the same user.
 */
export function resolvePreference(
  rows: readonly NotificationPreference[] | Map<string, NotificationPreference>,
  category: NotificationCategory,
  channel: NotificationChannel,
  audience: NotificationAudience = "church"
): ResolvedPreference {
  const map = rows instanceof Map ? rows : buildPreferenceMap(rows);
  const row = map.get(preferenceKey(category, channel));

  // The ONLY place the audience is consulted: absence — and now a row that
  // merely restates the default — means "the coded default", and that default
  // differs for an oversight recipient on `digest`/`in_app` (N-027 — see
  // OVERSIGHT_CHANNEL_DEFAULT_OVERRIDES). A row that DIFFERS from the default
  // is returned unchanged below, whoever wrote it, so this can never override a
  // choice a user actually made.
  //
  // It defaults to "church" so every existing caller keeps today's answer and
  // only a caller that KNOWS the recipient's role can change it — guessing an
  // audience would be worse than not asking.
  const digestCadence =
    category === "digest"
      ? (row?.digestCadence ?? DEFAULT_DIGEST_CADENCE)
      : null;

  if (
    !row ||
    preferenceValueIsInheritable(
      category,
      channel,
      row.enabled,
      row.intent,
      audience
    )
  ) {
    return {
      category,
      channel,
      enabled: defaultChannelEnabled(category, channel, audience),
      source: "default",
      digestCadence,
    };
  }

  return {
    category,
    channel,
    enabled: row.enabled,
    source: "explicit",
    digestCadence,
  };
}

/**
 * Which coded defaults apply to a user in this role (N-027).
 *
 * The ONE place the five roles collapse onto the two audiences, so nothing else
 * in the module branches on a role string. It is a DEFAULTS question, never a
 * permission one — eligibility is `enqueue`'s and is far stricter.
 */
export function audienceForRole(role: UserRole): NotificationAudience {
  return (OVERSIGHT_ROLES as readonly UserRole[]).includes(role)
    ? "oversight"
    : "church";
}

/** Convenience for the dispatcher: is this channel on for this category? */
export function isChannelEnabled(
  rows: readonly NotificationPreference[] | Map<string, NotificationPreference>,
  category: NotificationCategory,
  channel: NotificationChannel,
  audience: NotificationAudience = "church"
): boolean {
  return resolvePreference(rows, category, channel, audience).enabled;
}

/**
 * The channel a digest cadence is STORED on.
 *
 * Cadence is a property of the digest itself — "how often my roll-up arrives" —
 * but the table's grain is (user, category, channel), so it has to live on one
 * of the two `digest` rows. It lives on `email` because that is where a digest
 * is actually read: an in-app digest row would duplicate the feed it summarises
 * (which is why `digest`/`in_app` is the one coded default that is off).
 *
 * Writing it to BOTH digest rows was the alternative and is worse: it would
 * materialise a second row the user never asked for, doubling the surface the
 * inheritable rule has to keep harmless for no gain. One row is enough, and the
 * `incidental` stamp `setDigestCadenceQuery` writes is what stops that row
 * reading as a choice. It shares its channel with the emailed unsubscribe link
 * and that no longer matters: the two writes are told apart by what they say
 * about themselves, not by where they land. See `resolveDigestCadence` for the
 * read side.
 */
export const DIGEST_CADENCE_CHANNEL: NotificationChannel = "email";

/**
 * The user's digest cadence — a CATEGORY-level answer, not a per-channel one.
 *
 * It prefers the row cadence is written to (`DIGEST_CADENCE_CHANNEL`), then any
 * other `digest` row carrying one, then the coded default. The second step is
 * not decoration: it means a cadence written by an older shape of this code, or
 * by `setPreference` with a `digestCadence` on the other channel, is still
 * honoured rather than silently reverting the user to `weekly`.
 *
 * The screen shows exactly one cadence control, so it must read exactly one
 * value — two `digest` rows disagreeing would otherwise make the answer depend
 * on which channel you asked about.
 */
export function resolveDigestCadence(
  rows: readonly NotificationPreference[] | Map<string, NotificationPreference>
): DigestCadence {
  const map = rows instanceof Map ? rows : buildPreferenceMap(rows);

  const preferred = map.get(
    preferenceKey("digest", DIGEST_CADENCE_CHANNEL)
  )?.digestCadence;
  if (preferred) return preferred;

  for (const channel of notificationChannels) {
    const cadence = map.get(preferenceKey("digest", channel))?.digestCadence;
    if (cadence) return cadence;
  }

  return DEFAULT_DIGEST_CADENCE;
}

/**
 * The full category × channel matrix the preferences screen renders (N-006),
 * with every cell resolved and its source attributed.
 */
export function resolvePreferenceMatrix(
  rows: readonly NotificationPreference[],
  audience: NotificationAudience = "church"
): ResolvedPreference[] {
  const map = buildPreferenceMap(rows);
  return notificationPreferenceMatrixKeys().map(({ category, channel }) =>
    resolvePreference(map, category, channel, audience)
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
 * is off for the plant's own team (an in-app digest row would duplicate the
 * feed it summarises) and ON for an oversight recipient, who has no such feed
 * (N-027). Nothing about the defaults is restated in this function; that is the
 * point, and it is why the audience is a parameter rather than a branch.
 *
 * The result can legitimately be EMPTY (a user who turned every category off),
 * and callers must treat that as "nothing is visible" rather than as "no
 * filter" — see `feedVisibility` in ./queries.
 */
export function resolveInAppCategories(
  rows: readonly NotificationPreference[],
  audience: NotificationAudience = "church"
): NotificationCategory[] {
  const map = buildPreferenceMap(rows);
  return notificationCategories.filter((category) =>
    isChannelEnabled(map, category, "in_app", audience)
  );
}

// ----------------------------------------------------------------------------
// Screen 2 — the preferences screen's view model (N-006)
// ----------------------------------------------------------------------------

// ============================================================================
// Everything below is what the settings screen renders, resolved on the server
// and handed to the client component as a finished object — the same division
// `feed-view.ts` uses for Screen 1, and for the same two reasons.
//
// 1. The matrix is DERIVED, never listed. Its rows come from
//    `notificationCategories` and its columns from `notificationChannels`, both
//    code-defined tuples in `@/db/schema/notifications`. A seventh category is
//    a one-line change in the registry plus its copy — this file, the page, the
//    component and the tests all pick it up with no edit, and there is nowhere
//    a hardcoded list could fall out of step with what the dispatcher consults.
//
// 2. Resolving here keeps `@/db/schema` — and the whole Drizzle table graph —
//    out of the client bundle. The component imports only TYPES from this
//    module, which are erased.
//
// The cells carry `source` so the screen can be honest about the N-005 rule
// that absence means the coded default: a cell showing "on" because nobody has
// ever touched it is a different fact from one showing "on" because the user
// switched it on, and the write path uses the same distinction to avoid
// materialising a row that only restates a default.
// ============================================================================

/** One toggle in the matrix. */
export interface PreferenceCellView {
  category: NotificationCategory;
  channel: NotificationChannel;
  enabled: boolean;
  source: PreferenceSource;
  /** Stable identity for keys, ids and test hooks — `"tasks:email"`. */
  key: string;
}

/** One column of the matrix. */
export interface PreferenceChannelView {
  channel: NotificationChannel;
  label: string;
}

/** One row of the matrix: a category, its purpose, and its cells. */
export interface PreferenceCategoryView {
  category: NotificationCategory;
  label: string;
  /** What the user is turning off, in their words. */
  description: string;
  cells: PreferenceCellView[];
  /**
   * Is this reader EVER served this category? (ruled 2026-08-09)
   *
   * True for every row a church reader sees. False for the five granular
   * categories an oversight reader is refused outright by
   * `OVERSIGHT_ELIGIBLE_CATEGORIES` — rows whose switches render, accept a
   * click and save, and change nothing that reaches them. #254 established that
   * a user is not offered a control that cannot affect what they receive, and
   * the ruling extends it from the cadence selector to the category rows.
   *
   * It is a FACT about the row, not an instruction to the screen: what the
   * screen does with an ineligible row — hide it, disable it, label it — is a
   * separate decision, and this field is the same either way.
   */
  eligible: boolean;
}

/** One choice in the cadence selector. */
export interface DigestCadenceOptionView {
  value: DigestCadence;
  label: string;
}

/**
 * The cadence control, which belongs to the `digest` row of the matrix.
 *
 * SCOPE, because there are two different digests in this product and only one
 * of them is settable here: this governs the user's OWN open-items digest
 * (N-013) and nothing else. The oversight activity digest (N-025) is fixed
 * daily, is not a per-user choice, and is gated by a plant-side sharing toggle
 * (N-026) that lives on a different screen entirely. So the copy below talks
 * only about the reader's own open items — it must never suggest that anything
 * on this screen decides what leaves the plant.
 */
export interface DigestCadenceChoiceView {
  kind: "choice";
  category: NotificationCategory;
  label: string;
  /** Plain-language scope + effect. */
  description: string;
  cadence: DigestCadence;
  options: DigestCadenceOptionView[];
}

/**
 * What an OVERSIGHT recipient gets in place of the selector (#254).
 *
 * The only digest a `sending_church_admin` or `network_admin` receives is the
 * oversight activity digest, and N-025 fixes it at daily. So the selector was
 * inert for them: it rendered, it accepted a click, it saved — and nothing they
 * received ever changed. Worse before #237 was fixed, because that save also
 * materialised a preference row as a side effect.
 *
 * Making it honest, not merely hiding it: they are told what DOES decide the
 * timing. A control removed with no explanation reads as a missing feature; the
 * fact here is that the timing is not theirs to choose, and saying so is the
 * whole point.
 *
 * Deliberately NOT done here: making the oversight digest respect a cadence.
 * That contradicts the N-025/N-026 ruling and is a spec decision, not a bug fix.
 */
export interface DigestCadenceFixedView {
  kind: "fixed";
  category: NotificationCategory;
  /** What decides the timing, since the reader does not. */
  description: string;
}

/** The `digest` row's cadence area — a control, or an explanation. */
export type DigestCadenceView =
  | DigestCadenceChoiceView
  | DigestCadenceFixedView;

/** The whole screen, ready to render. */
export interface PreferenceMatrixView {
  channels: PreferenceChannelView[];
  categories: PreferenceCategoryView[];
  digest: DigestCadenceView;
  /**
   * Why some rows are not this reader's to choose — `null` when every row is.
   *
   * One sentence for the whole screen rather than one per row: the reason is
   * the same for all five, and repeating it five times would make a settings
   * screen read like a refusal notice. A screen that hides the rows entirely
   * may ignore it; a screen that shows them has something true to say.
   */
  ineligibleNote: string | null;
}

/**
 * Channel copy for the screen.
 *
 * It lives here rather than in `categories.ts` because it is screen copy for
 * N-006 and nothing else consults it — a channel is a delivery mechanism with
 * no per-channel behaviour to describe, unlike a category, whose purpose the
 * user genuinely has to understand before switching it off.
 */
export const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> =
  {
    email: "Email",
    in_app: "In app",
  };

/** Cadence copy for the selector. */
export const DIGEST_CADENCE_LABELS: Record<DigestCadence, string> = {
  daily: "Every day",
  weekly: "Once a week",
};

/**
 * The cadence control's help text.
 *
 * Exported so a test can hold it to the N-013/N-025 boundary: it says whose
 * digest this is ("your own open items") and never mentions sharing, sending
 * churches, networks or plant activity — none of which this control touches.
 */
export const DIGEST_CADENCE_DESCRIPTION =
  "How often your roll-up of your own open items arrives.";

/**
 * The oversight replacement for that control (#254).
 *
 * Exported for the same reason: a test holds it to what is true. It states the
 * cadence (daily), the condition (only on days with something to report) and
 * that the reader does not set it — and it offers nothing, because there is
 * nothing here to offer.
 *
 * It is also the refusal the cadence action returns to an oversight caller, so
 * the screen and the endpoint say the same sentence.
 */
export const OVERSIGHT_DIGEST_CADENCE_NOTE =
  "Your summary of plant activity arrives once a day, on the days there is something to report. That timing is fixed.";

/**
 * Why five of the seven rows are not an oversight reader's to choose (ruled
 * 2026-08-09).
 *
 * It says what they DO receive first, because that is the useful half: a reader
 * who learns only that something is unavailable has been told about an absence,
 * while a reader told "milestones and the daily summary" knows what to expect
 * from the product. The second clause gives the reason — these updates belong to
 * the plant's own team — so the row reads as a boundary the product keeps rather
 * than a feature the reader has failed to unlock.
 *
 * It does not say "your role", "permissions" or "not eligible". Those are the
 * system's words for it; the reader's word for it is who the updates are for.
 *
 * Exported so a test can hold it to N-025/N-026, and so the refused write says
 * the same sentence the screen does — the same pairing
 * `OVERSIGHT_DIGEST_CADENCE_NOTE` has with the cadence action.
 */
export const OVERSIGHT_INELIGIBLE_CATEGORY_NOTE =
  "You receive milestones and the daily summary — the day-to-day updates stay with the plant's own team.";

/**
 * Build the whole screen from a user's stored rows.
 *
 * `audience` is the SAME argument the read and dispatch paths resolve with
 * (`audienceForRole(session.user.role)`). It has to be, or the screen lies: an
 * oversight recipient's `digest`/`in_app` default is ON (N-027) while the
 * plant's team's is off, so a matrix built with the "church" defaults would
 * show an oversight admin an unchecked box for a notification they are in fact
 * receiving — and their first click would "turn on" something already on.
 *
 * It still defaults to "church" so a caller that does not know the recipient's
 * role gets today's answer rather than a guessed one; the only production
 * caller is `/settings`, which knows.
 */
export function buildPreferenceMatrixView(
  rows: readonly NotificationPreference[],
  audience: NotificationAudience = "church"
): PreferenceMatrixView {
  const map = buildPreferenceMap(rows);

  return {
    channels: notificationChannels.map((channel) => ({
      channel,
      label: NOTIFICATION_CHANNEL_LABELS[channel],
    })),
    categories: notificationCategories.map((category) => ({
      category,
      label: NOTIFICATION_CATEGORIES[category].label,
      description: NOTIFICATION_CATEGORIES[category].description,
      // Derived from the delivery allow-list, never listed here — see
      // `ineligibleCategoriesForAudience`. A category added to the enum is
      // ineligible for an oversight reader from its first deploy, with no edit
      // to this file and none to the component.
      eligible: audienceMayReceiveCategory(audience, category),
      cells: notificationChannels.map((channel) => {
        const resolved = resolvePreference(map, category, channel, audience);
        return {
          category,
          channel,
          enabled: resolved.enabled,
          source: resolved.source,
          key: preferenceKey(category, channel),
        };
      }),
    })),
    // An oversight recipient is not offered a control that cannot change what
    // they receive (#254) — see `DigestCadenceFixedView`. The audience decides,
    // not the role, so this stays the one place the five roles collapse onto
    // the two behaviours (`audienceForRole`).
    digest: buildDigestCadenceView(map, audience),
    // The note is present only when it has something to explain, so a screen
    // can ask `ineligibleNote` rather than re-deriving the audience.
    ineligibleNote:
      ineligibleCategoriesForAudience(audience).length > 0
        ? OVERSIGHT_INELIGIBLE_CATEGORY_NOTE
        : null,
  };
}

/** The `digest` row's cadence area for this audience. See `DigestCadenceView`. */
function buildDigestCadenceView(
  map: Map<string, NotificationPreference>,
  audience: NotificationAudience
): DigestCadenceView {
  if (audience === "oversight") {
    return {
      kind: "fixed",
      category: "digest",
      description: OVERSIGHT_DIGEST_CADENCE_NOTE,
    };
  }

  return {
    kind: "choice",
    category: "digest",
    label: "How often",
    description: DIGEST_CADENCE_DESCRIPTION,
    cadence: resolveDigestCadence(map),
    options: digestCadences.map((value) => ({
      value,
      label: DIGEST_CADENCE_LABELS[value],
    })),
  };
}

// ----------------------------------------------------------------------------
// "Only write a row on an actual change"
// ----------------------------------------------------------------------------

/**
 * Would writing this value change anything the user would ever observe?
 *
 * N-005's rule is that an ABSENT row means the coded default. That rule only
 * holds if absence is preserved: a screen that saves every control it rendered
 * — or a double-submitted toggle — would seed twelve explicit rows that merely
 * restate today's defaults, and from then on the user is pinned to them. When
 * N-019 (role-aware defaults) lands, or a default is simply reconsidered, those
 * users silently keep the old behaviour with no record of ever having chosen
 * it.
 *
 * So the write path asks this first. `false` means "the effective value is
 * already this" — including the case where it is already this BY DEFAULT — and
 * the action returns without touching the table.
 *
 * `audience` must match the one the matrix was RENDERED with, for the same
 * reason it exists there: "already this by default" is an audience-dependent
 * question (N-027). Resolving the write against the church defaults while the
 * screen showed the oversight ones turns an oversight admin's deliberate
 * switch-off of their in-app digest into a no-op — the action reports success,
 * writes nothing, and the notification keeps arriving.
 */
export function preferenceWriteIsNoop(
  rows: readonly NotificationPreference[],
  category: NotificationCategory,
  channel: NotificationChannel,
  enabled: boolean,
  audience: NotificationAudience = "church"
): boolean {
  return (
    resolvePreference(rows, category, channel, audience).enabled === enabled
  );
}

/** The same question for the cadence selector. */
export function digestCadenceWriteIsNoop(
  rows: readonly NotificationPreference[],
  cadence: DigestCadence
): boolean {
  return resolveDigestCadence(rows) === cadence;
}

// ----------------------------------------------------------------------------
// Reporting a save that did not happen (#236)
// ----------------------------------------------------------------------------

// ============================================================================
// The settings actions RETURN their failures. They must, or the user is never
// told.
//
// A server action that throws rejects the promise the client component awaits,
// and that rejection unwinds the transition without ever reaching the
// `toast.error` line. All the user sees is the switch snapping back — which is
// indistinguishable from having mis-clicked, and which they will simply try
// again. Only the Zod rejections, which already returned a result, ever
// produced a toast; everything real — an expired session, a database that is
// down — was silent.
//
// So the action bodies are wrapped and hand the failure back through these
// helpers. They live here rather than in the action module because a
// `"use server"` module may only export async functions, and because the
// mapping is worth a unit test of its own.
// ============================================================================

/**
 * The message `verifySession()` throws with (`src/lib/auth/session.ts`).
 *
 * Matching on a message is fragile, so it is not left implicit: it is named
 * here and `preferences.test.ts` reads `session.ts` to prove the two still
 * agree. If the throw is ever changed, that test fails rather than this
 * silently degrading to the generic message.
 */
export const SESSION_EXPIRED_ERROR_MESSAGE = "Unauthorized";

/** Shown when the session behind an open settings tab has expired. */
export const PREFERENCE_SESSION_EXPIRED_MESSAGE =
  "Your sign-in expired. Sign in again, then change this setting.";

/** Shown when the save failed for any other reason. */
export const PREFERENCE_SAVE_FAILED_MESSAGE =
  "We could not save that. Try again.";

/** The failure half of what a settings action returns. */
export interface PreferenceSaveFailure {
  success: false;
  error: string;
}

/**
 * Was this failure the session, rather than the write?
 *
 * Both doors are covered: `verifySession()` throws first for a session that has
 * gone, and `preferenceOwnerFromSession` throws for a session object that
 * arrives empty. They are the same fact to the user and get the same sentence.
 */
export function isUnauthenticatedPreferenceError(error: unknown): boolean {
  if (error instanceof UnauthenticatedPreferenceAccessError) return true;
  return (
    error instanceof Error &&
    error.message.trim() === SESSION_EXPIRED_ERROR_MESSAGE
  );
}

/**
 * Turn a thrown failure into something the screen can say out loud.
 *
 * The expired session gets its own sentence because it is the one case the user
 * can actually resolve, and it is the realistic one: a settings tab left open
 * past the 30-day cookie. Everything else gets a sentence that is honest about
 * what happened without inventing a cause.
 *
 * It never includes the underlying error text. A database message in a toast
 * tells the user nothing and can leak a table name.
 */
export function preferenceSaveFailure(error: unknown): PreferenceSaveFailure {
  return {
    success: false,
    error: isUnauthenticatedPreferenceError(error)
      ? PREFERENCE_SESSION_EXPIRED_MESSAGE
      : PREFERENCE_SAVE_FAILED_MESSAGE,
  };
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
  owner: PreferenceOwner,
  audience: NotificationAudience = "church"
): Promise<ResolvedPreference[]> {
  return resolvePreferenceMatrix(await loadUserPreferences(owner), audience);
}

/** The owner's in-app allow-list, straight from storage. */
export async function getInAppCategories(
  owner: PreferenceOwner,
  audience: NotificationAudience = "church"
): Promise<NotificationCategory[]> {
  return resolveInAppCategories(await loadUserPreferences(owner), audience);
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
 * THIS IS THE DELIBERATE-WRITE DOOR, so every row it writes is stamped
 * `chosen` — on the INSERT and on the UPDATE alike, because a human re-deciding
 * a value promotes a row a cadence save left behind. Both its callers are a
 * person acting: the settings toggle, and the emailed unsubscribe with its undo
 * (`unsubscribeWriteQuery`). The stamp is a property of the PATH and never of
 * the input — it is absent from `setPreferenceSchema`, so a caller forwarding a
 * form body cannot claim a by-product was a decision. A write that is NOT
 * somebody deciding belongs in a function that says so, the way
 * `setDigestCadenceQuery` does.
 *
 * Three more things this function is careful about:
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
    intent: PreferenceIntent;
    updatedAt: Date;
    digestCadence?: DigestCadence;
  } = {
    enabled: parsed.enabled,
    intent: "chosen",
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
      intent: "chosen",
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

/**
 * The cadence write, as a builder — the same `.toSQL()`-assertable shape as
 * `setPreferenceQuery`, and the same `PreferenceOwner` boundary.
 *
 * It writes ONLY `digest_cadence`. Cadence and "is the digest on at all" are
 * separate questions asked by separate controls, so the update clause leaves
 * `enabled` alone: a user who has switched their digest email off and then
 * changes the cadence has not thereby switched it back on.
 *
 * The INSERT arm still has to supply an `enabled`, because the column is NOT
 * NULL. It supplies the CODED DEFAULT for (digest, `DIGEST_CADENCE_CHANNEL`),
 * so the row this creates is behaviourally identical to the absence it
 * replaces — the user changed their cadence and nothing else changed with it.
 *
 * AND IT SAYS SO, which is what makes that true rather than lucky: the row is
 * stamped `incidental`, so `preferenceValueIsInheritable` keeps it following
 * the coded default instead of pinning the user to today's copy of one nobody
 * picked. This is the write the stamp exists to describe.
 *
 * The stamp is NOT in the update clause, for the same reason `enabled` is not:
 * changing a cadence over a row somebody deliberately chose must not demote
 * that choice to a by-product. An `incidental` row stays incidental, a `chosen`
 * row stays chosen, and only the cadence moves.
 */
export function setDigestCadenceQuery(
  owner: PreferenceOwner,
  cadence: DigestCadence
) {
  const ownerId = preferenceUserIdSchema.parse(owner);
  const parsed = z.enum(digestCadences).parse(cadence);

  return db
    .insert(notificationPreferences)
    .values({
      userId: ownerId,
      category: "digest",
      channel: DIGEST_CADENCE_CHANNEL,
      enabled: defaultChannelEnabled("digest", DIGEST_CADENCE_CHANNEL),
      intent: "incidental",
      digestCadence: parsed,
    })
    .onConflictDoUpdate({
      target: [
        notificationPreferences.userId,
        notificationPreferences.category,
        notificationPreferences.channel,
      ],
      set: { digestCadence: parsed, updatedAt: new Date() },
    })
    .returning();
}

/** Write the owner's digest cadence. See `setDigestCadenceQuery`. */
export async function setDigestCadence(
  owner: PreferenceOwner,
  cadence: DigestCadence
): Promise<NotificationPreference> {
  const [row] = await setDigestCadenceQuery(owner, cadence);
  return row;
}
