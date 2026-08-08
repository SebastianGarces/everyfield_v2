"use client";

import { useId, useState, useTransition } from "react";

import { declareJourney } from "@/app/(dashboard)/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  JOURNEY_STAGE_OPTIONS,
  isLaunchDateChoice,
  phaseForJourneyStage,
  type LaunchDateChoice,
} from "@/lib/onboarding/steps";

/**
 * F12 / OB-003 + OB-005 — step 3 of onboarding: your journey.
 *
 * TWO QUESTIONS, ONE COMMIT. "When do you hope to launch?" and "where are you
 * today?" are asked together because they are one thought — a planter who
 * names a date in six weeks is telling you their stage as surely as the picker
 * does — and they are saved by one action so the fact snapshot the declaration
 * captures already contains the date (see `declareJourney`).
 *
 * "NO DATE YET" IS AN ANSWER, not an empty field. A planter still discerning
 * the call genuinely has no day, and the FRD asks for that to be sayable rather
 * than inferred from a blank input — so it is a radio option, and choosing it
 * writes no launch row at all. The countdown then reads empty rather than zero,
 * which is the acceptance criterion.
 *
 * NOTHING HERE IS SERVER DATA IN `useState`. The two selections and the typed
 * date are the planter's own input while they answer
 * (`memory/contracts/data-patterns.md`); the server's copy is written by the
 * action, which revalidates, and the step advances rather than re-reading.
 *
 * The step is skippable like every step after the first (OB-007): skipping
 * writes nothing, leaves phase 0 and no launch, and the planter is asked again
 * by the dashboard nudge.
 */
export function JourneyStep({
  onDeclared,
  onBack,
  onSkip,
  onFinish,
  busy,
}: {
  /** Called once the declaration has COMMITTED — the flow then advances. */
  onDeclared: () => void;
  /** `null` when the previous step cannot be re-entered. See `PeopleStep`. */
  onBack: (() => void) | null;
  onSkip: () => void;
  onFinish: () => void;
  busy: boolean;
}) {
  const [dateChoice, setDateChoice] = useState<LaunchDateChoice | null>(null);
  const [targetDate, setTargetDate] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dateInputId = useId();
  const disabled = pending || busy;

  function handleSubmit() {
    if (!dateChoice) {
      setError("Let us know whether you have a launch date in mind.");
      return;
    }

    if (dateChoice === "date" && !targetDate) {
      setError("Pick the Sunday you are aiming at, or choose “no date yet”.");
      return;
    }

    if (phaseForJourneyStage(stage) === null) {
      setError("Choose where you are on the journey.");
      return;
    }

    setError(null);

    startTransition(async () => {
      try {
        const result = await declareJourney({
          stage: stage as string,
          targetDate: dateChoice === "date" ? targetDate : null,
        });

        if (result.status === "error") {
          setError(result.error);
          return;
        }

        onDeclared();
      } catch {
        // The action rejected — the request never reached the server, or the
        // server threw something it did not turn into an outcome. Uncaught,
        // that rejection escapes an async transition callback and leaves the
        // button stuck pending with nothing rendered. Caught, it is a sentence
        // and a button they can press again; re-submitting is safe (the date
        // write is a compare-and-set, the declaration is once-only).
        setError(
          "We could not save that just now. Nothing else you have entered is affected — please try again."
        );
      }
    });
  }

  return (
    <div className="space-y-6">
      {error && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
        >
          {error}
        </p>
      )}

      {/* ---- OB-003: the launch date, or an explicit "no date yet" ---- */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          When do you hope to launch?
        </legend>
        <p className="text-muted-foreground text-sm">
          Launch Sunday is what the countdown, your readiness list and most of
          the guidance are measured against. A best guess is fine — you can move
          it later, and every change is recorded.
        </p>

        <RadioGroup
          name="launch-date-choice"
          value={dateChoice ?? ""}
          onValueChange={(value) => {
            if (!isLaunchDateChoice(value)) return;
            setDateChoice(value);
            setError(null);
          }}
          disabled={disabled}
          className="gap-2"
        >
          <ChoiceOption
            id="launch-date-known"
            value="date"
            label="We have a date in mind"
            hint="We will start the countdown and seed your Launch Playbook milestones."
          >
            {dateChoice === "date" && (
              <div className="space-y-1.5 pt-1">
                <Label htmlFor={dateInputId} className="text-sm font-normal">
                  Target launch date
                </Label>
                <Input
                  id={dateInputId}
                  name="targetDate"
                  type="date"
                  value={targetDate}
                  onChange={(event) => {
                    setTargetDate(event.target.value);
                    setError(null);
                  }}
                  disabled={disabled}
                  className="w-full cursor-pointer sm:max-w-56"
                />
              </div>
            )}
          </ChoiceOption>

          <ChoiceOption
            id="launch-date-none"
            value="none"
            label="No date yet"
            hint="Nothing is recorded, and the countdown stays empty until you name a day."
          />
        </RadioGroup>
      </fieldset>

      {/* ---- OB-005: the stage declaration ---- */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">Where are you today?</legend>
        <p className="text-muted-foreground text-sm">
          We will start you here instead of at zero — the dashboard, the wiki
          and the guidance all follow it. Nothing is invented behind you: we
          record this as where you already were, not as steps you took in
          EveryField.
        </p>

        <RadioGroup
          name="stage"
          value={stage ?? ""}
          onValueChange={(value) => {
            setStage(value);
            setError(null);
          }}
          disabled={disabled}
          className="gap-2"
        >
          {JOURNEY_STAGE_OPTIONS.map((option) => (
            <ChoiceOption
              key={option.value}
              id={`stage-${option.value}`}
              value={option.value}
              label={option.label}
              hint={option.hint}
              tag={option.phaseName}
            />
          ))}
        </RadioGroup>
      </fieldset>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {onBack ? (
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={onBack}
            disabled={disabled}
          >
            Back
          </Button>
        ) : (
          <span aria-hidden="true" />
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <Button
            type="button"
            variant="ghost"
            className="cursor-pointer"
            onClick={onSkip}
            disabled={disabled}
          >
            Skip for now
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="cursor-pointer"
            onClick={onFinish}
            disabled={disabled}
          >
            Finish setup later
          </Button>
          <Button
            type="button"
            className="cursor-pointer"
            onClick={handleSubmit}
            disabled={disabled}
          >
            {pending ? "Saving…" : "Continue"}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * One radio option: a bordered target the whole label sits inside, with room
 * underneath for whatever the choice reveals (the date input).
 *
 * The card is not clickable — the radio and its label are the only targets, so
 * there is one hit area per choice rather than two that behave differently.
 */
function ChoiceOption({
  id,
  value,
  label,
  hint,
  tag,
  children,
}: {
  id: string;
  value: string;
  label: string;
  hint: string;
  /** The methodology's own name for the phase, shown small alongside. */
  tag?: string;
  children?: React.ReactNode;
}) {
  return (
    <div className="border-border has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/5 rounded-md border p-3 transition-colors">
      <div className="flex items-start gap-3">
        <RadioGroupItem id={id} value={value} className="mt-0.5" />
        <div className="min-w-0 space-y-1">
          <Label htmlFor={id} className="cursor-pointer font-medium">
            {label}
          </Label>
          <p className="text-muted-foreground text-sm">{hint}</p>
          {tag && (
            <p className="text-muted-foreground/80 text-xs tracking-wide">
              {tag}
            </p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
