"use server";

import { verifySession } from "@/lib/auth/session";
import {
  createChurchDeps,
  runCreateChurch,
  type CreateChurchOutcome,
} from "@/lib/onboarding/create-church";
import { completeOnboardingStatement } from "@/lib/onboarding/complete-onboarding";
import {
  declareJourneyDeps,
  runDeclareJourney,
  type DeclareJourneyInput,
  type DeclareJourneyState,
} from "@/lib/onboarding/declare-journey";
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

export type {
  DeclareJourneyErrorField,
  DeclareJourneyInput,
  DeclareJourneyState,
} from "@/lib/onboarding/declare-journey";

/**
 * F12 / OB-003 + OB-005 — step 3 of onboarding: where are you, and when do you
 * hope to launch?
 *
 * A wrapper on purpose, exactly like its three siblings. Every rule — the date
 * going through the launch entity's one rail BEFORE the declaration, the
 * "no date yet" re-entry refusal, `already_declared` reporting the STORED
 * phase — lives in `runDeclareJourney`
 * (`src/lib/onboarding/declare-journey.ts`), which is ordinary server code the
 * tests drive through `DeclareJourneyDeps`. The actor is minted from
 * `verifySession()` — no parameter names a user or a church, so a forged POST
 * cannot declare somebody else's plant (`memory/invariants.md` →
 * Authentication).
 */
export async function declareJourney(
  input: DeclareJourneyInput
): Promise<DeclareJourneyState> {
  const { user } = await verifySession();

  return runDeclareJourney(
    declareJourneyDeps(revalidateDashboard),
    { id: user.id, role: user.role, churchId: user.churchId },
    input
  );
}

export type CompleteOnboardingState = { status: "error"; error: string };

/**
 * F12 / OB-001 — leave the onboarding flow and hand the dashboard back.
 *
 * The one statement — the idempotent `IS NULL`-guarded completion UPDATE that
 * also marks the plant dirty (OB-009) — lives in
 * `completeOnboardingStatement` (`src/lib/onboarding/complete-onboarding.ts`),
 * where the tests can read its SQL. This export mints the actor and redirects.
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

  await completeOnboardingStatement(user.churchId, new Date());

  revalidateDashboard();

  // The confetti's trigger, preserved (OB-001 AC): finishing OR skipping
  // through the final step lands here, and the dashboard reads the flag.
  redirect("/dashboard?churchCreated=true");
}
