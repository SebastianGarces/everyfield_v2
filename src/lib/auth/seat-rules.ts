// ============================================================================
// THE SEAT RULES, AS AN IMPORT-FREE LEAF.
//
// Two seat sets stated as DATA, one table naming which set each verb belongs
// to, and the two predicates that read them. `requireSeat` — the guard the
// actions call — is next door in `./seats`, and the split is the whole point of
// this file: `requireSeat` has to mint an actor, so `./seats` opens with
// `import { verifySession } from "./session"`, whose module scope calls
// `neon(process.env.DATABASE_URL!)`.
//
// SO ANY MODULE THAT ONLY WANTS TO KNOW *WHETHER AN ACCOUNT MAY DO A THING*
// PAID A DATABASE CONNECTION FOR IT. `src/lib/onboarding/declare-journey.ts`
// says in its own docblock that its rules "can be driven by a test through
// `DeclareJourneyDeps` without a request or a database"; #498 pointed it at
// `./seats` and that sentence stopped being true — `import(
// "@/lib/onboarding/declare-journey")` with no `DATABASE_URL` threw. This is
// the same seam `./tenancy` keeps for the same reason, and the reason
// `@/lib/oversight/org-label` and `@/lib/invitations/register-path` exist.
//
// `./tenancy` is the only value import allowed here, and it is itself an
// import-free leaf. NOTHING in this file may gain an edge that reaches `@/db`,
// directly or transitively — `seat-leaf.test.ts` fails on one, and `./seats`
// deliberately does NOT re-export this module, because a second import path
// through a database-importing module is exactly the hole the seam closes.
// ============================================================================

import type { UserSeat } from "@/db/schema";
import {
  isChurchLevelUser,
  isOversightUser,
  type SeatFields,
} from "@/lib/auth/tenancy";

/**
 * The seats ruling 185 (1) reserves the Owner-only verbs to — sharing toggles,
 * association accept / leave / sever, launch scheduling, seat appointment,
 * demotion and removal, and org settings and billing.
 *
 * A one-element set rather than a bare `"owner"` so both sets are the same kind
 * of thing and `requireSeat` has one membership test, not two branches.
 */
export const OWNER_ONLY = ["owner"] as const satisfies readonly UserSeat[];

/**
 * The seats that may write across a tenancy's feature data — the people
 * directory, Meetings, Task Management, Ministry Teams, communication and the
 * church profile (AS-004).
 *
 * "Everything else an Admin may do" is the ruling's own wording, so this set is
 * the DEFAULT for a state-changing verb and `OWNER_ONLY` is the exception list.
 */
export const ADMIN_PLUS = [
  "owner",
  "admin",
] as const satisfies readonly UserSeat[];

/**
 * NOT A THIRD TIER — the two sets above are the tiers, and this is their union
 * with the seat that holds no authority of its own.
 *
 * It is what an OWN-DUTY verb requires (AS-006: a Member's meeting RSVP, their
 * own task, their own team). The subject half of those rules is not a seat
 * question and cannot be asked here: it needs the argument, so it is asked in
 * the export's body after the parse. What this set decides is the half that CAN
 * be settled before the parse — that the caller holds a seat in this tenancy at
 * all, which is what refuses a coach (seat NULL) and an oversight account.
 */
const SEATED = [...ADMIN_PLUS, "member"] as const satisfies readonly UserSeat[];

/**
 * The tenancy half of an authority rule.
 *
 * - `plant` — a seat in a church plant that EXISTS. The ordinary case.
 * - `church-level` — a seat in a plant, or none yet: registration mints a plant
 *   Owner with `church_id` null who creates the plant afterwards, so the
 *   onboarding verbs have to admit that account (see `isChurchLevelOwner`).
 * - `oversight` — a seat in a sending church or a network.
 * - `any` — the verb is answered from the actor alone, or reaches BOTH sides of
 *   an association and the side is matched downstream (`association.answer`).
 */
type TenancyRequirement = "plant" | "church-level" | "oversight" | "any";

/** A seat set and a tenancy — the pair every authority rule reads. */
type Authority = {
  /** `null` means a session is the whole rule: reads, and self-scoped writes. */
  readonly seats: readonly UserSeat[] | null;
  readonly tenancy: TenancyRequirement;
};

