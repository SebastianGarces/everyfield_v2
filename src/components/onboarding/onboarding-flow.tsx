"use client";

import { useEffect, useRef, useState, useTransition } from "react";
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
import { LeadershipStep } from "./leadership-step";
import { OnboardingStepRail } from "./onboarding-step-rail";
import { PeopleStep } from "./people-step";
import { UpcomingStep } from "./upcoming-step";

/**
 * F12 / OB-001 — the multi-step onboarding flow that replaces the single-field
 * create-church card as the primary dashboard content for a planter who has not
 * finished setting up.
 *
 * Which step is showing is UI state, not server state: the server decides where
 * the planter LANDS (`initialStep`, derived from what the church already
 * knows), the planter decides where they go from there. A page reload re-derives
 * the landing step from the database, so an abandoned flow resumes correctly
 * without anything being persisted per step.
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

export function OnboardingFlow({
  initialStep,
  leadershipStatus,
}: {
  initialStep: OnboardingStepId;
  /** The church's recorded OB-004 answer, so step 2 opens on it. */
  leadershipStatus: ChurchLeadershipStatus | null | undefined;
}) {
  const [step, setStep] = useState<OnboardingStepId>(initialStep);
  const [finishing, startFinishing] = useTransition();
  const [finishError, setFinishError] = useState<string | null>(null);

  // Focus the step heading whenever the planter moves, so a keyboard or screen
  // reader user is placed at the new step instead of at the top of the document
  // (or, worse, on a control that no longer exists). Skipped on first render —
  // arriving on a page should not yank focus.
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasNavigated = useRef(false);

  useEffect(() => {
    if (!hasNavigated.current) return;
    headingRef.current?.focus();
  }, [step]);

  function goTo(next: OnboardingStepId) {
    hasNavigated.current = true;
    setFinishError(null);
    setStep(next);
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

  function finish() {
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

        <OnboardingStepRail currentStep={step} />
      </div>

      <Card>
        <CardHeader>
          <p className="text-muted-foreground text-sm font-medium">
            Step {current.number} of {ONBOARDING_STEP_IDS.length}
          </p>
          {/* tabIndex -1 so focus can be moved here on step change without
              adding a stop to the tab order. */}
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="text-lg leading-none font-semibold outline-none"
          >
            {current.title}
          </h2>
          <CardDescription>{current.description}</CardDescription>
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

          {step === "basics" ? (
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
          ) : step === "people" ? (
            // OB-006: the last step is real — it surfaces the existing CSV
            // wizard and quick-add. It still writes nothing of its own, so the
            // controls it gets are the flow's own skip/finish, unchanged.
            <PeopleStep
              onBack={backTarget ? goBack : null}
              onSkip={goForward}
              onFinish={finish}
              busy={finishing}
            />
          ) : (
            <UpcomingStep
              step={step}
              onBack={backTarget ? goBack : null}
              onSkip={goForward}
              onFinish={finish}
              busy={finishing}
            />
          )}
        </CardContent>
      </Card>

      {/* Announced on every step change for assistive tech. */}
      <p aria-live="polite" className="sr-only">
        Step {current.number} of {ONBOARDING_STEP_IDS.length}: {current.title}
      </p>
    </div>
  );
}
