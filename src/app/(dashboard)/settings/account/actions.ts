"use server";

import { requireSeat } from "@/lib/auth/seats";
import { refresh, revalidatePath } from "next/cache";
import { redirect, unstable_rethrow } from "next/navigation";

import {
  removeUserAvatar,
  uploadUserAvatar,
  type AvatarOutcome,
} from "@/lib/auth/avatar";
import {
  confirmEmailChange,
  requestEmailChange,
  type EmailChangeConfirmOutcome,
  type EmailChangeConfirmRefusal,
  type EmailChangeRequestOutcome,
} from "@/lib/auth/email-change";
import {
  changeOwnPassword,
  type PasswordChangeOutcome,
} from "@/lib/auth/password-change";
import { getRequestIp } from "@/lib/auth/rate-limit";

// ============================================================================
// The Account section's writes — CS-002 / CS-003 / CS-004 / CS-005 (#616, #617).
//
// ----------------------------------------------------------------------------
// WHOSE ACCOUNT THIS IS IS NOT AN ARGUMENT
// ----------------------------------------------------------------------------
//
// No export here accepts a user id, an address to change FROM, or a password
// hash. Every one takes the values the reader TYPED — or, for the picture, the
// bytes they CHOSE — and nothing else; the actor is minted from
// `requireSeat("self.write")` and handed to the logic layer as one object. That
// is the whole ownership story, and it is a property of the signatures rather
// than a check somebody could delete — the same shape the preference writes next
// door take, and the same reason (`memory/invariants.md` → Authentication: an
// entity implied by the actor is not an argument either).
//
// The picture is the sharpest case: `uploadAvatarAction` takes a `FormData` bag
// whose keys a POST chooses, and the only thing it reads out of one is the file.
// A storage key from that bag would be a client-supplied key, and the avatar
// route trusts the stored key precisely because nothing client-supplied can
// reach it — the same reason `personUpdateSchema` deliberately has no
// `photoUrl` field (P-024a).
//
// `self.write` IS THE VERB for all five: "a write whose row is keyed by the
// caller's own user id and reaches no other account" (`@/lib/auth/seat-rules`)
// describes an account's own address, its own password and its own picture
// exactly — the picture's write is one UPDATE on `users` by id. It carries
// no seat set and `tenancy: "any"`, which is what the Account section needs —
// it is the one section every account sees, including a coach who holds no seat
// in any tenancy at all.
//
// ----------------------------------------------------------------------------
// SESSION FIRST, AND ABOVE THE `try`
// ----------------------------------------------------------------------------
//
// The guard is line one of every export, ahead of any parse, and OUTSIDE the
// `try` — so a sessionless POST THROWS rather than being converted by a catch
// into a well-formed `{ ok: false }` (#508, `memory/invariants.md` →
// Authentication). Nothing here needs `rethrowUnauthorized`, because nothing
// here puts the mint inside a `try`.
//
// ----------------------------------------------------------------------------
// THE PARSE LIVES IN THE LOGIC LAYER, NOT IN A ZOD SCHEMA HERE
// ----------------------------------------------------------------------------
//
// Deliberate, and it is the field-level refusal that decides it. CS-002 and
// CS-003 both ask that a failed save NAME THE FIELD, and every refusal these
// flows can produce — a malformed address, an address that is already yours, a
// short password, a wrong current password, a password you already use — is a
// field-level sentence. A schema here would answer the first two of those and
// hand the rest back in a different shape, so the form would have two ways to
// learn the same thing. One `{ ok: false, field, message }` union answers them
// all, and it is unit-testable without Next.
//
// ----------------------------------------------------------------------------
// WHY `refresh()` AND NOT `revalidatePath`
// ----------------------------------------------------------------------------
//
// The Account section renders the signed-in identity, and the sidebar renders
// it too. `refresh()` re-renders the current tree INCLUDING its layouts, so the
// address in the chrome — and the picture beside it — reconciles with the same
// server state the write just produced (memory/contracts/data-patterns.md).
// Nothing here renders in a layout only, so there is no `revalidatePath` that
// would do the job: the picture in the sidebar and the picture in the modal are
// one render away from each other.
//
// ONE EXCEPTION, and it is the one whose reader LEAVES: `confirmEmailChangeAction`
// redirects instead, so the tree it would refresh is the tree the redirect
// replaces (`memory/invariants.md` → Client/Server Data Synchronization: an
// action whose only caller leaves keeps the destination fresh and drops the
// refresh). See its body for what the refresh cost when it was there.
// ============================================================================

/**
 * Put a chosen image on this account, replacing whatever was there (CS-004).
 *
 * ONE ACTION FOR UPLOAD AND REPLACE, because they are one write. "Replace"
 * differs only in whether a row already named an object, which is something the
 * writer discovers rather than something the caller declares — and a caller who
 * declared it could declare it wrongly.
 *
 * The `FormData` carries the file and nothing else that is read. See the header:
 * a storage key in that bag would be a key the client chose.
 */
export async function uploadAvatarAction(
  formData: FormData
): Promise<AvatarOutcome> {
  const { user } = await requireSeat("self.write");

  try {
    const file = formData.get("avatar");
    if (!(file instanceof File)) {
      return { ok: false, message: "Choose an image to upload." };
    }

    const outcome = await uploadUserAvatar({ actor: user, file });

    // The sidebar shows the picture too, so the whole tree re-reads.
    if (outcome.ok) refresh();

    return outcome;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[ACCOUNT] uploading a profile picture failed:", error);
    return { ok: false, message: "We could not save that picture" };
  }
}