/**
 * EVERY VERB IN THE PRODUCT, AND WHO MAY DO IT.
 *
 * A capability is a VERB, not an endpoint: several exports share one, which is
 * what keeps this table readable at the size the export surface actually is
 * (157 endpoints, 27 verbs). A new action picks one; a new verb is a line here
 * and a decision made once, in the open.
 *
 * THREE THINGS ARE NOT IN EITHER SET, and are marked as such rather than
 * quietly parked in `ADMIN_PLUS`:
 *
 *   1. `seats: SEATED` — an own-duty verb, whose subject check lives in the
 *      body (see `SEATED`).
 *   2. `seats: null` — a session is the whole rule. A read, or a write whose
 *      row is keyed by the actor's own user id. A COACH AND AN ORG MEMBER REACH
 *      THESE, deliberately: a coach reads an assigned plant (AS-008) and an org
 *      Member reads everything its Owner reads (AS-007).
 *   3. The exempt exports in `UNSEATED_EXPORTS`, which call nothing here.
 */
const CAPABILITIES = {
  // ── Owner-only, ruling 185 (1) ─────────────────────────────────────────────
  /** The six `share_*` toggles a plant sets for its oversight org. */
  "sharing.toggle": { seats: OWNER_ONLY, tenancy: "plant" },
  /**
   * Accepting or declining an association invitation. The ruling names the
   * accept; a decline is the same answer on the same surface with the same
   * authority, so it is the same verb.
   *
   * `any` because BOTH sides answer — a plant answers a sending church or a
   * network, a sending church answers a network — and which side this caller is
   * on is matched against the invitation's target in `acceptInvitationAs`.
   */
  "association.answer": { seats: OWNER_ONLY, tenancy: "any" },
  /** A plant leaving its sending church or its network. */
  "association.leave": { seats: OWNER_ONLY, tenancy: "plant" },
  /** A sending church leaving its network. */
  "org.association.leave": { seats: OWNER_ONLY, tenancy: "oversight" },
  /** An org removing a plant it is associated with. */
  "org.association.sever": { seats: OWNER_ONLY, tenancy: "oversight" },
  /**
   * Creating, resending and revoking an org's ASSOCIATION invitations — the
   * ones that bind a plant or a sending church into the org's portfolio.
   *
   * OWNER_ONLY BECAUSE THIS IS AN ASSOCIATION VERB, not because invitations are
   * Owner-only. AS-005 gives an org Admin the org's own SEAT invitations, which
   * is a different verb over a different table; it arrives with `/settings/team`
   * (#500) as an `ADMIN_PLUS` row beside this one. Naming both here now would be
   * a capability with no call site, which is the drift this table exists to
   * prevent.
   */
  "org.invitation.manage": { seats: OWNER_ONLY, tenancy: "oversight" },
  /** Setting, moving and recording the outcome of a launch date. */
  "launch.schedule": { seats: OWNER_ONLY, tenancy: "plant" },
  /**
   * Appointing, demoting and removing a seat (AS-015 / AS-016 / AS-017).
   *
   * `any` BECAUSE THE RULING GIVES THE VERB TO AN OWNER IN ALL THREE TENANCIES,
   * and #497 ships the plant side of it. The tenancy half is therefore asked one
   * layer down, where `seatActorFromSession` (`@/lib/seats/roster`) refuses an
   * account with no plant — so an oversight Owner passes here and is refused
   * there, fail-closed and in ONE place rather than per verb. Narrowing this row
   * to `plant` instead would have to be undone by the org surface, which is the
   * same decision made twice.
   */
  "seat.manage": { seats: OWNER_ONLY, tenancy: "any" },
  /** An oversight org's own settings and billing. Declared, not yet wired. */
  "org.settings": { seats: OWNER_ONLY, tenancy: "oversight" },

  // ── Owner-only under an EARLIER ruling, carried across unchanged ───────────
  /**
   * Creating the plant, confirming leadership, declaring the journey, finishing
   * onboarding. `church-level` because the account has no `church_id` yet.
   */
  "church.create": { seats: OWNER_ONLY, tenancy: "church-level" },
  /**
   * Declaring a phase transition. NOT on the 185 (1) list — it is the planter's
   * under the phase engine's own rule and stays exactly as it was, because
   * widening or narrowing what a seat may do is a ruling, not a consequence of
   * moving a check into this table.
   */
  "phase.declare": { seats: OWNER_ONLY, tenancy: "plant" },

  // ── Admin and above ────────────────────────────────────────────────────────
  /** Editing the church's profile and settings (AS-004). */
  "church.profile": { seats: ADMIN_PLUS, tenancy: "plant" },
  /** Every write in the people directory, including import and household. */
  "people.write": { seats: ADMIN_PLUS, tenancy: "plant" },
  /** Every meetings write except a caller's own RSVP. */
  "meetings.write": { seats: ADMIN_PLUS, tenancy: "plant" },
  /** Creating, editing, assigning and deleting a task. */
  "tasks.write": { seats: ADMIN_PLUS, tenancy: "plant" },
  /** Creating and editing a team, its roles, and its leader. */
  "teams.write": { seats: ADMIN_PLUS, tenancy: "plant" },
  /** Sending a message and managing the church's templates. */
  "communication.send": { seats: ADMIN_PLUS, tenancy: "plant" },
  /**
   * Creating, resending and revoking a SEAT invitation — the row that gives
   * another person a login on this plant (AS-010, #495).
   *
   * `ADMIN_PLUS`, and it is the row `org.invitation.manage` said would arrive
   * "with `/settings/team`". The two are different verbs over different tables:
   * that one binds an ORGANIZATION into an association and is Owner-only
   * because association is an Owner decision; this one staffs a tenancy, which
   * AS-005 gives an Admin.
   *
   * `plant` because this track ships the plant side only. The org side is the
   * sibling issue over the same table, and it widens the tenancy here rather
   * than declaring a second verb — an org Admin inviting an org Member is the
   * same decision about the same row shape.
   */
  "seat.invitation.manage": { seats: ADMIN_PLUS, tenancy: "plant" },
  /**
   * Ending a coach assignment — the `coach_assignments` row going inactive
   * (AS-018, #497).
   *
   * NOT `seat.manage`, BECAUSE COACHING IS NOT A SEAT (ruling 185 (2)). Ending
   * an assignment moves no tenancy and no seat; it withdraws a read. Filing it
   * under the seat verb would make the two look like one decision and invite
   * the next reader to "reconcile" them.
   *
   * `ADMIN_PLUS` AND NOT NARROWER, ruled here for #497. AS-018 says "the Owner,
   * and the Admin who created it" — but `coach_assignments` records no author:
   * its columns are the coach, the plant, the date and the status. Adding an
   * `assigned_by` column now would write NULL on every row, because the coach
   * INVITATION surface that would populate it has not shipped, so "the Admin who
   * created it" would still be unidentifiable. AS-004 already gives an Admin the
   * power to INVITE a coach, so ending one is the symmetric verb at the same
   * level. The residual — any plant Admin may end an assignment, not only the
   * one who created it — is recorded in `memory/invariants.md` and retires when
   * the coach invitation surface lands with an author column.
   */
  "coach.assignment.manage": { seats: ADMIN_PLUS, tenancy: "plant" },
  /**
   * Setting a manual phase signal. The DECLARATION is the planter's
   * (`phase.declare`); the signals that feed the recommendation are an ordinary
   * plant-level write, so this is where "everything else an Admin may do" lands.
   */
  "phase.signal": { seats: ADMIN_PLUS, tenancy: "plant" },

  // ── Own duty: a seat, any seat; the subject is checked in the body ─────────
  /**
   * Completing, reopening or restatusing a task ASSIGNED TO THE CALLER.
   *
   * THE ONLY OWN-DUTY VERB THAT SHIPS, because it is the only one whose subject
   * can be derived: `tasks.assigned_to_id` references `users.id`, so
   * `assertMayActOnTask` (`@/lib/tasks/service`) can ask "is this yours?" after
   * the row is loaded. `SEATED` is therefore a real floor here and not a
   * fail-open one — the seat half refuses a coach and oversight, the subject
   * half refuses a Member acting on somebody else's task.
   *
   * AS-006's other two own-duty writes — a Member's meeting RSVP and their own
   * ministry team — have NO such column. `ministry_teams.leader_id` and the
   * meeting guest list reference `persons.id`, and nothing links a person row
   * to an account until AS-013's registration link lands. A `SEATED` capability
   * for them would be a floor with nothing above it: every Member in the plant
   * would reach every team and every RSVP, which is wider than today. So those
   * writes sit at `teams.write` / `meetings.write` until the link exists —
   * narrower than AS-006 describes, and the residual is recorded in
   * `memory/invariants.md`.
   */
  "tasks.own": { seats: SEATED, tenancy: "plant" },
  /**
   * Ticking a launch milestone or one of its tasks. LS-007 splits this from
   * `launch.schedule` on purpose: milestone completion follows normal task
   * rules, so a Member may do it — but oversight watches readiness rather than
   * ticking it, and a coach is read-only (AS-008), which is what the seat half
   * refuses.
   */
  "launch.milestone": { seats: SEATED, tenancy: "plant" },

  // ── A session is the whole rule ────────────────────────────────────────────
  /** A read-only endpoint. Reached by every seat, a coach, and oversight. */
  read: { seats: null, tenancy: "any" },
  /**
   * Answering the OB-010 leadership question — the CLAIM on a plant that has no
   * Owner yet.
   *
   * NO SEAT SET, and that is the point: this verb GRANTS the seat rather than
   * spending one, so its rule is not a capability. The ruled `{owner, member}`
   * pair that decides who may claim lives in `src/lib/onboarding/leadership.ts`
   * (`memory/invariants.md` → Seats & Tenancy: `admin` is deliberately not in
   * it), and putting it in either set here would make a grant look like a
   * permission and invite the two to be "reconciled".
   */
  "church.claim": { seats: null, tenancy: "church-level" },
  /**
   * A write whose row is keyed by the caller's own user id and reaches no other
   * account: notification preferences and read marks, wiki bookmarks and
   * reading progress, a suppression the caller clears for their own address,
   * and product feedback.
   */
  "self.write": { seats: null, tenancy: "any" },
  /**
   * Answering a COACH invitation from an account that already exists (AS-009,
   * #496).
   *
   * NO SEAT SET AND NO TENANCY REQUIREMENT, and both halves are the ruling
   * (2026-08-20, 185 (5)) rather than laxity. Who may answer one is decided by
   * the TOKEN and the address it is bound to, not by standing: a plant Member, an
   * oversight Owner and a coach with no tenancy at all are equally able to coach
   * somebody else's plant, because accepting adds a `coach_assignments` row and
   * moves nothing — no tenancy is vacated and no seat is touched.
   *
   * Narrowing it would break the flow it exists for. `tenancy: "plant"` would
   * refuse the seatless coach the invitation is most often for; any seat set at
   * all would refuse them too, since `users.seat` is NULL for a coach.
   *
   * What stops this being a hole is that the verb grants nothing by itself:
   * `acceptCoachInvitationAs` refuses every token that is not pending, unexpired
   * and issued to this account's own address, and the assignment is written by an
   * `INSERT … SELECT` that reads the plant out of the invitation row.
   */
  "coach.invitation.answer": { seats: null, tenancy: "any" },
} as const satisfies Record<string, Authority>;

