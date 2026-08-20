// ============================================================================
// PERMISSION, DECIDED IN ONE PLACE (AS-019, ruling 185 (8) of 2026-08-20).
//
// Two seat sets stated as DATA, one table naming which set each verb belongs
// to, and one guard — `requireSeat` — that every export of every `"use server"`
// module calls as its FIRST statement. `src/lib/auth/seat-guard.test.ts` walks
// the whole export surface and fails when one reaches its work without it.
//
// WHAT WAS REJECTED, and why the shape here is what it is: a per-module
// permission matrix. It drifts the moment two modules disagree about the same
// verb, and there is no single artefact a reviewer can read to learn who may do
// what. The table below IS that artefact.
//
// THE PAIR, ALWAYS. `seat = 'owner'` says nothing about WHOSE owner
// (`memory/invariants.md` → Seats & Tenancy), so an authority rule is never the
// seat alone. Each capability names a seat set AND a tenancy requirement, and
// the three composite predicates the readers used to spell by hand are exactly
// three rows of that table:
//
//   OWNER_ONLY + "plant"        ≡ isPlantOwner
//   OWNER_ONLY + "oversight"    ≡ isOrgOwner
//   OWNER_ONLY + "church-level" ≡ isChurchLevelOwner
//
// so the invitation and settings arms that used to call those predicates
// directly now ask this module (`holdsSeatFor`) and there is one spelling of
// each rule rather than two that can drift apart.
// ============================================================================

import type { UserSeat } from "@/db/schema";
import {
  verifySession,
  type SessionValidationResult,
} from "@/lib/auth/session";
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
 * church profile (AS-004), and an org's invitation queue (AS-005).
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
 *   3. The exempt exports in `SESSIONLESS_EXPORTS`, which call nothing here.
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
  /** Creating, resending and revoking an org's association invitations. */
  "org.invitation.manage": { seats: OWNER_ONLY, tenancy: "oversight" },
  /** Setting, moving and recording the outcome of a launch date. */
  "launch.schedule": { seats: OWNER_ONLY, tenancy: "plant" },
  /**
   * Appointing, demoting and removing a seat (AS-015 / AS-016 / AS-017).
   *
   * DECLARED WITH NO CALL SITE YET. The Owner-only set is fixed by the ruling
   * and this module is where the ruling is encoded, so the verb is stated here
   * rather than invented by whoever builds `/settings/team` (#500) — which is
   * the drift this table exists to prevent.
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

  // ── Own duty: a seat, any seat; the subject is checked in the body ─────────
  /** Completing, reopening or restatusing a task ASSIGNED TO THE CALLER. */
  "tasks.own": { seats: SEATED, tenancy: "plant" },
  /** A ministry-team write a team's leader may make. */
  "teams.own": { seats: SEATED, tenancy: "plant" },
  /** A caller's own RSVP on a meeting's guest list. */
  "meetings.rsvp": { seats: SEATED, tenancy: "plant" },
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
   * A write whose row is keyed by the caller's own user id and reaches no other
   * account: notification preferences and read marks, wiki bookmarks and
   * reading progress, a suppression the caller clears for their own address,
   * and product feedback.
   */
  "self.write": { seats: null, tenancy: "any" },
} as const satisfies Record<string, Authority>;

/** A verb this product has an authority rule for. */
export type Capability = keyof typeof CAPABILITIES;

/**
 * THE EXEMPT SET, NAMED AND TESTED.
 *
 * A `"use server"` export that calls no guard is either sessionless BY DESIGN
 * or a hole, and the difference cannot be read off the absence of a call. So
 * the exemptions are written down here with their reason, `seat-guard.test.ts`
 * asserts the set EXACTLY, and a new unguarded export fails the suite instead
 * of joining an unlisted group.
 *
 * Keyed `<repo-relative path> → <export>`, the label form every assertion over
 * the auth surface already reports in.
 */
export const SESSIONLESS_EXPORTS: Readonly<Record<string, string>> = {
  "src/app/(auth)/login/actions.ts → login":
    "signing in — there is no session to check yet",
  "src/app/(auth)/login/dev-actions.ts → devLoginAs":
    "the development sign-in shortcut, refused outright unless the dev flag is on",
  "src/app/(auth)/register/actions.ts → register":
    "creating the account — this is where the first seat is granted",
  "src/app/(marketing)/actions.ts → requestInviteAction":
    "the public waitlist form on the marketing site",
  "src/app/unsubscribe/actions.ts → confirmUnsubscribeAction":
    "authorised by the emailed unsubscribe token, which the recipient holds instead of a session",
  "src/app/unsubscribe/actions.ts → undoUnsubscribeAction":
    "the same token, undoing the same change",
  "src/lib/auth/actions.ts → logout":
    "ending a session must converge whether or not one is still valid",
  "src/app/(dashboard)/admin/feedback/actions.ts → updateFeedbackStatusAction":
    "guarded by requirePlatformAdmin — an allowlist of platform operators, which is not a seat in any tenancy",
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
 * THE GUARD. The first statement of every state-changing `"use server"` export.
 *
 * It MINTS the actor as well as checking it, which is what lets it be one line
 * rather than two and keeps the SESSION-FIRST rule intact: it returns exactly
 * what `verifySession()` returns, so a call site adopts it by changing the
 * function it already calls rather than by adding a statement above it.
 *
 * AHEAD OF THE PARSE, and that is not stylistic. Parsing first answers a
 * sessionless caller differently for a malformed argument than for a
 * well-formed one — a free shape-oracle on an endpoint that should have said
 * only "no" (`memory/invariants.md` → Authentication).
 *
 * @throws `Unauthorized` with no session; `Forbidden: …` when the seat or the
 * tenancy does not carry the capability. The prefix is the established refusal
 * shape (`@/lib/auth/access`): the action modules turn it into "You do not have
 * permission to …" and log the detail, so the sentence naming the seat reaches
 * the server log and never a response.
 */
export async function requireSeat(
  capability: Capability
): Promise<SessionValidationResult> {
  const result = await verifySession();

  if (!holdsSeatFor(result.user, capability)) {
    throw new Error(`Forbidden: ${capability} is not carried by this account`);
  }

  return result;
}
