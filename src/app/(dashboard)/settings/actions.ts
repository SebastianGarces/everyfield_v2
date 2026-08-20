"use server";

import { requireSeat } from "@/lib/auth/seats";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";
import { z } from "zod";

import { setChurchTimeZone } from "@/lib/churches/timezone";
import { isValidTimeZone } from "@/lib/datetime";
import {
  audienceMayReceiveCategory,
  digestCadences,
  notificationCategories,
  notificationChannels,
} from "@/lib/notifications/categories";
import {
  clearAddressSuppression,
  SUPPRESSION_CLEAR_FAILED_MESSAGE,
  SUPPRESSION_SELF_CLEAR_REASON,
} from "@/lib/notifications/channels/suppression";
import {
  audienceForTenancy,
  digestCadenceWriteIsNoop,
  loadUserPreferences,
  OVERSIGHT_DIGEST_CADENCE_NOTE,
  OVERSIGHT_INELIGIBLE_CATEGORY_NOTE,
  preferenceOwnerFromSession,
  preferenceSaveFailure,
  preferenceWriteIsNoop,
  setDigestCadence,
  setPreference,
} from "@/lib/notifications/preferences";

// ============================================================================
// The preferences screen's writes (N-006, Screen 2).
//
// ----------------------------------------------------------------------------
// Whose settings these are is NOT an argument
// ----------------------------------------------------------------------------
//
// No action here accepts a user id, and the preference writes could not usefully
// be given one: every one goes through a `PreferenceOwner`, a branded type
// mintable only by
// `preferenceOwnerFromSession` (see the header of
// `src/lib/notifications/preferences.ts`). A `string` is not assignable to it,
// so an action that forwarded `formData.get("userId")` into the write path does
// not compile — the foreign-user case is a build error, not a runtime check
// someone can forget to add or accidentally delete.
//
// That is the whole ownership story on the write path, and it is deliberately
// the only one. A preference is a CONSENT record: silently re-enabling an
// opt-out is as damaging as switching one off, so "who is this for" cannot be
// something a caller asserts.
//
// The read side is the same shape — the page mints the owner from its own
// session and `loadUserPreferences` takes nothing else, so there is no query
// string, route param or form field anywhere in this screen that names a user.
//
// The bounce escape hatch at the bottom of this file obeys the same rule with a
// different mechanism: it takes NO ADDRESS and reads the session's own, because
// an address parameter would make it an un-suppress endpoint for anybody's
// mailbox. See its own docblock.
//
// ----------------------------------------------------------------------------
// Why these are actions and not a form POST
// ----------------------------------------------------------------------------
//
// Screen 2 says "changes save without a page navigation". Each control calls
// its action directly and the component holds the optimistic value
// (memory/contracts/data-patterns.md), so the switch moves under the finger and
// the server reconciles behind it.
//
// `refresh()` rather than `revalidatePath("/settings")`: turning a category off
// for `in_app` changes what the FEED shows and what the bell counts (N-005 at
// read time), and the bell lives in the dashboard layout, not on this page.
// `refresh()` re-renders the current tree including its layouts, so the badge
// reconciles with the same server state this write just produced.
//
// ----------------------------------------------------------------------------
// SESSION FIRST, THEN THE PARSE (ruled 2026-08-10; extended repo-wide in round
// 8 of #304)
// ----------------------------------------------------------------------------
//
// EVERY export opens with `verifySession()`, ABOVE its `safeParse` (where it has
// one) and above its `try`. Parsing first was not exploitable here — neither action
// names a user and neither reaches storage before the mint — but it answered an
// anonymous caller differently depending on the SHAPE of what they sent: a
// malformed payload came back `{ success: false, error: "That is not a setting
// we can save" }`, a well-formed one hit the session check. That pair of answers
// is a free shape-oracle for the schemas, and it makes "does this endpoint check
// anybody?" a question about reading order rather than about line one.
//
// ABOVE THE `try`, not merely first inside it, and that is the deliberate part:
// a sessionless call must THROW, exactly as every other action in the product
// throws, rather than be converted into a handled `{ success: false }` by the
// catch below. `service.test.ts` §1b‴ calls both exports with no session, with a
// well-formed argument and a malformed one, and requires all four to reject.
//
// The cost, named rather than discovered: a session that expires while the page
// is open no longer produces `PREFERENCE_SESSION_EXPIRED_MESSAGE` from here —
// the switch snaps back with no sentence, the same as any other action in the
// app. That is the trade the ruling makes; the helper keeps the message for the
// failures that still arrive as caught errors.
//
// ----------------------------------------------------------------------------
// Why every body is wrapped (#236)
// ----------------------------------------------------------------------------
//
// A thrown server action rejects the promise the component awaits, and the
// rejection unwinds the transition without reaching its `toast.error`. The user
// sees the switch snap back and nothing else — the same thing a mis-click looks
// like. Only the Zod rejections, which already RETURNED a result, ever spoke.
//
// So every body returns its failures instead. `unstable_rethrow` gets first
// refusal on every caught value, because `redirect()`, `notFound()` and the
// framework's dynamic-usage bailouts are thrown as errors but MEAN something —
// swallowing one would turn a working redirect into a false "we could not save
// that". The sentence the user reads is chosen by `preferenceSaveFailure`, which
// is unit-tested where it lives.
// ============================================================================