/** A verb this product has an authority rule for. */
export type Capability = keyof typeof CAPABILITIES;

/**
 * WHY AN EXPORT MAY REACH ITS WORK WITHOUT `requireSeat`.
 *
 * TWO DIFFERENT REASONS, and collapsing them was the bug. The set used to be
 * called `SESSIONLESS_EXPORTS`, which is true of six of these and false of two:
 * `logout` reads a session and `updateFeedbackStatusAction` demands one. A name
 * that mis-describes a third of its members is a name the next reader will
 * widen — "sessionless" invites anything that does not need a seat.
 *
 * `kind` says which claim is being made, so the two cannot be confused:
 *
 *   - `sessionless` — reachable with no session AT ALL, by design. The auth
 *     endpoints, the public forms, and the token-bearing unsubscribe pair.
 *   - `non-seat-guard` — authenticated, but answering to something that is not
 *     a seat in a tenancy.
 *
 * `seat-guard.test.ts` asserts this set EXACTLY, so a new unguarded export
 * fails the suite instead of joining an unlisted group. Keyed
 * `<repo-relative path> → <export>`, the label form every assertion over the
 * auth surface already reports in.
 */
export const UNSEATED_EXPORTS: Readonly<
  Record<string, { kind: "sessionless" | "non-seat-guard"; reason: string }>
