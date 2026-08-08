/**
 * F12 / OB-004 + OB-010 — the leadership answer's write path.
 *
 * WHY THIS IS NOT IN THE ACTION. `"use server"` modules are an auth surface —
 * every export is a POSTable endpoint (`memory/invariants.md` →
 * Authentication) — so `actions.ts` keeps one job, minting the actor from
 * `verifySession()`, and the rules live here where they can be driven by a test
 * through `ConfirmLeadershipDeps` without a request or a database. Same shape as
 * `src/lib/onboarding/create-church.ts` (#198).
 *
 * WHAT OB-010 ADDS. Until now Yes only ever RECORDED an answer: the assignment
 * (`users.church_id` + the `planter` role) had already been written at step 1 by
 * the planter answering about themselves. OB-010 asks the question of churches
 * that predate it and have **no planter at all**, where Yes must actually make
 * the answerer the planter — a role change. That is why `leadershipWritePlan`
 * exists, why the claim is a batch rather than one UPDATE, and why the
 * permission to answer at all (`canAnswerLeadershipQuestion`) closes the moment
 * the seat is filled.
 *
 * WHY THE CLAIM IS LOCKED (`claimPlanterStatements`, statement ONE). Two team
 * members of the same planterless plant can both answer Yes. Both claims write
 * DIFFERENT `users` rows, so they contend on nothing, and both `NOT EXISTS (…
 * role = 'planter')` subqueries are snapshot reads that were true when they ran
 * — under READ COMMITTED both would commit and the plant would end up with two
 * planters (`memory/invariants.md` → Atomicity: "a compare-and-set only
 * serialises requests that write the SAME ROW"). `SELECT … FROM churches WHERE
 * id = ? FOR UPDATE` as statement one is what serialises them: the loser blocks
 * until the winner commits, then re-evaluates against what the winner wrote,
 * matches nothing, and writes nothing at all — its status write is gated on
 * ITS OWN role write having landed, not on the plant having a planter.
 *
 * WHY THE DECLINE IS LOCKED TOO (`declineUnseatedStatements`). The race is not
 * Yes-versus-Yes only: a No from a team member competes with every Yes in
 * flight for the same empty seat, and as a bare UPDATE it used to win by
 * arriving last, recording `no_planter` on a plant that had just acquired a
 * planter. Only an answer about a seat the actor ALREADY holds is unguarded,
 * and that one races nobody by construction — once the seat is filled,
 * `canAnswerLeadershipQuestion` admits only the planter.
 */

import { db } from "@/db";
import { churches, users } from "@/db/schema";
import {
  canAnswerLeadershipQuestion,
  isLeadershipAnswer,
  leadershipStatusForAnswer,
  leadershipWritePlan,
  viewerHoldsPlanterSeat,
  type ChurchLeadershipState,
  type LeadershipAnswer,
  type LeadershipViewer,
  type LeadershipWritePlan,
} from "@/lib/onboarding/leadership";
import { and, eq, exists, inArray, notExists } from "drizzle-orm";

/** The actor, minted from the session. Never a parameter of the action. */
export type LeadershipActor = LeadershipViewer & { id: string };

export type ConfirmLeadershipOutcome =
  | { status: "saved" }
  | { status: "error"; error: string };

export const CHOOSE_AN_ANSWER_MESSAGE = "Please choose yes or no";

export const CREATE_CHURCH_FIRST_MESSAGE =
  "Create your church plant before answering this";

export const NOT_YOURS_TO_ANSWER_MESSAGE =
  "Only this plant's planter can answer this";

export const CLAIM_LOST_MESSAGE =
  "Someone else was assigned as this plant's planter first.";

export const LEADERSHIP_SAVE_FAILED_MESSAGE =
  "We could not save your answer. Please try again.";

export type ConfirmLeadershipDeps = {
  /** The church's leadership, both explicit and implicit. `null` if it is gone. */
  readLeadership: (churchId: string) => Promise<ChurchLeadershipState | null>;
  /**
   * Write the answer. Resolves `false` for either answer that can LOSE a race
   * for the empty seat — a `claim`, or a `decline` from somebody who does not
   * hold the seat. An answer about a seat the actor already holds is an
   * idempotent UPDATE that cannot lose.
   */
  writeAnswer: (write: LeadershipWrite) => Promise<boolean>;
  /** `revalidatePath` — injected so `next/cache` stays in the action. */
  revalidate: () => void;
};

export type LeadershipWrite = {
  plan: LeadershipWritePlan;
  churchId: string;
  actorId: string;
  answer: LeadershipAnswer;
  /**
   * Does the actor already hold the planter seat? Decided from the church state
   * the permission was derived from (`viewerHoldsPlanterSeat`), because it is
   * what tells a settled answer apart from one that is racing — see
   * `declineUnseatedStatements`. Required rather than optional: a caller that
   * forgets it should be a compile error, not a silently unguarded write.
   */
  actorHoldsSeat: boolean;
};

