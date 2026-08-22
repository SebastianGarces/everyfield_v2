"use server";

import { requireSeat } from "@/lib/auth/seats";
import { refresh } from "next/cache";
import { unstable_rethrow } from "next/navigation";

import {
  removeUserAvatar,
  uploadUserAvatar,
  type AvatarOutcome,
} from "@/lib/auth/avatar";
import {
  confirmEmailChange,
  requestEmailChange,
  type EmailChangeConfirmOutcome,
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
): Promise<EmailChangeConfirmOutcome> {
  const { user } = await requireSeat("self.write");

  try {
    const outcome = await confirmEmailChange({
      actor: user,
      token: typeof token === "string" ? token : "",
      ip: await getRequestIp(),
    });

    if (outcome.ok) refresh();

    return outcome;
  } catch (error) {
    unstable_rethrow(error);
    console.error("[ACCOUNT] confirming an email change failed:", error);
    return { ok: false, message: "We could not confirm that address" };
  }
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