/**
 * Take the picture off this account, so the initials render in its place
 * (CS-004).
 *
 * IT TAKES NOTHING AT ALL. Which account loses its picture comes from the
 * session, and the key of the object to delete comes from the row — never from
 * the caller, who could otherwise name an object that is not theirs and have the
 * server delete it.
 */
export async function removeAvatarAction(): Promise<AvatarOutcome> {
  const { user } = await requireSeat("self.write");

  try {
    const outcome = await removeUserAvatar({ actor: user });

    if (outcome.ok) refresh();

    return outcome;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[ACCOUNT] removing a profile picture failed:", error);
    return { ok: false, message: "We could not remove that picture" };
  }
}

/**
 * Ask to move this account to a new address (CS-002).
 *
 * `users.email` is NOT touched here — the reader keeps signing in with the old
 * address until the link in the new mailbox is opened. See
 * `@/lib/auth/email-change` for why the new address is not checked against
 * `users` at this point, and why asking demands the current password.
 */
export async function requestEmailChangeAction(input: {
  newEmail: string;
  currentPassword: string;
}): Promise<EmailChangeRequestOutcome> {
  const { user } = await requireSeat("self.write");

  try {
    const outcome = await requestEmailChange({
      actor: user,
      requestedEmail: String(input?.newEmail ?? ""),
      currentPassword: String(input?.currentPassword ?? ""),
      ip: await getRequestIp(),
    });

    // The section renders the live request ("check your inbox"), so the page
    // has to re-read to show it.
    if (outcome.ok) refresh();

    return outcome;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[ACCOUNT] requesting an email change failed:", error);
    return {
      ok: false,
      field: null,
      message: "We could not send that confirmation email",
    };
  }
}

/**
 * Redeem a confirmation token and make the new address the login identifier
 * (CS-002).
 *
 * IT TAKES THE TOKEN AND NOTHING ELSE. Which account is being moved comes from
 * the session, and the token is refused unless it was issued to that same
 * account — so the two halves the change needs (read the new mailbox, hold the
 * account) are both proven, and a forwarded link is inert.
 */
export async function confirmEmailChangeAction(
  token: string
): Promise<EmailChangeConfirmRefusal> {
  const { user } = await requireSeat("self.write");

  let outcome: EmailChangeConfirmOutcome;

  try {
    outcome = await confirmEmailChange({
      actor: user,
      token: typeof token === "string" ? token : "",
      ip: await getRequestIp(),
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[ACCOUNT] confirming an email change failed:", error);
    return { ok: false, message: "We could not confirm that address" };
  }

  // SUCCESS LEAVES, AND THAT IS WHY THIS ONE DOES NOT `refresh()` (#658).
  //
  // The address has moved, so the URL the press came from is a spent token and
  // the identity the tree was rendered for is gone. A redirect answers both:
  // the reader lands on a page that reads the NEW address out of the session,
  // and a reload of that page says the same thing instead of the dead-link
  // sentence a spent `?token=` earns.
  //
  // It also takes the outcome off the client, which is the half that was
  // BROKEN. The success sentence used to live in `useActionState`, and the
  // update that would have shown it shared a transition with the tree patch
  // `refresh()` streamed into this response — a transition that never
  // committed. The swap landed, the payload arrived carrying the new address,
  // and the button sat on "Confirming…" forever, while the refusal branch of
  // the same component cleared in ~2s.
  //
  // DO NOT READ THAT AS "a server `refresh()` strands a press". It does not, in
  // general: `requestEmailChangeAction` above calls `refresh()` from the same
  // shape and renders its "check your inbox" sentence correctly — driven on
  // #658's preview to be sure. What differs at this call site was not worth
  // bisecting a framework race to name, because the fix does not depend on the
  // answer: a redirect is rendered by the server, so no sentence a reader
  // depends on waits on a transition to commit. If a third call site strands,
  // these two are the pair to compare.
  //
  // …AND THE DESTINATION IS FRESHENED RATHER THAN THE ROUTE BEING LEFT. A
  // client-side navigation REUSES the layout segments both routes share, and
  // the sidebar that renders the address is in exactly such a layout — measured
  // on this branch's preview, the redirect alone landed on a page reading "you
  // now sign in as 658-gate@…" beside a sidebar still showing
  // planter1@everyfield.app. `"layout"` because the identity is chrome: it is
  // on every screen this account can reach, not on the one it landed on
  // (`memory/invariants.md` → Client/Server Data Synchronization: an action
  // whose only caller LEAVES keeps the revalidate and drops the refresh).
  //
  // OUTSIDE THE `try` ON PURPOSE: `redirect()` reports itself by throwing, and
  // the catch above would classify it as a failed confirmation — the one answer
  // this endpoint must never give about a change that committed.
  if (outcome.ok) {
    revalidatePath("/", "layout");
    redirect("/verify-email/confirmed");
  }

  return outcome;
}

/**
 * Rotate this account's password, given its current one (CS-003).
 *
 * The caller's own session is the one that survives — every other session this
 * account holds is ended in the same batch as the rotation. See
 * `@/lib/auth/password-change`.
 */
export async function changePasswordAction(input: {
  currentPassword: string;
  newPassword: string;
}): Promise<PasswordChangeOutcome> {
  const { user, session } = await requireSeat("self.write");

  try {
    return await changeOwnPassword({
      actor: user,
      currentSessionId: session.id,
      currentPassword: String(input?.currentPassword ?? ""),
      newPassword: String(input?.newPassword ?? ""),
      ip: await getRequestIp(),
    });
  } catch (error) {
    unstable_rethrow(error);
    console.error("[ACCOUNT] changing a password failed:", error);
    return {
      ok: false,
      field: null,
      message: "We could not change your password",
    };
  }
}
