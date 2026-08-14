import { ROLE_ALREADY_FILLED_MESSAGE } from "@/lib/ministry-teams/membership-copy";

// ============================================================================
// #409 D1 — WHERE a failed assignment is delivered, decided once, in the open.
//
// THE DEFECT THIS MODULE EXISTS FOR. `MemberAssignDialog` used to hold every
// refusal in one place: `setError(...)`, read by an `<Alert>` inside
// `<DialogContent>`. That is the wrong place for exactly one of them. The seat
// refusal is the only failure that means THE PAGE UNDERNEATH IS STALE, so the
// same handler calls `router.refresh()` — and `members-roles-tab.tsx` renders
// `<MemberAssignDialog>` only in the role card's OPEN arm. The refresh returns
// the seat as Filled, the Open arm stops rendering, and the dialog holding the
// sentence unmounts with it. Measured on the preview built from 16e9cf5 with a
// 40 ms DOM sampler: "Role is already filled" lived in `[role=dialog]` from
// t=21641 ms to t=21761 ms — four samples, ~120 ms — and the dialog was gone at
// t=21803 ms. The write was correct (the loser wrote nothing, the role kept one
// active holder); the planter simply never got to read why.
//
// THE FIX IS THE DESTINATION, NOT THE GUARD. The refresh is right and must not
// be delayed behind a dismissal — deferring it re-creates the stale roles tab
// it exists to destroy. So the sentence moves OUT of the subtree the refresh
// unmounts and into the `<Toaster>` `src/app/layout.tsx` mounts at the root,
// which is a sibling of the whole page and survives any re-render below it.
//
// WHY THE DECISION IS A FUNCTION AND NOT AN `if` IN THE HANDLER. An `if` inside
// an async click handler in a `"use client"` component that imports a server
// action is unreachable from a test — this repo's suite is `node:test` + tsx
// with no DOM, and the dialog's import of `@/app/(dashboard)/teams/actions`
// opens a database connection at import time. That is precisely why this branch
// shipped with no assertion above the server-side refusal. Pulled out here
// it is a pure function over a string, with no imports but the copy leaf, and
// `assign-refusal.test.ts` runs it on every `pnpm test`.
// ============================================================================

/** What the toaster is asked to raise. `null` when nothing is toasted. */
export interface RefusalToast {
  /** The ruled sentence, verbatim — never re-worded, never truncated. */
  message: string;
  /** Why the seat changed under them. Context, not an instruction. */
  description: string;
  /**
   * How long it stays. The refusal is only readable if it outlives the refresh
   * that fires beside it, and a refresh is a server round-trip: sonner's 4 s
   * default leaves a planter who looked away with nothing. Ten seconds, with
   * the root `<Toaster closeButton />` to dismiss it early and sonner's own
   * pause-on-hover/focus to hold it open while it is being read.
   */
  durationMs: number;
}

/** Where one failed `assignMemberAction` call is delivered. */
export interface AssignRefusalDelivery {
  /** Raised through the root `<Toaster>`, outside every subtree that re-renders. */
  toast: RefusalToast | null;
  /** Kept in the dialog's `<Alert>` — only for refusals whose dialog survives. */
  inline: string | null;
  /** Close the dialog: the Open seat it was opened beside no longer exists. */
  closeDialog: boolean;
  /** Refresh the roles tab so the occupant is on screen beside the sentence. */
  refreshRoles: boolean;
}

/**
 * Wording for the seat refusal's second line. It is here rather than in
 * `@/lib/ministry-teams/membership-copy` because it is not the ruled sentence:
 * #409 D1 fixes `ROLE_ALREADY_FILLED_MESSAGE` and nothing else, and the copy
 * leaf is shared with the SERVICE, which throws the sentence into contexts that
 * have no roles tab underneath them.
 */
export const ROLE_ALREADY_FILLED_DESCRIPTION =
  "Someone filled it while this page was open. The team now shows who holds it.";

// THIS SENTENCE ASSERTS SOMEBODY ELSE, so it is only ever true if the service
// reserves `ROLE_ALREADY_FILLED_MESSAGE` for a seat somebody else took. It does:
// `assignMember`'s loser branch reads the seat's active holder and answers a
// same-person double-submit with `PERSON_ALREADY_ASSIGNED_MESSAGE` instead
// (#411 round 1). Before that read existed the double-submit landed here and
// this description told a planter a stranger had taken the seat they had just
// filled themselves. If the service ever stops naming the holder, delete this
// description before restoring anything else.

/** See `RefusalToast.durationMs`. Exported so the test can pin the floor. */
export const ROLE_ALREADY_FILLED_TOAST_MS = 10_000;

/**
 * Decide where a failed assignment is shown.
 *
 * The seat refusal — and ONLY the seat refusal — is toasted, because it is the
 * only one accompanied by a refresh that unmounts the dialog. Every other
 * failure (a validation message, "Failed to assign member", the person-level
 * duplicate) leaves the roles tab exactly as it was, so its dialog is still
 * standing and the inline `<Alert>` is the better home: it sits beside the
 * person the planter picked, and Confirm is still one click away.
 */
export function assignRefusalDelivery(error: string): AssignRefusalDelivery {
  if (error === ROLE_ALREADY_FILLED_MESSAGE) {
    return {
      toast: {
        message: error,
        description: ROLE_ALREADY_FILLED_DESCRIPTION,
        durationMs: ROLE_ALREADY_FILLED_TOAST_MS,
      },
      // Deliberately null: the node that would render it is about to unmount,
      // and a second copy of the sentence in a dying subtree is what made this
      // look delivered when it was not.
      inline: null,
      closeDialog: true,
      refreshRoles: true,
    };
  }

  return {
    toast: null,
    inline: error,
    closeDialog: false,
    refreshRoles: false,
  };
}
