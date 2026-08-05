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
 */

import { db } from "@/db";
import { churches, users } from "@/db/schema";
import {
  canAnswerLeadershipQuestion,
  isLeadershipAnswer,
  leadershipStatusForAnswer,
  leadershipWritePlan,
  type ChurchLeadershipState,
  type LeadershipAnswer,
  type LeadershipViewer,
  type LeadershipWritePlan,
} from "@/lib/onboarding/leadership";
import { and, eq, exists, notExists } from "drizzle-orm";

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
   * Write the answer. Resolves `false` only for a `claim` that lost its race —
   * every other plan is an idempotent UPDATE that cannot lose.
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
 * settled. One idempotent UPDATE — there is no race to lose, because nothing
 * about who leads the plant changes.
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
      if (write.plan !== "claim") {
        await recordLeadershipStatement(write);
        return true;
      }

      const [, , confirmed] = await db.batch(claimPlanterStatements(write));
      return confirmed.length > 0;
    },
  };
}