> = {
  "src/app/(auth)/login/actions.ts → login": {
    kind: "sessionless",
    reason: "signing in — there is no session to check yet",
  },
  "src/app/(auth)/login/dev-actions.ts → devLoginAs": {
    kind: "sessionless",
    reason:
      "the development sign-in shortcut, refused outright unless the dev flag is on",
  },
  "src/app/(auth)/register/actions.ts → register": {
    kind: "sessionless",
    reason: "creating the account — this is where the first seat is granted",
  },
  "src/app/(marketing)/actions.ts → requestInviteAction": {
    kind: "sessionless",
    reason: "the public waitlist form on the marketing site",
  },
  "src/app/unsubscribe/actions.ts → confirmUnsubscribeAction": {
    kind: "sessionless",
    reason:
      "authorised by the emailed unsubscribe token, which the recipient holds instead of a session",
  },
  "src/app/unsubscribe/actions.ts → undoUnsubscribeAction": {
    kind: "sessionless",
    reason: "the same token, undoing the same change",
  },
  "src/lib/auth/actions.ts → logout": {
    kind: "non-seat-guard",
    reason:
      "it READS the session cookie and ends it; the operation must converge whether or not one is still valid, so there is nothing to refuse",
  },
  "src/app/(dashboard)/admin/feedback/actions.ts → updateFeedbackStatusAction":
    {
      kind: "non-seat-guard",
      reason:
        "guarded by requirePlatformAdmin — an allowlist of platform operators, which demands a session but is not a seat in any tenancy",
    },
};

