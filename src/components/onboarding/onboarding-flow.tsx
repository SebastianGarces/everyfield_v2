"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { Church } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
} from "@/components/ui/card";
import { completeOnboarding } from "@/app/(dashboard)/dashboard/actions";
import {
  ONBOARDING_STEP_IDS,
  nextOnboardingStep,
  onboardingStep,
  previousOnboardingStep,
  type OnboardingStepId,
} from "@/lib/onboarding/steps";
import { ChurchBasicsStep } from "./church-basics-step";
import { OnboardingStepRail } from "./onboarding-step-rail";
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
 */
export function OnboardingFlow({
  initialStep,
}: {
  initialStep: OnboardingStepId;
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
    if (next) goTo(next);
  }

  // Step 1 is not re-enterable: it has already created the church, and a second
  // submit would fail rather than edit. Editing the name or location later is
  // church settings' job (OB-008).
  const previousStep = previousOnboardingStep(step);
  const backTarget = previousStep === "basics" ? null : previousStep;

  function goBack() {
    if (backTarget) goTo(backTarget);
  }

  function finish() {
    setFinishError(null);
    startFinishing(async () => {
      // Resolves only on failure — success redirects to the dashboard.
      const result = await completeOnboarding();
      setFinishError(result.error);
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
