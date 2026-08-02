"use server";

import { redirect } from "next/navigation";

import { UNSUBSCRIBE_CONFIRMATION_PATH } from "@/lib/notifications/channels/email";
import {
  applyEmailOptIn,
  applyEmailOptOut,
  type UnsubscribeResult,
} from "@/lib/notifications/channels/unsubscribe";

// ============================================================================
// The confirmation page's two writes (N-007, ruled 2026-08-01).
//
// This is where the opt-out actually happens. The emailed link's GET renders
// the page and changes nothing; the reader presses a button and THAT posts —
// which is what makes a mail scanner incapable of unsubscribing anyone, since a
// scanner fetches URLs and does not submit forms.
//
// Two actions, not one action with a direction flag, because the two are two
// different capabilities:
//
//   - `confirmUnsubscribeAction` spends the EMAILED token, which is
//     disable-only and lives 180 days.
//   - `undoUnsubscribeAction` spends an `enable` token minted server-side when
//     this page rendered, which lives one hour and was never mailed to anyone.
//
// Neither action takes a user, a category, a channel or a direction from the
// form. `token` is the whole input; everything else is sealed inside it.
//
// They are Server Actions rather than route handlers so the post is same-origin
// and `src/proxy.ts`'s Origin/Host CSRF check applies in full. The RFC 8058
// exemption is scoped to the API route a mail client posts to, and nothing on
// this page relies on it.
// ============================================================================

/**
 * Back to the page, carrying the EMAILED token so it can re-read the subject.
 *
 * The opt-out's result also carries the freshly minted undo token, and it rides
 * the redirect as `undo` — the ONLY way a render ever gets one. Rendering mints
 * nothing (ruled 2026-08-01): if it did, any holder of the 180-day emailed link
 * could refresh an already-off page into a fresh re-enable capability. The
 * `undo` param is short-lived (~1h), single-purpose, and strictly less
 * sensitive than the emailed token already in the same URL. A spent undo is
 * not re-carried: the redirect after a successful opt-in has no `undo`.
 */
function backToConfirmation(
  result: UnsubscribeResult,
  emailedToken: string,
  resubscribed: boolean
): never {
  const destination = new URL(
    UNSUBSCRIBE_CONFIRMATION_PATH,
    "http://localhost"
  );

  if (result.status === "ok") {
    if (emailedToken) destination.searchParams.set("token", emailedToken);
    // Distinguishes "you just turned this back on" from "you arrived here and
    // it is on" — both are `enabled: true`, and they want different copy.
    if (resubscribed) destination.searchParams.set("resubscribed", "1");
    if (result.subject.undoToken) {
      destination.searchParams.set("undo", result.subject.undoToken);
    }
  } else {
    console.warn(
      `[notifications/unsubscribe] refused a token from the confirmation page: ${result.reason}`
    );
  }

  // Relative, so it works on every deployment host without knowing which one.
  redirect(`${destination.pathname}${destination.search}`);
}

/** Turn this category's email off. Spends the emailed, disable-only token. */
export async function confirmUnsubscribeAction(
  formData: FormData
): Promise<void> {
  const token = String(formData.get("token") ?? "");
  backToConfirmation(await applyEmailOptOut(token), token, false);
}

/**
 * Turn it back on. Spends the short-lived undo token; the emailed token rides
 * along only so the page can re-read the subject afterwards, and is never what
 * authorises the write.
 */
export async function undoUnsubscribeAction(formData: FormData): Promise<void> {
  const emailedToken = String(formData.get("token") ?? "");
  const undoToken = String(formData.get("undoToken") ?? "");
  backToConfirmation(await applyEmailOptIn(undoToken), emailedToken, true);
}
