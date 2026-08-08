"use server";

import { db } from "@/db";
import { churches } from "@/db/schema";
import { verifySession } from "@/lib/auth/session";
import {
  createChurchDeps,
  runCreateChurch,
  type CreateChurchOutcome,
} from "@/lib/onboarding/create-church";
import { phaseForJourneyStage } from "@/lib/onboarding/steps";
import { plantDirtyColumns } from "@/lib/phase-engine/dirty-handler";
import { declareInitialPhase } from "@/lib/phase-engine/transitions";
import { launchTargetDateSchema } from "@/lib/launch/validation";
import { scheduleLaunchAction } from "@/app/(dashboard)/launch/actions";
import { and, eq, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  confirmLeadershipDeps,
  runConfirmLeadership,
  type ConfirmLeadershipOutcome,
} from "./confirm-leadership";

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

export type ConfirmLeadershipState = ConfirmLeadershipOutcome;

/**
 * F12 / OB-004 + OB-010 — "Will you be the lead planter/pastor?"
 *
 * What this write is, and what it is NOT. For the planter answering about
 * themselves the ASSIGNMENT is the existing mechanism — `users.church_id` + the
 * `planter` role — written at step 1 by `createChurchBasics` through
 * `linkUserToChurchFilter()`. That path deliberately does not re-run the link:
 * answering Yes confirms the one that already exists, so there is no second
 * church-link write to get the filter wrong on. What it adds is the explicit,
 * queryable answer; before OB-004 an unrecorded No was indistinguishable from a
 * Yes to every downstream surface.
 *
 * OB-010 is the case where Yes has to ASSIGN rather than confirm — a church
 * that predates the question and has no planter at all — and that is a role
 * change with a race in it. All of it lives in `./confirm-leadership`, which is
 * ordinary server code the tests can drive; this export exists to mint the actor
 * from `verifySession()` so there is no parameter a forged POST could name
 * somebody else in (`memory/invariants.md` → Authentication).
 */
export async function confirmLeadership(
  answer: string
): Promise<ConfirmLeadershipState> {
  const { user } = await verifySession();

  return runConfirmLeadership(
    confirmLeadershipDeps(revalidateDashboard),
    { id: user.id, role: user.role, churchId: user.churchId },
    answer
  );
}

/**
 * A `type`, not an `interface`, and the difference is load-bearing: every
 * non-type export of a `"use server"` module is a POSTable endpoint
 * (`memory/invariants.md` → Authentication), so the module's export list is
 * scanned for exactly that shape (`create-church.test.ts`).
 */
export type DeclareJourneyInput = {
  /** A `JOURNEY_STAGE_OPTIONS` value — `"0"`…`"6"` or `not_sure`. */
  stage: string;
  /**
   * `YYYY-MM-DD`, or `null` for the explicit "no date yet" (OB-003). `null`
   * writes NOTHING: no launch row, no placeholder. See `LAUNCH_DATE_CHOICES`.
   */
  targetDate?: string | null;
};

export type DeclareJourneyState =
  | { status: "declared"; phase: number; targetDate: string | null }
  | { status: "error"; error: string };

