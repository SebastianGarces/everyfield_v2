"use client";

import { useId, useRef, useState, useTransition } from "react";

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
 *
 * WHERE THE ERROR IS RENDERED IS PART OF THE ERROR. This is the tallest step in
 * the flow — two fieldsets and nine options — so a single message pinned to the
 * top is, on a phone, a message the planter cannot see from the button that
 * produced it. Each failure is therefore attached to the question that failed:
 * rendered under that fieldset and named by its `aria-describedby`, so it is
 * both reachable by eye and reported by a screen reader when the group takes
 * focus, not only announced once as it appears.
 */

/** Which question a validation message belongs to. */
type JourneyErrorField = "date" | "stage" | "form";

type JourneyError = { field: JourneyErrorField; message: string };
export function JourneyStep({
  onDeclared,
  onBack,
  onSkip,
  onFinish,
  busy,
}: {
  /**
   * Called once the declaration has COMMITTED — the flow then advances.
   *
   * Carries the phase the SERVER now holds, not the one just submitted: on a
   * re-declaration the first declaration is the one that is history, and
   * `declareJourney` reports it back for exactly that reason. OB-015's offer is
   * gated on this number, so handing up the submitted value would offer a
   * planter the team structure for a stage their dashboard is not about to show
   * them.
   */
  onDeclared: (phase: number) => void;
  /** `null` when the previous step cannot be re-entered. See `PeopleStep`. */
  onBack: (() => void) | null;
  onSkip: () => void;
  onFinish: () => void;
  busy: boolean;
}) {
  const [dateChoice, setDateChoice] = useState<LaunchDateChoice | null>(null);
  const [targetDate, setTargetDate] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [error, setError] = useState<JourneyError | null>(null);
  const [pending, startTransition] = useTransition();

  const dateInputId = useId();
  const dateErrorId = useId();
  const stageErrorId = useId();
  const formErrorId = useId();
  const disabled = pending || busy;

  /**
   * Set when the planter picks "We have a date in mind", consumed by the date
   * input's ref the moment it mounts. Revealing a field and leaving the caret
   * where it was makes the planter hunt for what just appeared — and a keyboard
   * planter has to Tab back through the radio group to reach it.
   */
  const focusDateOnMount = useRef(false);

  function handleSubmit() {
    if (!dateChoice) {
      setError({
        field: "date",
        message: "Let us know whether you have a launch date in mind.",
      });
      return;
    }

    if (dateChoice === "date" && !targetDate) {
      setError({
        field: "date",
        message: "Pick the Sunday you are aiming at, or choose “no date yet”.",
      });
      return;
    }

    if (phaseForJourneyStage(stage) === null) {
      setError({
        field: "stage",
        message: "Choose where you are on the journey.",
      });
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
          setError({ field: "form", message: result.error });
          return;
        }

        onDeclared(result.phase);
      } catch {
        // The action rejected — the request never reached the server, or the
        // server threw something it did not turn into an outcome. Uncaught,
        // that rejection escapes an async transition callback and leaves the
        // button stuck pending with nothing rendered. Caught, it is a sentence
        // and a button they can press again; re-submitting is safe (the date
        // write is a compare-and-set, the declaration is once-only).
        setError({
          field: "form",
          message:
            "We could not save that just now. Nothing else you have entered is affected — please try again.",
        });
      }
    });
  }

  const dateError = error?.field === "date" ? error.message : null;
  const stageError = error?.field === "stage" ? error.message : null;
  const formError = error?.field === "form" ? error.message : null;

  return (
    // A real form, like every other step in this flow: pressing Enter in the
    // date field submits instead of doing nothing. `onSubmit` rather than
    // `action`, because the inputs are controlled and the submit already runs
    // inside `startTransition`.
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        handleSubmit();
      }}
    >
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
            focusDateOnMount.current = value === "date";
            setError(null);
          }}
          disabled={disabled}
          aria-invalid={dateError ? true : undefined}
          aria-describedby={dateError ? dateErrorId : undefined}
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
                  ref={(node) => {
                    if (!node || !focusDateOnMount.current) return;
                    focusDateOnMount.current = false;
                    node.focus();
                  }}
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
            // "Nothing is recorded" read like "this step saves nothing", which
            // is the opposite of true — the stage below is still recorded.
            hint="We record no launch date, and the countdown stays empty until you name a day."
          />
        </RadioGroup>

        <FieldError id={dateErrorId} message={dateError} />
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
          aria-invalid={stageError ? true : undefined}
          aria-describedby={stageError ? stageErrorId : undefined}
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

        <FieldError id={stageErrorId} message={stageError} />
      </fieldset>

      {/* A failure of the SAVE, not of a field — it belongs beside the button
          that tried, not under a question the planter answered correctly. */}
      {formError && (
        <p
          id={formErrorId}
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
        >
          {formError}
        </p>
      )}

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
          <Button type="submit" className="cursor-pointer" disabled={disabled}>
            {pending ? "Saving…" : "Continue"}
          </Button>
        </div>
      </div>
    </form>
  );
}

/**
 * A validation message for ONE question, rendered under it and named by its
 * `aria-describedby`.
 *
 * `role="alert"` announces it when it appears; the `id` link is what makes it
 * readable AGAIN when the planter moves focus back into the group they got
 * wrong — an announcement alone is gone the moment it is spoken.
 */
function FieldError({ id, message }: { id: string; message: string | null }) {
  if (!message) return null;
  return (
    <p id={id} role="alert" className="text-destructive text-sm">
      {message}
    </p>
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
            <p className="text-muted-foreground text-xs tracking-wide">{tag}</p>
          )}
          {children}
        </div>
      </div>
    </div>
  );
}
