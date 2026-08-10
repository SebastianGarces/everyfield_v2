"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Church } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { completeOnboarding } from "@/app/(dashboard)/dashboard/actions";
import {
  ONBOARDING_STEP_IDS,
  ONBOARDING_STEP_PARAM,
  addressableOnboardingStep,
  isFirstOnboardingStep,
  isSkippableOnboardingStep,
  nextOnboardingStep,
  onboardingStep,
  previousOnboardingStep,
  type OnboardingStepId,
} from "@/lib/onboarding/steps";
import {
  leadershipAnswerForStatus,
  type ChurchLeadershipStatus,
} from "@/lib/onboarding/leadership";
import { ChurchBasicsStep } from "./church-basics-step";
import { FinishScreen } from "./finish-screen";
import { JourneyStep } from "./journey-step";
import { LeadershipStep } from "./leadership-step";
import { OnboardingStepRail } from "./onboarding-step-rail";
import { PeopleStep } from "./people-step";
import { shouldOfferTeamTemplates } from "./team-template-offer";

/**
 * F12 / OB-001 — the interactive half of the multi-step onboarding flow. The
 * facts it renders are resolved by its server component, `./onboarding-flow`,
 * which is what every call site imports.
 *
 * Which step is showing is UI state, not server state: the server decides where
 * the planter LANDS (`initialStep`, derived from what the church already
 * knows), the planter decides where they go from there. A page reload re-derives
 * the landing step from the database, so an abandoned flow resumes correctly
 * without anything being persisted per step.
 *
 * #373 — THAT UI STATE LIVES IN THE URL, not in `useState`. The flow has no
 * route of its own (it renders AS the dashboard while onboarding is unfinished),
 * so `?step=` is the only place anything outside this component can read which
 * step is showing — and the contextual wiki guide has to, because the guide is
 * scoped to step 3 alone (ruled on PR #367, option C: nothing on the finished
 * dashboard and nothing on steps 1/2/4). Making the URL the single source
 * rather than a mirror of state is what buys the rest for free: a deep link
 * opens on its step, and Back walks the steps instead of leaving the flow.
 *
 * The writes are `window.history.pushState`/`replaceState`, which Next patches
 * so `usePathname`/`useSearchParams` — here AND in the guide's provider — hold
 * the new value without a server render or an RSC fetch (`.next-docs` →
 * "Shallow routing on the client"). `router.push` would re-run the page for
 * every step change, which is exactly what this must not do.
 *
 * OB-007 — STEPS COMMIT INDEPENDENTLY, and this component is what makes that
 * true rather than merely intended. It holds no draft of anybody's answers:
 * each step owns its own form, saves through its own action, and only calls
 * back here once its write has committed. So there is no "submit the wizard"
 * moment, nothing accumulated in memory for a later failure to lose, and a step
 * that fails to save leaves every earlier step exactly as saved.
 *
 * Skipping is the same move minus the write (every step after step 1 is
 * `skippable`), which is why a skip is `goForward()` and nothing else — it
 * cannot lose an answer because it never had one.
 */
/**
 * Shown when the finish request itself failed — as opposed to `completeOnboarding`
 * returning a reason, which is rendered verbatim. Says what is safe (everything
 * already saved) and what to do (press it again), because both are true.
 */
const FINISH_FAILED_MESSAGE =
  "We could not finish setting up just now. Everything you have saved is safe — please try again.";

/** The finish screen's own heading and line, in the shape the steps use. */
const FINISH_SCREEN_TITLE = "You are set up";
const FINISH_SCREEN_DESCRIPTION =
  "One suggestion for where you said you are, then your dashboard.";

/**
 * The current URL with `?step=` set to `step`, every other param kept (#373).
 *
 * Built from `window.location` rather than from `usePathname`/`useSearchParams`
 * so it always reflects the address bar AT THE MOMENT of the write, including a
 * param some other client wrote since this render began. Only ever called from
 * an event handler or an effect, so `window` is defined.
 *
 * `null` REMOVES the param, which is how the finish screen is addressed without
 * being given a step id of its own (ruling 2026-08-10) — see the effect below.
 * `params.set` is also what collapses a repeated `?step=a&step=a` back to one
 * value, so a URL the server declined heals on the next stamp.
 */