/**
 * F12 / OB-003 + OB-005 — step 3 of onboarding: where are you, and when do you
 * hope to launch?
 *
 * TWO WRITES, IN THIS ORDER, and neither of them is new code:
 *
 *   1. THE LAUNCH DATE goes through `scheduleLaunchAction` — the same rail as
 *      the `/launch` page's own date form, not a second write path beside it.
 *      That is what makes the FRD's "setting it from onboarding journals the
 *      change and emits the launch-date milestone event on the same rail as any
 *      other date set" a structural fact rather than a promise: the row lock,
 *      the `launch_events` journal, the oversight announcement and the Playbook
 *      milestone seed all come from `src/lib/launch/*` because there is nowhere
 *      else for them to come from. The date is NEVER written to a column on
 *      `churches` — migration 0032 dropped `churches.launch_date` and the
 *      launch entity is its only owner (LS-001).
 *
 *   2. THE STAGE goes through `declareInitialPhase`, which writes ONE
 *      `phase_transitions` row marked as the initial declaration and moves
 *      `churches.current_phase`. No intermediate rows: declaring 3 records
 *      nothing for 1 and 2 (FRD AC 3).
 *
 * The date FIRST, because the declaration captures a fact snapshot and that
 * snapshot includes the launch countdown — taken the other way round, the
 * plant's own declaration would record it as having no launch date.
 *
 * PARTIALLY APPLIED IS A REAL AND SAFE OUTCOME. If the stage write fails, the
 * date is already saved and journaled, and the planter is told what went wrong
 * rather than being handed a rollback that would also throw away a date they
 * successfully set. Re-submitting is safe: the date write is a compare-and-set
 * (an unchanged date writes nothing) and the declaration is once-only.
 *
 * The actor is minted from `verifySession()` — no parameter names a user or a
 * church, so a forged POST cannot declare somebody else's plant
 * (`memory/invariants.md` → Authentication).
 */
export async function declareJourney(
  input: DeclareJourneyInput
): Promise<DeclareJourneyState> {
  const { user } = await verifySession();

  if (user.role !== "planter") {
    return { status: "error", error: "Only church planters can onboard" };
  }

  if (!user.churchId) {
    return {
      status: "error",
      error: "Create your church plant before declaring where you are",
    };
  }

  // `null` rather than 0 on an unknown value — a POST carrying `stage=9` is a
  // caller error, not a Discovery declaration the planter never made.
  const phase = phaseForJourneyStage(input.stage);
  if (phase === null) {
    return { status: "error", error: "Choose where you are on the journey" };
  }

  // The empty string is what an untouched `<input type="date">` submits, and it
  // means the same thing as the explicit "no date yet": nothing to write.
  const rawDate = input.targetDate?.trim() || null;
  let targetDate: string | null = null;

  if (rawDate) {
    const parsedDate = launchTargetDateSchema.safeParse(rawDate);
    if (!parsedDate.success) {
      return { status: "error", error: parsedDate.error.issues[0].message };
    }

    const scheduled = await scheduleLaunchAction({
      targetDate: parsedDate.data,
    });

    if (!scheduled.success) {
      return { status: "error", error: scheduled.error };
    }

    targetDate = scheduled.data.targetDate;
  }

  try {
    const declared = await declareInitialPhase(user.churchId, user.id, {
      phase,
    });

    revalidateDashboard();

    return {
      status: "declared",
      // On `already_declared` the STORED phase is the answer, not the one just
      // submitted — the first declaration is the one that is history, and
      // reporting the submitted phase would show the planter a stage the
      // dashboard is not about to render.
      phase: declared.phase,
      targetDate,
    };
  } catch (error) {
    console.error("journey declaration failed", error);
    return {
      status: "error",
      error: "We could not save where you are just now. Please try again.",
    };
  }
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
 * OB-009 — FINISHING MARKS THE PLANT DIRTY. `last_material_event_at` is stamped
 * in the SAME statement as the completion, because finishing setup IS the
 * material event: a plant that just declared its stage, its launch date and its
 * people has changed enough to be worth assessing, and without the stamp a brand
 * new plant with no other activity would sit cold behind the 7-day staleness
 * window (`src/lib/phase-engine/assessment/dirty.ts`). One statement rather than
 * a follow-up `markPlantDirty()` call so the two facts cannot disagree, and
 * behind the same `IS NULL` guard so a second submit cannot re-dirty a plant
 * that finished days ago. Marking dirty is all this does — assessments are
 * generated by the daily run, never synchronously from a planter's click.
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

  const finishedAt = new Date();

  await db
    .update(churches)
    .set({
      onboardingCompletedAt: finishedAt,
      ...plantDirtyColumns(finishedAt),
    })
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
