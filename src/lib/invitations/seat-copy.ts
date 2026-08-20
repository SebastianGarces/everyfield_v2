// ============================================================================
// HOW AN INVITED SEAT IS WRITTEN FOR A HUMAN — one table, every surface (#495).
//
// A LOOKUP TABLE AND NOT A COMPARISON, deliberately. Four places needed the
// words for a seat — the invitation email's preheader, its opening sentence,
// its "what accepting means" paragraph and the register form's banner — and
// each of them had reached for `seat === "admin" ? … : …`. `seat-guard.test.ts`
// bans that shape outright (`memory/invariants.md` → Authentication: "a seat is
// compared by hand outside the permissions module"), and the ban is right even
// where the branch is only copy: a reader cannot tell an authority rule from a
// noun by looking at it, so a pattern that let the noun through would let the
// rule through too.
//
// The table has no comparison in it at all. It is keyed by the seat, so adding
// a third invitable seat is a compile error here (`satisfies Record<
// InvitableSeat, …>`) rather than a silent fall-through to the `member` arm
// that every one of those ternaries would have given it.
//
// IT GRANTS NOTHING AND DECIDES NOTHING. This is vocabulary; the permissions
// table (`@/lib/auth/seat-rules`) is where a seat means anything, and nothing
// here may grow a field a caller could branch authority on.
//
// AN IMPORT-FREE LEAF, on the same footing as `./register-path`: the register
// form is a client component, so anything this module imported would be pulled
// into that bundle behind it. The one import is a TYPE and is erased.
// ============================================================================

import type { InvitableSeat } from "@/db/schema/user-invitation";

export const INVITED_SEAT_COPY = {
  admin: {
    /** The seat's name, capitalised the way the product writes it. */
    label: "Admin",
    /** Its indefinite article, kept beside the label rather than inferred. */
    article: "an",
    /** What the invitee may do, second person — the email's "what accepting means". */
    accepting:
      "you can work on the plant's people, meetings, teams, tasks and messages alongside its Owner",
  },
  member: {
    label: "Member",
    article: "a",
    accepting:
      "you can see the plant's work and take part in what is assigned to you",
  },
} as const satisfies Record<
  InvitableSeat,
  { label: string; article: string; accepting: string }
>;

/**
 * "an Admin" / "a Member" — DERIVED from the table rather than stored beside
 * it, so the two spellings of one seat cannot drift apart.
 */
export function invitedSeatWithArticle(seat: InvitableSeat): string {
  const copy = INVITED_SEAT_COPY[seat];
  return `${copy.article} ${copy.label}`;
}
