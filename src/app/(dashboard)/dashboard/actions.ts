"use server";

import { db } from "@/db";
import { churches } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import {
  createChurchDeps,
  runCreateChurch,
  type CreateChurchOutcome,
} from "@/lib/onboarding/create-church";
import {
  isLeadershipAnswer,
  leadershipStatusForAnswer,
} from "@/lib/onboarding/leadership";
import type { ChurchBasicsFieldErrors } from "@/lib/validations/onboarding";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

export type { ChurchBasicsFieldErrors };

export type ChurchBasicsState = CreateChurchOutcome;

/**
 * Re-render everything below the root layout.
 *
 * Every write here changes what the dashboard shell renders — the flow itself
 * is the dashboard's primary content while onboarding is unfinished — so the
 * layout is the level that has to be revalidated, not the page.
 */
function revalidateDashboard() {
  revalidatePath("/", "layout");
}

/**
 * F12 / OB-001 + OB-002 — step 1 of onboarding: create the church.
 *
 * The church is created HERE, at the first step, not at the end of the flow.
 * That is the point of OB-001: a planter who closes the tab after typing a name
 * owns a real, valid church and comes back to the remaining steps rather than
 * to nothing. Everything steps 2-4 capture is an UPDATE to that row.
 *
 * The action is a wrapper on purpose. It mints the actor from `verifySession()`
 * — there is no parameter a forged POST could name someone else in — and hands
 * the rest to `runCreateChurch`, which owns the atomicity rules and is unit
 * tested through its deps (`src/lib/onboarding/create-church.ts`, #198).
 *
 * Deliberately does NOT redirect — the flow advances to step 2 in place, and
 * only `completeOnboarding` leaves the flow.
 */
export async function createChurchBasics(
  formData: FormData
): Promise<ChurchBasicsState> {
  const { user } = await verifySession();

  return runCreateChurch(
    createChurchDeps(revalidateDashboard),
    { id: user.id, role: user.role, churchId: user.churchId },
    formData
  );
}

export type ConfirmLeadershipState =
  | { status: "saved" }
  | { status: "error"; error: string };

/**
 * F12 / OB-004 — step 2 of onboarding: "Will you be the lead planter/pastor?"
 *
 * What this write is, and what it is NOT. The planter ASSIGNMENT is the
 * existing mechanism — `users.church_id` + the `planter` role — and it was
 * written at step 1 by `createChurchBasics`, through
 * `linkUserToChurchFilter()`, whose #183 compare-and-set (caller's id AND
 * `church_id IS NULL`) is the only thing standing between a double submit and
 * a relink. This step deliberately does not re-run that write: answering Yes
 * confirms the link that already exists, so there is no second church-link
 * write to get the filter wrong on.
 *
 * What it adds is the explicit, queryable answer. Before OB-004 "does this
 * church have a planter?" could only be inferred from a role lookup, so
 * answering No could not be recorded at all — and an unrecorded No is
 * indistinguishable from a Yes to every downstream surface.
 *
 * Re-enterable on purpose: the dashboard's no-planter nudge links back here
 * (the one specced re-entry path), so this is an UPDATE with no "already
 * answered" guard — a planter who said No must be able to say Yes.
 */
export async function confirmLeadership(
  answer: string
): Promise<ConfirmLeadershipState> {
  const { user } = await verifySession();

  if (user.role !== "planter") {
    return {
      status: "error",
      error: "Only church planters can answer this",
    };
  }

  if (!user.churchId) {
    return {
      status: "error",
      error: "Create your church plant before answering this",
    };
  }

  if (!isLeadershipAnswer(answer)) {
    return { status: "error", error: "Please choose yes or no" };
  }

  await db
    .update(churches)
    .set({
      leadershipStatus: leadershipStatusForAnswer(answer),
      updatedAt: new Date(),
    })
    .where(eq(churches.id, user.churchId));

  revalidateDashboard();

  return { status: "saved" };
}

export type CompleteOnboardingState = { status: "error"; error: string };

/**
 * F12 / OB-001 — leave the onboarding flow and hand the dashboard back.
 *
 * Stamping `onboarding_completed_at` is what stops the flow owning
 * `/dashboard`. It records "the planter is done answering", not "every step
 * was answered": skipping straight through from step 1 is a legitimate way to
 * get here (AC 4) and leaves exactly today's outcome — a named church at phase
 * 0 with no launch date. Which facts are still missing stays derivable from the
 * columns themselves, which is what the incomplete-onboarding nudge (OB-011)
 * will read.
 *
 * The `IS NULL` guard makes this idempotent: a double submit, or a second tab,
 * cannot move a completion timestamp that is already set.
 *
 * RETURN TYPE (#243). On success this `redirect()`s and never returns, and the
 * declared type says so: `CompleteOnboardingState | void`. Writing it as
 * `Promise<CompleteOnboardingState>` typechecked only because `redirect` is
 * currently typed `never` — a framework internal the app's public contract had
 * no business resting on, and one whose relaxation would silently make every
 * `result.error` in the client a possible crash. With `| void` declared, the
 * caller is forced to write `result?.error`, which is true whatever `redirect`
 * is typed as.
 */
export async function completeOnboarding(): Promise<CompleteOnboardingState | void> {
  const { user } = await verifySession();

  if (user.role !== "planter") {
    return { status: "error", error: "Only church planters can onboard" };
  }

  if (!user.churchId) {
    return {
      status: "error",
      error: "Create your church plant before finishing setup",
    };
  }

  await db
    .update(churches)
    .set({ onboardingCompletedAt: new Date() })
    .where(
      and(
        eq(churches.id, user.churchId),
        isNull(churches.onboardingCompletedAt)
      )
    );

  revalidateDashboard();

  // The confetti's trigger, preserved (OB-001 AC): finishing OR skipping
  // through the final step lands here, and the dashboard reads the flag.
  redirect("/dashboard?churchCreated=true");
}