/**
 * The answer, end to end.
 *
 * Re-enterable on purpose and with no "already answered" guard: the dashboard
 * nudge links back here (OB-004's one specced re-entry path), so a plant that
 * said No must be able to say Yes — and under OB-010 that Yes may be the one
 * that finally gives the plant a planter.
 */
export async function runConfirmLeadership(
  deps: ConfirmLeadershipDeps,
  actor: LeadershipActor,
  answer: string
): Promise<ConfirmLeadershipOutcome> {
  if (!actor.churchId) {
    return { status: "error", error: CREATE_CHURCH_FIRST_MESSAGE };
  }

  if (!isLeadershipAnswer(answer)) {
    return { status: "error", error: CHOOSE_AN_ANSWER_MESSAGE };
  }

  const church = await deps.readLeadership(actor.churchId);

  // The permission is re-derived from the CHURCH's current state, not from what
  // the surface that rendered the button believed: whether the seat is still
  // empty is exactly the thing that can have changed since.
  if (!church || !canAnswerLeadershipQuestion(actor, church)) {
    return { status: "error", error: NOT_YOURS_TO_ANSWER_MESSAGE };
  }

  const plan = leadershipWritePlan(actor, church, answer);

  let written: boolean;
  try {
    written = await deps.writeAnswer({
      plan,
      churchId: actor.churchId,
      actorId: actor.id,
      answer,
      actorHoldsSeat: viewerHoldsPlanterSeat(actor, church),
    });
  } catch (error) {
    console.error("leadership answer failed", error);
    return { status: "error", error: LEADERSHIP_SAVE_FAILED_MESSAGE };
  }

  // Revalidate either way. A lost claim means somebody else IS the planter now,
  // and the surface reporting the loss should be rendering that fact, not the
  // prompt it was painted with.
  deps.revalidate();

  if (!written) {
    return { status: "error", error: CLAIM_LOST_MESSAGE };
  }

  return { status: "saved" };
}

// ============================================================================
// The statements
// ============================================================================

/** `EXISTS (SELECT … FROM users WHERE church_id = ? AND role = 'planter')`. */
function planterOfChurch(churchId: string) {
  return db
    .select({ id: users.id })
    .from(users)
    .where(and(eq(users.churchId, churchId), eq(users.role, "planter")));
}

/** The same question about ONE user: is this actor the plant's planter? */
function actorIsPlanterOf(churchId: string, actorId: string) {
  return db
    .select({ id: users.id })
    .from(users)
    .where(
      and(
        eq(users.id, actorId),
        eq(users.churchId, churchId),
        eq(users.role, "planter")
      )
    );
}

/**
 * OB-004's write: record the answer against a plant whose assignment is already
 * SETTLED — a Yes or No from the planter about their own seat. One idempotent
 * UPDATE, and there is genuinely no race to lose here: once anybody holds the
 * seat, `canAnswerLeadershipQuestion` lets only the planter answer, so there is
 * no second writer to interleave with.
 *
 * NOT the path for a decline from somebody who does NOT hold the seat — that
 * one competes with every Yes in flight and goes through
 * `declineUnseatedStatements`.
 */
export function recordLeadershipStatement(write: LeadershipWrite) {
  return db
    .update(churches)
    .set({
      leadershipStatus: leadershipStatusForAnswer(write.answer),
      updatedAt: new Date(),
    })
    .where(eq(churches.id, write.churchId));
}

/**
 * OB-010's write: DECLINE the empty planter seat — "someone else will lead
 * this plant", from somebody who is not the planter.
 *
 * This is the claim's mirror image and needs the claim's guards, for the same
 * reason. Two team members of a planterless plant can answer at once: A says No
 * while B says Yes. B's claim locks the church, promotes B and records
 * `planter_confirmed`. A's answer was true when A read it and is false by the
 * time it commits — and as a bare `UPDATE churches SET leadership_status =
 * 'no_planter'` it would commit anyway, last write winning, leaving a plant that
 * HAS a planter recorded as having none.
 *
 * That is not a cosmetic disagreement. `handleMeetingAttendanceFinalized`
 * (`src/lib/tasks/events.ts`) reads `churchHasNoPlanter` FIRST and skips the
 * planter lookup entirely when it is true, so every post-meeting follow-up and
 * evaluation task silently stops being created on a plant that is perfectly
 * well led — a warning in the log and no tasks, indistinguishable from a plant
 * that really has nobody. The no-planter nudge relights too.
 *
 * So: lock the church row first (statement one, exactly as the claim does — the
 * lock is what serialises A against B, since their two updates otherwise touch
 * different rows), then write `no_planter` only while the seat is still empty.
 * A decline that lost matches nothing, writes nothing, and is reported as a
 * lost race rather than silently discarded.
 */
