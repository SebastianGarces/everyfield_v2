// ============================================================================
// HOW AN INVITED ROLE IS WRITTEN FOR A HUMAN — one table, every surface
// (#495, widened for coach by #496).
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
// The table has no comparison in it at all. It is keyed by the invited role, so
// adding a third invitable seat is a compile error here (`satisfies Record<
// InvitedRoleKey, …>`) rather than a silent fall-through to the `member` arm
// that every one of those ternaries would have given it.
//
// COACH IS A THIRD KEY, NOT A SECOND TABLE (#496). A coach is emphatically not
// a seat — it is a `coach_assignments` row and `users.seat` stays NULL — but
// what the email has to say is the same four sentences with different nouns, so
// a parallel template would be a copy of this one that drifts. What keeps the
// distinction honest is that `InvitedRole` is a UNION whose coach arm carries no
// seat at all, so no caller can read a seat off a coach.
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

/**
 * WHAT AN INVITATION MAKES SOMEBODY, as the two things it can be.
 *
 * A union rather than `seat: InvitableSeat | null`, and for the same reason the
 * database writes `user_invitations_seat_check`: a coach has no seat, so a shape
 * that let one be read off a coach would be a shape that can lie.
 */
export type InvitedRole =
  | { kind: "seat"; seat: InvitableSeat }
  | { kind: "coach" };

export type InvitedRoleKey = InvitableSeat | "coach";

/** The table's key for a role — the one place the union is flattened. */
export function invitedRoleKey(role: InvitedRole): InvitedRoleKey {
  return role.kind === "coach" ? "coach" : role.seat;
}

export const INVITED_ROLE_COPY = {
  admin: {
    /** The role's name, capitalised the way the product writes it. */
    label: "Admin",
    /** Its indefinite article, kept beside the label rather than inferred. */
    article: "an",
    /** Completes "<Plant> invited you to …" in the subject line. */
    subjectTail: "join them on EveryField",
    /** What the invitee may do, second person — the email's "what accepting means". */
    accepting:
      "you can work on the plant's people, meetings, teams, tasks and messages alongside its Owner",
    /** The button. A seat invitation is answered by registering; a coach one may not be. */
    cta: "Accept and create your account",
  },
  member: {
    label: "Member",
    article: "a",
    subjectTail: "join them on EveryField",
    accepting:
      "you can see the plant's work and take part in what is assigned to you",
    cta: "Accept and create your account",
  },
  coach: {
    label: "Coach",
    article: "a",
    subjectTail: "coach their church plant on EveryField",
    // READ, AND SAID AS A LIMIT RATHER THAN LEFT TO BE DISCOVERED. AS-008 gives
    // a coach the plant's own records and no write anywhere, so the sentence
    // that describes the reach also has to describe its edge.
    accepting:
      "you can read the plant's people, meetings, teams and tasks — coaching is a reading role, so nothing you do changes the plant's own work",
    cta: "Accept the invitation",
  },
} as const satisfies Record<
  InvitedRoleKey,
  {
    label: string;
    article: string;
    subjectTail: string;
    accepting: string;
    cta: string;
  }
>;

/**
 * "an Admin" / "a Member" / "a Coach" — DERIVED from the table rather than
 * stored beside it, so the two spellings of one role cannot drift apart.
 */
export function invitedRoleWithArticle(role: InvitedRole): string {
  const copy = INVITED_ROLE_COPY[invitedRoleKey(role)];
  return `${copy.article} ${copy.label}`;
}