function stepUrl(step: OnboardingStepId | null): string {
  const params = new URLSearchParams(window.location.search);
  if (step === null) params.delete(ONBOARDING_STEP_PARAM);
  else params.set(ONBOARDING_STEP_PARAM, step);
  const query = params.toString();
  return query
    ? `${window.location.pathname}?${query}`
    : window.location.pathname;
}

export function OnboardingFlowClient({
  initialStep,
  leadershipStatus,
  declaredPhase,
  teamsInitialized,
}: {
  initialStep: OnboardingStepId;
  /** The church's recorded OB-004 answer, so step 2 opens on it. */
  leadershipStatus: ChurchLeadershipStatus | null | undefined;
  /**
   * OB-015 / ruling 2026-08-09 — `churches.current_phase` as the server read it
   * for this render. NOT a cached copy anything displays
   * (`memory/contracts/data-patterns.md`): it is one of the two inputs to the
   * offer gate, it never enters state, and step 3's action revalidates the
   * dashboard so the next render carries the new value.
   */
  declaredPhase: number | null;
  /** OB-015 — does the plant already have ministry teams? Then there is nothing to offer. */
  teamsInitialized: boolean;
}) {
  const searchParams = useSearchParams();
  const [finishing, startFinishing] = useTransition();
  const [finishError, setFinishError] = useState<string | null>(null);

  /**
   * #373 — the step showing, read from the URL.
   *
   * `initialStep` is the FALLBACK, not the seed: it is what the server resolved
   * for a URL that names no step (a plain `/dashboard`) or names one it does
   * not recognise. Anything the URL does name has already been through the
   * page's guard — a step past step 1 without a church is redirected away
   * rather than ignored — so a value that survives to here is one the server
   * agreed to.
   *
   * Deriving instead of mirroring is the whole point. There is no `setStep` to
   * fall out of sync with the address bar, so Back, Forward, a deep link and a
   * reload all land on the same step as the URL they came from.
   *
   * `addressableOnboardingStep` is the client's half of the page's guard: a
   * value the server would not resolve must not be honoured here either, or the
   * flow renders the step the page declined. Today that is step 1 once the
   * church exists (ruling 2026-08-10) — the URL still reaches it through
   * Forward or a stale bookmark, and its form is a required field for a thing
   * already done whose second submit is discarded.
   */
  const stepParam = searchParams.get(ONBOARDING_STEP_PARAM);
  const urlStep = addressableOnboardingStep(stepParam, initialStep);

  // The answer step 3 just gave, which is UI state and not a copy of anything:
  // it is what the action REPORTED BACK about the declaration made moments ago,
  // held only so the offer can be decided before this render's props catch up.
  // The declaration itself lives on the church row, and `declaredPhase` below is
  // where it is read from on every later visit.
  const [declaredThisVisit, setDeclaredThisVisit] = useState<number | null>(
    null
  );

  // OB-015 — the step the finish screen was opened FROM, which is how it is
  // told apart from "not showing" now that the step behind it can change under
  // it (#373). The screen has no `?step=` of its own: it is not one of the four
  // steps, and inventing a fifth value would put a URL in a planter's hands
  // that reopens an offer whose gate they already answered (ruled 2026-08-10,
  // option B). So it is held as the step it belongs to, and a Back out of it —
  // which moves the URL to a step id again — closes it, instead of leaving the
  // offer painted over a step the planter has already returned to.
  const [finishScreenStep, setFinishScreenStep] =
    useState<OnboardingStepId | null>(null);

  // Showing while the URL still names the step it was opened from (the frame
  // before the effect below strips it) and while it names no step at all (every
  // frame after). What closes it is the URL naming a DIFFERENT step, which is
  // what browser Back off the screen does.
  const atFinishScreen =
    finishScreenStep !== null &&
    (urlStep === null || urlStep === finishScreenStep);

  // The step behind the finish screen keeps answering while it is up — the
  // param is gone from the URL, and "which step would I return to" must not
  // silently become the server's resume answer underneath it.
  const step: OnboardingStepId = urlStep ?? finishScreenStep ?? initialStep;

  // OB-015, ruling 2026-08-09 — the offer follows the PLANT'S STATE, not the
  // path taken to the finish screen. `declaredPhase` is what the church row says
  // (so a planter who declared phase 3 last week and resumed today is still
  // offered the teams), and the in-visit answer takes precedence only because it
  // is newer than the props of a render that began before the declaration.
  const offerTeamTemplates = shouldOfferTeamTemplates({
    declaredPhase: declaredThisVisit ?? declaredPhase,
    teamsInitialized,
  });

  // Focus the step heading whenever the planter moves, so a keyboard or screen
  // reader user is placed at the new step instead of at the top of the document
  // (or, worse, on a control that no longer exists). Skipped on first render —
  // arriving on a page should not yank focus.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (!hasNavigated.current) return;
    headingRef.current?.focus();
  }, [step, atFinishScreen]);

  /**
   * #373 — the other half of "the step lives in the URL": stamping it there
   * when the URL arrived without one.
   *
   * Without this, a planter who RESUMES onto step 3 sits at a bare
   * `/dashboard`, and the guide entry keyed on `/dashboard?step=journey` would
   * never match for exactly the planters it is for. So the step the flow is
   * showing is written even when nobody navigated to it.
   *
   * It is also what TAKES the step out of the URL for the OB-015 finish screen
   * (ruled 2026-08-10): the guide resolves from pathname + search params alone
   * (`wiki-guide-provider.tsx`), so `/dashboard?step=journey` painted the
   * journey Guide pill over the ministry-teams offer — a screen that does not
   * raise the question the guide answers, which the PR #367 option-C ruling
   * scoped it to. Removing the param is how the button goes without the screen
   * gaining a URL of its own: `/dashboard` matches no guide entry, and reloading
   * it resumes the flow rather than reopening the offer.
   *
   * ONE rule, one writer: "the URL says what is showing, and the finish screen
   * is not a step". Everything else — the arrival stamp, the heal after a
   * declined value — falls out of the same comparison.
   *
   * `replaceState`, never `pushState`: arriving is not navigating, and a
   * history entry here would make Back a no-op that appears to do nothing. It
   * is also self-healing rather than mount-only — the condition is "the URL
   * disagrees with what is showing", which a `goTo` push has already satisfied
   * by the time this runs, so it writes once and then stays quiet.
   *
   * A history write is a side effect on an external system, which is what
   * `useEffect` is for. Nothing here copies server data into state
   * (`memory/contracts/data-patterns.md`) — the flow reads FROM the URL.
   */
  const urlStepParam: OnboardingStepId | null = atFinishScreen ? null : step;

  useEffect(() => {
    if (stepParam === urlStepParam) return;
    window.history.replaceState(null, "", stepUrl(urlStepParam));
  }, [stepParam, urlStepParam]);

  function goTo(next: OnboardingStepId) {
    hasNavigated.current = true;
    setFinishError(null);
    // Leaving the finish screen behind explicitly, so a later Forward back onto
    // this step does not re-open an offer the planter has moved past.
    setFinishScreenStep(null);

    // Ruled 2026-08-10: STEP 1 IS NOT IN THE HISTORY. The only way off it is
    // creating the church, so by the time this runs the church exists and step
    // 1 is not re-enterable — the in-app Back control has always said so
    // (`backTarget` below), and browser Back said otherwise, landing a planter
    // on an empty required "Create church plant" form whose second submit is
    // discarded (`runCreateChurch`'s already-have-church branch). Replacing
    // rather than pushing takes the entry out of the history instead of asking
    // step 1 to render a state it has no answer for. The cost is named and
    // accepted: Back from step 2 now leaves the flow, because behind step 2
    // there is nothing left to go back to.
    //
    // Shallow either way: the URL and the router's view of it change, the
    // server render does not re-run.
    if (isFirstOnboardingStep(step)) {
      window.history.replaceState(null, "", stepUrl(next));
      return;
    }

    // The push is what gives Back the step just left.
    window.history.pushState(null, "", stepUrl(next));
  }

  function goForward() {
    const next = nextOnboardingStep(step);

    if (next) {
      goTo(next);
      return;
    }

    // Past the last step there is only the dashboard, so "forward" from there
    // is finishing — which is what makes "completing OR skipping through the
    // final step lands on /dashboard?churchCreated=true" true of every control
    // that moves forward, not just of the one labelled Finish (OB-001 AC).
    finish();
  }

  // OB-005 tells us where the planter says they are, and OB-015 spends it: the
  // stored phase comes back from step 3's action, so a re-declaration reports
  // the phase the dashboard is about to render rather than the one just typed.
  function handleDeclared(phase: number) {
    setDeclaredThisVisit(phase);
    goForward();
  }

  // OB-007: skipping is advancing without writing. It shares `goForward` on
  // purpose — a skip that had its own path could grow a save, and the whole
  // point of the control is that nothing is committed by it.
  const canSkip = isSkippableOnboardingStep(step) && !finishing;

  // Step 1 is not re-enterable: the church already exists, so a second submit
  // would be a no-op that advances again rather than an edit (see the
  // already-have-church branch in `runCreateChurch`). Changing the name or
  // location later is church settings' job (OB-008).
  const previousStep = previousOnboardingStep(step);
  const backTarget = previousStep === "basics" ? null : previousStep;

  function goBack() {
    if (backTarget) goTo(backTarget);
  }

  /**
   * The flow's ONE exit, which is why OB-015's offer lives inside it rather
   * than on the control that happens to be pressed: every way out — Continue
   * past the last step, "Finish setup later" from any step, the finish screen's
   * own "not now" — arrives here, so the offer cannot be reachable from one and
   * missing from another.
   *
   * The offer is a screen, not a dialog: it takes over the card the steps were
   * in, and returning early leaves the planter in the flow with nothing
   * committed. The `atFinishScreen` guard is what keeps the second press (the
   * decline, which is this same function) from re-offering forever.
   */
  function finish() {
    if (!atFinishScreen && offerTeamTemplates) {
      hasNavigated.current = true;
      setFinishError(null);
      setFinishScreenStep(step);
      return;
    }

    setFinishError(null);
    startFinishing(async () => {
      try {
        // Resolves only on FAILURE — success redirects to
        // /dashboard?churchCreated=true and this callback never continues. So
        // the result is optional by contract (#243:
        // `CompleteOnboardingState | void`) and is read with `?.` rather than on
        // the assumption that `redirect()` stays typed `never`.
        const result = await completeOnboarding();
        setFinishError(result?.error ?? null);
      } catch {
        // The OTHER way the action can fail to return a state: it REJECTED —
        // the request never reached the server, or the server threw something
        // it did not turn into an outcome. Uncaught, that rejection escapes an
        // async transition callback, so nothing renders and the button is left
        // sitting in its pending state: the planter's church, their leadership
        // answer and their people are all safely saved, and the only thing they
        // can see is a control that no longer responds. Caught, the same
        // failure is a message and a button they can press again — finishing is
        // idempotent (the `IS NULL` guard on `onboarding_completed_at`), so a
        // retry is always safe.
        //
        // This does not swallow the success path: `redirect()` in a server
        // action is carried back as a navigation, not as a rejection here.
        setFinishError(FINISH_FAILED_MESSAGE);
      }
    });
  }

  const current = onboardingStep(step);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="space-y-4">
        <div className="flex items-center gap-3">
          <div className="bg-primary/10 flex size-10 items-center justify-center rounded-lg">
            <Church className="text-primary size-5" aria-hidden="true" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">
              Set up your church plant
            </h1>
            <p className="text-muted-foreground text-sm">
              A few quick questions so EveryField matches where you actually
              are. Only the first step is required.
            </p>
          </div>
        </div>

        {/* The rail describes the four steps, and the finish screen is not one
            of them — it is what stands between the last step and the dashboard,
            so leaving it out says "the steps are behind you" rather than
            inventing a fifth. */}
        {!atFinishScreen && <OnboardingStepRail currentStep={step} />}
      </div>

      <Card>
        <CardHeader>
          <p className="text-muted-foreground text-sm font-medium">
            {atFinishScreen
              ? "Setup complete"
              : `Step ${current.number} of ${ONBOARDING_STEP_IDS.length}`}
          </p>
          {/* tabIndex -1 so focus can be moved here on step change without
              adding a stop to the tab order. */}
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-lg leading-none font-semibold outline-none"
          >
            {atFinishScreen ? FINISH_SCREEN_TITLE : current.title}
          </h2>
          <CardDescription>
            {atFinishScreen ? FINISH_SCREEN_DESCRIPTION : current.description}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-4">
          {finishError && (
            <p
              role="alert"
              className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
            >
              {finishError}
            </p>
          )}

          {atFinishScreen ? (
            // OB-015: the stage-gated offer. It is reached only through the
            // gate in `finish()`, so by here the plant is at phase 2 or later
            // and has no teams — the screen itself asks nothing about either,
            // and its "not now" is the same `finish` that put them here.
            <FinishScreen onDone={finish} busy={finishing} />
          ) : step === "basics" ? (
            <ChurchBasicsStep onCreated={goForward} />
          ) : step === "leadership" ? (
            <LeadershipStep
              initialAnswer={leadershipAnswerForStatus(leadershipStatus)}
              onSaved={goForward}
              secondary={
                <>
                  {/* OB-007: step 2 is skippable like every step after the
                      first. Without this the only ways out were answering the
                      question or leaving the flow entirely — which is the
                      "wizard prison" the FRD is written against. Skipping
                      writes nothing, so the question stays unanswered and the
                      planter resumes here on their next visit. */}
                  <Button
                    type="button"
                    variant="ghost"
                    className="cursor-pointer"
                    onClick={goForward}
                    disabled={!canSkip}
                  >
                    Skip for now
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    className="cursor-pointer"
                    onClick={finish}
                    disabled={finishing}
                  >
                    Finish setup later
                  </Button>
                </>
              }
            />
          ) : step === "journey" ? (
            // OB-003 + OB-005: the launch date (through the launch entity's
            // service write path — never a column on `churches`) and the
            // initial stage declaration, committed together.
            <JourneyStep
              onDeclared={handleDeclared}
              onBack={backTarget ? goBack : null}
              onSkip={goForward}
              onFinish={finish}
              busy={finishing}
            />
          ) : (
            // OB-006: the last step is real — it surfaces the existing CSV
            // wizard and quick-add. It still writes nothing of its own, so the
            // controls it gets are the flow's own skip/finish, unchanged.
            <PeopleStep
              onBack={backTarget ? goBack : null}
              onSkip={goForward}
              onFinish={finish}
              busy={finishing}
              // OB-015: on the last step the forward control normally IS the
              // way to the dashboard, so it says so. When the offer is still to
              // come, saying so would be a lie by one screen.
              finishLabel={offerTeamTemplates ? "Continue" : undefined}
            />
          )}
        </CardContent>
      </Card>

      {/* Announced on every step change for assistive tech. */}
      <p aria-live="polite" className="sr-only">
        {atFinishScreen
          ? FINISH_SCREEN_TITLE
          : `Step ${current.number} of ${ONBOARDING_STEP_IDS.length}: ${current.title}`}
      </p>
    </div>
  );
}