export function declineUnseatedStatements(write: LeadershipWrite) {
  const now = new Date();

  return [
    db
      .select({ id: churches.id })
      .from(churches)
      .where(eq(churches.id, write.churchId))
      .for("update"),
    db
      .update(churches)
      .set({ leadershipStatus: "no_planter", updatedAt: now })
      .where(
        and(
          eq(churches.id, write.churchId),
          notExists(planterOfChurch(write.churchId))
        )
      )
      .returning({ id: churches.id }),
  ] as const;
}

/**
 * OB-010's write: take the empty planter seat.
 *
 * Three statements, in the only order that is safe:
 *
 * 1. lock the church row, so two answerers are serialised rather than racing
 *    two different `users` rows (see the module header);
 * 2. the CLAIM — become the planter, but only while nobody is
 *    (`NOT EXISTS`), so the loser's update matches nothing;
 * 3. the dependent write — record `planter_confirmed`, gated on THIS actor
 *    holding the role. Inside a batch each statement sees the previous one's
 *    writes, so the winner passes; the loser fails the same predicate and the
 *    plant is never recorded as confirmed on the strength of a claim that did
 *    not land.
 *
 * Returned as a tuple so `db.batch` gets its non-empty-tuple type and the tests
 * can read the SQL without a database.
 */
export function claimPlanterStatements(write: LeadershipWrite) {
  const now = new Date();

  return [
    db
      .select({ id: churches.id })
      .from(churches)
      .where(eq(churches.id, write.churchId))
      .for("update"),
    db
      .update(users)
      .set({ role: "planter", updatedAt: now })
      .where(
        and(
          eq(users.id, write.actorId),
          eq(users.churchId, write.churchId),
          // Defense in depth. `canAnswerLeadershipQuestion` already refuses a
          // coach or an oversight admin in JS, so today this predicate can
          // never be the thing that saves us — but this statement PROMOTES
          // somebody, and a promotion should not be one forgotten JS check away
          // from being reachable if these statements ever gain a second caller.
          inArray(users.role, ["team_member", "planter"]),
          notExists(planterOfChurch(write.churchId))
        )
      )
      .returning({ id: users.id }),
    db
      .update(churches)
      .set({ leadershipStatus: "planter_confirmed", updatedAt: now })
      .where(
        and(
          eq(churches.id, write.churchId),
          exists(actorIsPlanterOf(write.churchId, write.actorId))
        )
      )
      .returning({ id: churches.id }),
  ] as const;
}

/**
 * The church's leadership as the rules want it: the explicit column, plus
 * whether anybody actually holds the planter role.
 *
 * Two small reads rather than one join — the church row is already
 * request-cached for most callers, and the planter probe is an indexed
 * single-row lookup.
 */
export async function readChurchLeadershipState(
  churchId: string
): Promise<ChurchLeadershipState | null> {
  const [[church], planters] = await Promise.all([
    db
      .select({ leadershipStatus: churches.leadershipStatus })
      .from(churches)
      .where(eq(churches.id, churchId))
      .limit(1),
    planterOfChurch(churchId).limit(1),
  ]);

  if (!church) return null;

  return {
    churchId,
    leadershipStatus: church.leadershipStatus,
    hasPlanterUser: planters.length > 0,
  };
}

/** Does anybody hold the planter role on this plant? (The dashboard's read.) */
export async function churchHasPlanterUser(churchId: string): Promise<boolean> {
  const planters = await planterOfChurch(churchId).limit(1);
  return planters.length > 0;
}

/** The real deps. `revalidate` is a parameter so `next/cache` stays in the action. */
export function confirmLeadershipDeps(
  revalidate: () => void
): ConfirmLeadershipDeps {
  return {
    revalidate,
    readLeadership: readChurchLeadershipState,

    async writeAnswer(write) {
      if (write.plan === "claim") {
        const [, , confirmed] = await db.batch(claimPlanterStatements(write));
        return confirmed.length > 0;
      }

      // A decline from somebody who does not hold the seat is competing with
      // every Yes in flight, so it is guarded exactly like a claim. Only an
      // answer about a seat the actor already holds is safe to write plainly.
      if (write.plan === "decline" && !write.actorHoldsSeat) {
        const [, declined] = await db.batch(declineUnseatedStatements(write));
        return declined.length > 0;
      }

      await recordLeadershipStatement(write);
      return true;
    },
  };
}
