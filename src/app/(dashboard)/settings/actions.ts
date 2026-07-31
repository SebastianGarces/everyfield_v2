"use server";

import { refresh } from "next/cache";
import { z } from "zod";

import { verifySession } from "@/lib/auth/session";
import {
  digestCadences,
  notificationCategories,
  notificationChannels,
} from "@/lib/notifications/categories";
import {
  digestCadenceWriteIsNoop,
  loadUserPreferences,
  preferenceOwnerFromSession,
  preferenceWriteIsNoop,
  setDigestCadence,
  setPreference,
} from "@/lib/notifications/preferences";

// ============================================================================
// The preferences screen's writes (N-006, Screen 2).
//
// ----------------------------------------------------------------------------
// Whose preferences these are is NOT an argument
// ----------------------------------------------------------------------------
//
// Neither action accepts a user id, and neither could usefully be given one:
// every write goes through a `PreferenceOwner`, a branded type mintable only by
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
 */
export async function setNotificationPreferenceAction(
  input: SetPreferenceActionInput
): Promise<PreferenceActionResult> {
  const parsed = setPreferenceInputSchema.safeParse(input);
  if (!parsed.success) {
    return { success: false, error: "That is not a setting we can save" };
  }

  const owner = preferenceOwnerFromSession(await verifySession());
  const rows = await loadUserPreferences(owner);

  const { category, channel, enabled } = parsed.data;

  if (preferenceWriteIsNoop(rows, category, channel, enabled)) {
    return { success: true, changed: false };
  }

  await setPreference(owner, { category, channel, enabled });

  refresh();

  return { success: true, changed: true };
}

/**
 * Set how often the user's own open-items digest arrives (N-013).
 *
 * This is the ONLY digest cadence a user chooses. The oversight activity digest
 * (N-025) is fixed daily and is governed by a plant-side sharing toggle
 * (N-026) on another screen — nothing here decides what leaves the plant.
 */
export async function setDigestCadenceAction(
  cadence: string
): Promise<PreferenceActionResult> {
  const parsed = setDigestCadenceInputSchema.safeParse(cadence);
  if (!parsed.success) {
    return { success: false, error: "That is not a cadence we can save" };
  }

  const owner = preferenceOwnerFromSession(await verifySession());
  const rows = await loadUserPreferences(owner);

  if (digestCadenceWriteIsNoop(rows, parsed.data)) {
    return { success: true, changed: false };
  }

  await setDigestCadence(owner, parsed.data);

  refresh();

  return { success: true, changed: true };
}
