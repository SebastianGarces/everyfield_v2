import { cn } from "@/lib/utils";
import {
  ONBOARDING_STEPS,
  onboardingStepIndex,
  type OnboardingStepId,
} from "@/lib/onboarding/steps";
import { Check } from "lucide-react";

/**
 * The "where am I" rail for the onboarding flow.
 *
 * Deliberately NOT interactive. A planter cannot jump to step 4 before step 1
 * has created the church, so rendering the rail as buttons would advertise
 * moves that are not available; navigation lives on the step's own Back /
 * Continue / Skip controls, which are always genuinely actionable. That also
 * keeps the rail out of the tab order, so a keyboard user reaches the fields
 * they came for instead of tabbing past four decorations on every step.
 */
export function OnboardingStepRail({
  currentStep,
}: {
  currentStep: OnboardingStepId;
}) {
  const currentIndex = onboardingStepIndex(currentStep);

  return (
    <ol className="flex flex-wrap items-center gap-x-2 gap-y-3 sm:gap-x-3">
      {ONBOARDING_STEPS.map((step, index) => {
        const isCurrent = index === currentIndex;
        const isComplete = index < currentIndex;

        return (
          <li
            key={step.id}
            aria-current={isCurrent ? "step" : undefined}
            className="flex items-center gap-2"
          >
            <span
              aria-hidden="true"
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-full border text-xs font-medium transition-colors",
                isCurrent &&
                  "border-primary bg-primary text-primary-foreground",
                isComplete && "border-primary/40 bg-primary/10 text-primary",
                !isCurrent &&
                  !isComplete &&
                  "border-border text-muted-foreground"
              )}
            >
              {isComplete ? <Check className="size-3.5" /> : step.number}
            </span>
            <span
              className={cn(
                "text-sm",
                isCurrent
                  ? "text-foreground font-medium"
                  : "text-muted-foreground"
              )}
            >
              {step.title}
              <span className="sr-only">
                {isCurrent
                  ? " (current step)"
                  : isComplete
                    ? " (completed)"
                    : " (not started)"}
              </span>
            </span>
            {index < ONBOARDING_STEPS.length - 1 && (
              <span
                aria-hidden="true"
                className="bg-border hidden h-px w-6 sm:block"
              />
            )}
          </li>
        );
      })}
    </ol>
  );
}