/**
 * Does this account hold `capability`? Both halves, always.
 *
 * The non-throwing form, for the sibling modules that already take their actor
 * as an argument (`src/lib/invitations/core.ts`) and cannot mint one. Those
 * call sites used to spell `isPlantOwner` / `isOrgOwner` themselves; asking
 * here instead is what keeps the Owner-only set a single declaration rather
 * than a rule re-derived per module.
 */
export function holdsSeatFor(
  user: SeatFields,
  capability: Capability
): boolean {
  // A ROW NAMING TWO TENANCIES REACHES NOTHING, whatever the capability asks
  // for. `isChurchLevelUser` and `isOversightUser` are both stated POSITIVELY
  // and the defect satisfies neither, so "neither" is exactly that row — and
  // this has to sit ABOVE the switch, because `tenancy: "any"` would otherwise
  // wave it through on the four verbs that reach both sides of the product.
  // (`memory/invariants.md` → Seats & Tenancy; migration 0050 §1 repaired
  // twelve such rows and a CHECK would have refused them, so the state stays
  // representable and every reader fails closed on it.)
  if (!isChurchLevelUser(user) && !isOversightUser(user)) return false;

  // Widened to `Authority` on purpose: indexing the literal table narrows
  // `seats` to the one tuple this capability names, and the membership test
  // below then only accepts that tuple's own members.
  const { seats, tenancy }: Authority = CAPABILITIES[capability];

  switch (tenancy) {
    case "plant":
      if (!isChurchLevelUser(user) || user.churchId === null) return false;
      break;
    case "church-level":
      if (!isChurchLevelUser(user)) return false;
      break;
    case "oversight":
      if (!isOversightUser(user)) return false;
      break;
    case "any":
      break;
  }

  if (seats === null) return true;
  return user.seat !== null && seats.includes(user.seat);
}

/**
 * "Is this account the plant's own Owner?" — the planter.
 *
 * AN IDENTITY READ, NOT AN AUTHORITY RULE, and it lives here for the same
 * reason `holdsSeatFor` does: `seat-guard.test.ts` refuses a hand-rolled
 * `seat === "owner"` anywhere outside this module, so the one place that can
 * spell it is the place that owns the vocabulary. Nothing may gate a capability
 * on this — that is `holdsSeatFor(user, capability)`, which reads the tenancy
 * too. This answers a question about WHOSE row it is: the phase engine counts
 * how many open follow-ups the planter personally owns (#470), and "the
 * planter" is the Owner seat by definition.
 */
export function isOwnerSeat(seat: UserSeat | null): boolean {
  return seat === "owner";
}

/**
 * WHAT A SEAT REFUSAL IS, as a type rather than as a string prefix.
 *
 * The action shells have to tell three failures apart — no session, no
 * authority, and everything else — and until #498's review they told the second
 * one by `error.message.startsWith("Forbidden")`. That is a classification
 * resting on prose: `requireChurchAccess` and the invitation layer throw
 * `Forbidden: …` too, any future message that happens to open with the word
 * joins the class silently, and rewording a refusal for a human reader changes
 * control flow. An `instanceof` check asks the question the code actually means.
 *
 * The MESSAGE still names the capability, because that sentence is for the
 * server log; what reaches a caller is the shell's one line of copy.
 */
export class SeatRefusalError extends Error {
  readonly capability: Capability;

  constructor(capability: Capability) {
    super(`Forbidden: ${capability} is not carried by this account`);
    this.name = "SeatRefusalError";
    this.capability = capability;
  }
}

/**
 * The throwing form, for a SERVICE that was handed an actor it cannot mint.
 *
 * The action layer's guard is the primary refusal; this is the service's own,
 * so an authority rule holds for a caller that reached the service some other
 * way. It is the same table, which is the whole point — the two spellings it
 * replaces (`requirePlantOwner`, `requireChurchLevel` in `@/lib/auth/access`)
 * had already drifted: `requireChurchLevel` admitted a COACH to the launch
 * milestone ticks that the seat model refuses them (AS-008), so the action and
 * the service disagreed about the same write.
 */
export function assertSeatFor(user: SeatFields, capability: Capability): void {
  if (!holdsSeatFor(user, capability)) {
    throw new SeatRefusalError(capability);
  }
}
