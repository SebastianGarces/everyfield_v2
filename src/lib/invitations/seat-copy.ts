// ============================================================================
// WHAT AN INVITATION MAKES SOMEBODY, WRITTEN FOR A HUMAN — one table, every surface
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
// The table has no comparison in it at all. It is keyed by what the invitation
// grants, so
// adding a third invitable seat is a compile error here (`satisfies Record<
// InvitedAsKey, …>`) rather than a silent fall-through to the `member` arm
// that every one of those ternaries would have given it.
//
// COACH IS A THIRD KEY, NOT A SECOND TABLE (#496). A coach is emphatically not
// a seat — it is a `coach_assignments` row and `users.seat` stays NULL — but
// what the email has to say is the same four sentences with different nouns, so
// a parallel template would be a copy of this one that drifts. What keeps the
// distinction honest is that `InvitedAs` is a UNION whose coach arm carries no
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
import type { SeatTenancyType } from "@/lib/auth/tenancy";

/**
 * WHAT AN INVITATION MAKES SOMEBODY, as the two things it can be.
 *
 * A union rather than `seat: InvitableSeat | null`, and for the same reason the
 * database writes `user_invitations_seat_check`: a coach has no seat, so a shape
 * that let one be read off a coach would be a shape that can lie.
 */
export type InvitedAs =
  | { kind: "seat"; seat: InvitableSeat }
  | { kind: "coach" };

/**
 * THE KEY IS THE PAIR — what they are invited to be, AND where (#500).
 *
 * A flat five-entry union rather than a nested table, because only the seats
 * fork: an Admin in a church plant works on people, meetings and tasks, and an
 * Admin in a sending church or a network works on a PORTFOLIO and can staff the
 * org. Those are different sentences, and a table keyed on the seat alone would
 * have had to pick one of them and be wrong for the other half of the product.
 *
 * The two org kinds share one entry deliberately: a sending church's Admin and
 * a network's Admin do the same things, over a different portfolio, and the
 * org's own NAME is what tells the reader which they are joining.
 */
export type InvitedAsKey = InvitableSeat | "coach" | `org_${InvitableSeat}`;

/**
 * The table's key — the one place the union and the tenancy are flattened into
 * one word.
 *
 * A coach is a coach wherever the row came from: `coach.assignment.manage` is
 * plant-only, so a coach invitation from an org cannot exist, and the tenancy
 * is not consulted for one.
 */
export function invitedAsKey(
  invitedAs: InvitedAs,
  tenancyType: SeatTenancyType
): InvitedAsKey {
  if (invitedAs.kind === "coach") return "coach";
  return tenancyType === "church"
    ? invitedAs.seat
    : (`org_${invitedAs.seat}` as const);
}

export const INVITED_AS_COPY = {
  admin: {
    /** The name, capitalised the way the product writes it. */
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
  // ── The same two seats, held in a sending church or a network (AS-005/AS-007,
  //    #500). The labels and the article are the seat's own; what changes is
  //    what the seat REACHES, because an org's subject is its portfolio of
  //    plants rather than a congregation.
  org_admin: {
    label: "Admin",
    article: "an",
    subjectTail: "join them on EveryField",
    accepting:
      "you can see how every church plant they oversee is doing, and invite other people onto the team",
    cta: "Accept and create your account",
  },
  org_member: {
    label: "Member",
    article: "a",
    subjectTail: "join them on EveryField",
    // THE READ IS THE WHOLE GRANT, and the sentence says so. An org Member sees
    // everything the org's Owner sees (ruling 185 (3)) and changes nothing —
    // stating the limit here is what stops the invitee expecting controls the
    // screen will not show them.
    accepting:
      "you can see how every church plant they oversee is doing — it is a read-only seat, so nothing you do changes their work",
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
      "you can read the plant's people, meetings, teams and tasks — coaching is read-only, so nothing you do changes the plant's own work",
    cta: "Accept the invitation",
  },
} as const satisfies Record<
  InvitedAsKey,
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
 * stored beside it, so the two spellings of one entry cannot drift apart.
 */
export function invitedAsWithArticle(
  invitedAs: InvitedAs,
  tenancyType: SeatTenancyType
): string {
  const copy = INVITED_AS_COPY[invitedAsKey(invitedAs, tenancyType)];
  return `${copy.article} ${copy.label}`;
}

/**
 * The reader's word for the KIND of thing they are being invited into — the
 * noun the register banner puts beside the org's name.
 *
 * It is not `scopeLabelForOrgType` (`@/lib/oversight/org-label`) and cannot be:
 * that table has two entries and answers for an oversight org only, while this
 * one has to name a church plant too. The two overlap on two words and are
 * reconciled by `seat-copy.test.ts` rather than by an import, because this file
 * is an import-free leaf feeding a client bundle.
 */
export const TENANCY_NOUN = {
  church: "church plant",
  sending_church: "sending church",
  network: "network",
} as const satisfies Record<SeatTenancyType, string>;
