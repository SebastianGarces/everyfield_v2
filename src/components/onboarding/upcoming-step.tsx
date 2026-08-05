import { Button } from "@/components/ui/button";
import {
  isLastOnboardingStep,
  type OnboardingStepId,
} from "@/lib/onboarding/steps";

/**
 * The shell body for the steps that are still shells (OB-001).
 *
 * Step 2 graduated to a real form with OB-004 (#202) and step 4 to the
 * bring-your-people step with OB-006 (`people-step.tsx`); step 3 is declared,
 * ordered, skippable and navigable, but captures nothing yet — its own issue
 * replaces this body with the real form. Until then the step still tells the
 * planter what it will ask, because a step that says nothing is worse than one
 * that sets an expectation, and every control out of here is real: Back, skip
 * forward, or leave for the dashboard.
 *
 * Nothing here writes, so skipping through from step 2 lands exactly today's
 * outcome — a named church at phase 0 with no launch date (AC 4).
 *
 * The step id is narrowed to what is still a shell rather than left open, so
 * graduating a step is a type error here until its copy is removed.
 */
type ShellStepId = Extract<OnboardingStepId, "journey">;

const UPCOMING_COPY: Record<ShellStepId, { intro: string; bullets: string[] }> =
  {
    journey: {
      intro:
        "Then we'll ask where you are today, so the dashboard, wiki and guidance match your stage instead of assuming you are starting from zero.",
      bullets: [
        "Your target launch date, or “no date yet”",
        "Which stage of the journey you are in",
      ],
    },
  };

export function UpcomingStep({
  step,
  onBack,
  onSkip,
  onFinish,
  busy,
}: {
  step: ShellStepId;
  /**
   * `null` when the previous step cannot be re-entered — step 1 has already
   * created the church, so there is nothing to go back and re-submit. Changing
   * the name or location afterwards belongs to church settings (OB-008), not to
   * a form that would fail with "you already have a church".
   */
  onBack: (() => void) | null;
  onSkip: () => void;
  onFinish: () => void;
  busy: boolean;
}) {
  const copy = UPCOMING_COPY[step];
  const isLast = isLastOnboardingStep(step);

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-sm">{copy.intro}</p>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          {copy.bullets.map((bullet) => (
            <li key={bullet}>{bullet}</li>
          ))}
        </ul>
        <p className="text-muted-foreground bg-muted/50 rounded-md p-3 text-sm">
          This step is not ready yet. Continue for now — your church plant is
          already saved, and we will ask again once it lands.
        </p>
      </div>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {onBack ? (
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={onBack}
            disabled={busy}
          >
            Back
          </Button>
        ) : (
          <span aria-hidden="true" />
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {!isLast && (
            <Button
              type="button"
              variant="ghost"
              className="cursor-pointer"
              onClick={onFinish}
              disabled={busy}
            >
              Finish setup later
            </Button>
          )}
          <Button
            type="button"
            className="cursor-pointer"
            onClick={isLast ? onFinish : onSkip}
            disabled={busy}
          >
            {isLast ? (busy ? "Finishing…" : "Go to my dashboard") : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}