/** What a preference write tells the caller. */
export type PreferenceActionResult =
  | { success: true; changed: boolean }
  | { success: false; error: string };

const setPreferenceInputSchema = z.object({
  category: z.enum(notificationCategories),
  channel: z.enum(notificationChannels),
  enabled: z.boolean(),
});

export type SetPreferenceActionInput = z.infer<typeof setPreferenceInputSchema>;

const setDigestCadenceInputSchema = z.enum(digestCadences);

/**
 * Turn one category × channel on or off.
 *
 * Returns `changed: false` — successfully — when the effective value is already
 * what was asked for, and writes NOTHING in that case. That is not an
 * optimisation: N-005's rule is that an absent row means the category's coded
 * default, and seeding a row that merely restates today's default pins the user
 * to it forever (see `preferenceWriteIsNoop`). A no-op save is a success with
 * nothing to save, so the UI has nothing to undo and nothing to report.
 *
 * A category this caller is never served is REFUSED, for the reason the cadence
 * action refuses an oversight caller (#254, extended by the ruling of
 * 2026-08-09): the screen no longer offers those five rows, and an endpoint that
 * still accepted them would store a choice about a notification the user cannot
 * receive — a row nothing will ever read, on a decision they were never really
 * offered. The refusal is derived from `OVERSIGHT_ELIGIBLE_CATEGORIES` through
 * `audienceMayReceiveCategory`, so it cannot fall out of step with the delivery
 * gate that makes it true.
 */
export async function setNotificationPreferenceAction(
  input: SetPreferenceActionInput
): Promise<PreferenceActionResult> {
  const session = await requireSeat("self.write");
  const owner = preferenceOwnerFromSession(session);

  const parsed = setPreferenceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "That is not a setting we can save" };
  }

  try {
    const { category, channel, enabled } = parsed.data;

    // Same audience the page rendered the matrix with — see
    // `preferenceWriteIsNoop`. Asking the no-op question with the other
    // audience's defaults would discard a real change as "already that value".
    const audience = audienceForTenancy(session.user);

    // Asked BEFORE the rows are loaded: a refused category has nothing to
    // compare against, and a write that will not happen should not cost a query.
    if (!audienceMayReceiveCategory(audience, category)) {
      return { success: false, error: OVERSIGHT_INELIGIBLE_CATEGORY_NOTE };
    }

    const rows = await loadUserPreferences(owner);

    if (preferenceWriteIsNoop(rows, category, channel, enabled, audience)) {
      return { success: true, changed: false };
    }

    await setPreference(owner, { category, channel, enabled });

    refresh();

    return { success: true, changed: true };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[SETTINGS] saving a notification preference failed:", error);
    return preferenceSaveFailure(error);
  }
}

/**
 * Set how often the user's own open-items digest arrives (N-013).
 *
 * This is the ONLY digest cadence a user chooses. The oversight activity digest
 * (N-025) is fixed daily and is governed by a plant-side sharing toggle
 * (N-026) on another screen — nothing here decides what leaves the plant.
 *
 * An oversight recipient is REFUSED rather than served (#254). The screen no
 * longer offers them the control, but every export of a `"use server"` module
 * is a POSTable endpoint, and a cadence they can never observe is a stored
 * choice they never made — exactly the thing this track exists to stop. The
 * refusal says the same sentence the screen does.
 */
export async function setDigestCadenceAction(
  cadence: string
): Promise<PreferenceActionResult> {
  const session = await requireSeat("self.write");
  const owner = preferenceOwnerFromSession(session);

  const parsed = setDigestCadenceInputSchema.safeParse(cadence);
  if (!parsed.success) {
    return { success: false, error: "That is not a cadence we can save" };
  }

  try {
    if (audienceForTenancy(session.user) === "oversight") {
      return { success: false, error: OVERSIGHT_DIGEST_CADENCE_NOTE };
    }

    const rows = await loadUserPreferences(owner);

    if (digestCadenceWriteIsNoop(rows, parsed.data)) {
      return { success: true, changed: false };
    }

    await setDigestCadence(owner, parsed.data);

    refresh();

    return { success: true, changed: true };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[SETTINGS] saving the digest cadence failed:", error);
    return preferenceSaveFailure(error);
  }
}

