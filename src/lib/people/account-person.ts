// ============================================================================
// THE PERSON ROW AN ACCOUNT IS, when the account gains a church (AS-013, #378).
//
// AN IMPORT-FREE LEAF, deliberately: it decides the VALUES and nothing about
// when or how they are written. The statement that writes them belongs to
// `churchCreationStatements` (`src/lib/onboarding/create-church.ts`), which is
// the one contract for "an account just gained a plant" — onboarding step 1 and
// invited registration both spread it whole, so both church-gain paths get this
// row from a single spelling and neither can drift from the other.
//
// WHY THE PLANTER NEEDS A PERSON ROW AT ALL. `ministry_teams.leader_id`, the
// meeting guest list and every team assignment reference `persons.id`, and the
// assignment dialog is fed by `listPeople`. Until this row existed the planter
// was the one member of their own plant who could not be put on a team — they
// staffed everyone but themselves.
// ============================================================================

import type { NewPerson, PersonStatus } from "@/db/schema";

/**
 * A person's name, taken from the account's single `name` field.
 *
 * `persons` stores two NOT NULL columns and `users.name` is one nullable one,
 * so something has to decide the split. First whitespace token is the given
 * name, the whole remainder is the family name — "Mary Anne Van Der Berg" keeps
 * four of its five words together rather than losing three.
 *
 * A ONE-WORD NAME KEEPS AN EMPTY `lastName`, and that is the honest answer
 * rather than a guess: the column is NOT NULL so it needs a value, and
 * inventing one would put a word on the planter's record they never typed.
 * They can correct both halves on their own profile.
 *
 * An account with NO name at all falls back to the address, because it is the
 * only other handle every account has — and a person row with an empty
 * `firstName` would render as a blank line in the assignment list.
 */
export function accountPersonName(
  name: string | null,
  email: string
): { firstName: string; lastName: string } {
  const words = (name ?? "").trim().split(/\s+/).filter(Boolean);

  if (words.length === 0) {
    return { firstName: email.split("@")[0] || email, lastName: "" };
  }

  return { firstName: words[0], lastName: words.slice(1).join(" ") };
}

/**
 * WHERE THE PLANTER STARTS IN THE PIPELINE, and why it is the top of it.
 *
 * `persons.status` is a RECRUITMENT pipeline — prospect → attendee → … →
 * leader — and it describes how far someone the plant is gathering has come.
 * The planter is not a recruit: they are the plant's lead from the moment the
 * plant exists, so `prospect` would put the person who owns the plant at the
 * bottom of their own funnel and every "new prospects" count would include
 * them.
 *
 * It is also the value that survives the team assignment this row exists for.
 * `autoAdvanceStatus` (`people/events.ts`) moves a person only from an exact
 * `from`, so `team.member.assigned` (core_group → launch_team) and
 * `team.leader.assigned` (launch_team → leader) both no-op here rather than
 * demoting them.
 */
const PLANTER_STATUS: PersonStatus = "leader";

/**
 * The full row, ready for the church-gain batch.
 *
 * `createdBy` is the account itself: the row exists because that account
 * created (or was invited into) this plant, and there is no other actor to
 * name. `source` stays NULL — the source vocabulary is about how a CONTACT
 * reached the plant, and none of its seven words is true of the planter.
 *
 * NOT `createPerson()`. That writer awaits an insert, emits `person.created`
 * and logs a `person_created` timeline activity; this row is minted inside a
 * `db.batch` that must commit or roll back with the church, so it cannot await
 * anything. It writes no timeline activity by design — an activity feed on the
 * planter's own record opening with "somebody added you" is noise about a row
 * nobody typed in. `createPerson` stays the ONE writer of that activity
 * (`memory/invariants.md` → People).
 */
export function accountPersonValues(account: {
  userId: string;
  churchId: string;
  name: string | null;
  email: string;
}): NewPerson {
  return {
    churchId: account.churchId,
    userId: account.userId,
    createdBy: account.userId,
    email: account.email,
    status: PLANTER_STATUS,
    ...accountPersonName(account.name, account.email),
  };
}