// ----------------------------------------------------------------------------
// The bounce escape hatch (#324)
// ----------------------------------------------------------------------------
//
// A permanent bounce writes an `email_suppressions` row and every later send
// reads it, which is the whole point — one dead mailbox is otherwise one bounce
// a day against a sending domain that takes months to earn back. But suppression
// with no way out is a life sentence served by the recipient: the planter stops
// getting email and the only remedy is an operator running SQL against
// production.
//
// This is the self-service half, on the screen the recipient already owns. The
// admin half (`clearedByUserId` naming an actor) is what
// `email_suppressions_cleared_check` also admits, and it lands with the first
// admin surface that needs it.

/**
 * What the un-suppress control tells the caller.
 *
 * A TYPE, not a value. Every VALUE export of a `"use server"` module is a
 * published endpoint — the walk in `server-action-surface.test.ts` bans any
 * export that is not an `export async function` for exactly that reason — so the
 * clear's stored reason and its failure sentence live beside the write they
 * belong to, in `@/lib/notifications/channels/suppression`.
 */
export type SuppressionActionResult =
  | { success: true; cleared: boolean }
  | { success: false; error: string };

/**
 * Start sending email to the SESSION'S OWN address again.
 *
 * IT TAKES NO ADDRESS, and that is the whole ownership story. An actor or an
 * entity the actor implies is never a parameter (memory/invariants.md →
 * Authentication) — every export of a `"use server"` module is a POSTable
 * endpoint reachable with no UI, so an address parameter here would be an
 * un-suppress endpoint for anybody's mailbox, which is a deliverability weapon
 * pointed at the sending domain. The address comes from `verifySession()` and
 * from nowhere else.
 *
 * `clearedByUserId: null` is the self-service path — the address holder
 * re-verified, and there is no admin to name. `cleared_at` is what says the row
 * was cleared; the actor column never stood in for it.
 *
 * SESSION FIRST AND ABOVE THE `try`, like both actions above: a sessionless call
 * THROWS rather than being converted into a handled `{ success: false }`.
 *
 * `cleared: false` is a SUCCESS. Clearing an address that is not suppressed
 * writes nothing and the caller's intent — "this address should be mailable" —
 * already holds; the screen simply stops showing the notice.
 */
export async function clearMyEmailSuppressionAction(): Promise<SuppressionActionResult> {
  const session = await requireSeat("self.write");

  try {
    const cleared = await clearAddressSuppression({
      email: session.user.email,
      reason: SUPPRESSION_SELF_CLEAR_REASON,
      clearedByUserId: null,
    });

    // The notice is server-rendered from `isAddressSuppressed`, so the page has
    // to re-read to lose it — the same reconciliation the preference switches
    // get (memory/contracts/data-patterns.md).
    refresh();

    return { success: true, cleared: cleared > 0 };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[SETTINGS] clearing an email suppression failed:", error);
    return { success: false, error: SUPPRESSION_CLEAR_FAILED_MESSAGE };
  }
}

// ----------------------------------------------------------------------------
// Church timezone
// ----------------------------------------------------------------------------
//
// Whose plant this is is NOT an argument. The action takes an IANA id and
// nothing else; the church comes from the session. A planter can only ever
// change their own plant's zone, and that is a property of the signature
// rather than a check someone could delete.
//
// Planter-only, like the sharing toggle: a team member lives in the zone but
// does not choose it, and an oversight admin choosing a plant's display zone
// would be the setting authorising itself.
//
// Invalid ids are rejected by the parser, and again by the write helper, so
// a value `Intl` will not format cannot land.

export type TimeZoneActionResult =
  | { success: true; timeZone: string }
  | { success: false; error: string };

const churchTimeZoneSchema = z.string().min(1).max(64).refine(isValidTimeZone);

export async function setChurchTimeZoneAction(
  timeZone: string
): Promise<TimeZoneActionResult> {
  const session = await requireSeat("church.profile");

  const parsed = churchTimeZoneSchema.safeParse(timeZone);
  if (!parsed.success) {
    return { success: false, error: "That is not a timezone we can save" };
  }

  try {
    if (!session.user.churchId) {
      return { success: false, error: "Create your church plant first" };
    }

    const stored = await setChurchTimeZone(session.user.churchId, parsed.data);

    refresh();

    return { success: true, timeZone: stored };
  } catch (error) {
    unstable_rethrow(error);
    console.error("[SETTINGS] saving the church timezone failed:", error);
    return { success: false, error: "We could not save that timezone" };
  }
}
