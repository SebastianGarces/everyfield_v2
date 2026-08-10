"use client";

import { useEffect, useId, useRef, useState, useTransition } from "react";

import { declareJourney } from "@/app/(dashboard)/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { formatDate } from "@/lib/datetime";
import { parseTargetDate } from "@/lib/launch/countdown";
import {
  JOURNEY_STAGE_OPTIONS,
  isLaunchDateChoice,
  journeyStageForPhase,
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
 * focus, not only announced once as it appears. And the planter is TAKEN there
 * — `refuse()` focuses the failing fieldset, because a message rendered above
 * the fold on a screen whose submit button is below it is a submit that appears
 * to do nothing at all.
 */

/** Which question a validation message belongs to. */
type JourneyErrorField = "date" | "stage" | "form";

type JourneyError = { field: JourneyErrorField; message: string };

/**
 * The refusal state: this plant had already declared its starting stage, so the
 * stage half of the submit wrote nothing (ruled 2026-08-09 — a re-declaration is
 * refused, never overwritten). It is the outcome of the planter's own submit,
 * held exactly like `error` is; it is not a copy of server data kept in sync
 * (`memory/contracts/data-patterns.md`).
 */
type JourneyRecorded = {
  /** The stage ON RECORD — the first declaration, not the one just submitted. */
  phase: number;
  /** The date this submit DID save, or `null` if the planter named no day. */
  targetDate: string | null;
};
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
  const [recorded, setRecorded] = useState<JourneyRecorded | null>(null);
  const [pending, startTransition] = useTransition();

  const dateInputId = useId();
  const dateErrorId = useId();
  const stageErrorId = useId();
  const formErrorId = useId();
  const recordedId = useId();
  // Once the stage is on record the questions are answered for good, so the
  // controls stop pretending otherwise: a second submit would be refused by the
  // same index, and a live radio group invites exactly that.
  const disabled = pending || busy || recorded !== null;

  /**
   * Set when the planter picks "We have a date in mind", consumed by the date
   * input's ref the moment it mounts. Revealing a field and leaving the caret
   * where it was makes the planter hunt for what just appeared — and a keyboard
   * planter has to Tab back through the radio group to reach it.
   */
  const focusDateOnMount = useRef(false);

  /**
   * The refusal takes focus when it appears.
   *
   * It is the answer to the button the planter just pressed, and it replaces
   * that button — leaving focus on a control that has become "Continue" means a
   * screen-reader user hears a new label with no idea why, and a sighted
   * keyboard user's next Enter walks straight past the sentence. Focusing the
   * panel reads it out and puts Continue one Tab away.
   */
  const recordedRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (recorded) recordedRef.current?.focus();
  }, [recorded]);

  /**
   * The two questions, so a refusal can move focus to the one that failed.
   *
   * Rendering the message under its own fieldset is half the fix; the other
   * half is going there. This is the tallest step in the flow, and the button
   * that fails sits below both questions — on a phone, a message attached to
   * the first fieldset is a message off the top of the screen, and a submit
   * that appears to do nothing. Focusing the fieldset scrolls it into view and
   * makes a screen reader read the legend, the description and the error it is
   * now described by.
   */
  const dateFieldsetRef = useRef<HTMLFieldSetElement>(null);
  const stageFieldsetRef = useRef<HTMLFieldSetElement>(null);

  function refuse(field: JourneyErrorField, message: string) {
    setError({ field, message });
    if (field === "date") dateFieldsetRef.current?.focus();
    if (field === "stage") stageFieldsetRef.current?.focus();
  }

  function handleSubmit() {
    if (!dateChoice) {
      refuse("date", "Let us know whether you have a launch date in mind.");
      return;
    }

    if (dateChoice === "date" && !targetDate) {
      refuse(
        "date",
        "Pick the Sunday you are aiming at, or choose “no date yet”."
      );
      return;
    }

    if (phaseForJourneyStage(stage) === null) {
      refuse("stage", "Choose where you are on the journey.");
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
          // The server says which question refused; "form" is the fallback for
          // a failure that belongs to the save rather than to a field.
          refuse(result.field ?? "form", result.error);
          return;
        }

        if (result.status === "already_declared") {
          // NOT an advance. The stage was not saved, so the planter is not sent
          // on as though it had been — they read what is on record, and press
          // Continue themselves.
          setRecorded({ phase: result.phase, targetDate: result.targetDate });

          // And the picker is moved onto the RECORDED stage. Left alone it kept
          // the planter's rejected answer checked while the panel underneath
          // named a different one — two claims about the same fact, on one
          // screen, in the same glance. The disabled picker is now a reading of
          // what is stored, which is what it has become.
          const onRecord = journeyStageForPhase(result.phase);
          if (onRecord) setStage(onRecord.value);
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
        refuse(
          "form",
          "We could not save that just now. Nothing else you have entered is affected — please try again."
        );
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
      {/* `tabIndex={-1}` so a refusal can put focus here without adding a stop
          to the tab order — the same device the flow uses on its step heading
          (`onboarding-flow-client.tsx`). */}
      <fieldset
        ref={dateFieldsetRef}
        tabIndex={-1}
        className="space-y-3 outline-none"
      >
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
      <fieldset
        ref={stageFieldsetRef}
        tabIndex={-1}
        className="space-y-3 outline-none"
      >
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

      {recorded && (
        <RecordedNotice ref={recordedRef} id={recordedId} recorded={recorded} />
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        {onBack ? (
          <Button
            type="button"
            variant="outline"
            className="cursor-pointer"
            onClick={onBack}
            // Not gated on `recorded`: going back to a step that is already
            // answered is always allowed, and a dead Back button on a screen
            // that just refused something reads as "you are stuck".
            disabled={pending || busy}
          >
            Back
          </Button>
        ) : (
          <span aria-hidden="true" />
        )}

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          {/* Skipping is what "I do not want to answer this" means, and once
              the stage is on record there is nothing left to skip past — the
              forward control below is the honest one. */}
          {!recorded && (
            <Button
              type="button"
              variant="ghost"
              className="cursor-pointer"
              onClick={onSkip}
              disabled={disabled}
            >
              Skip for now
            </Button>
          )}
          <Button
            type="button"
            variant="ghost"
            className="cursor-pointer"
            onClick={onFinish}
            disabled={pending || busy}
          >
            Finish setup later
          </Button>
          {recorded ? (
            // The refusal's forward control. It carries the STORED phase, which
            // is what the finish screen's team offer is gated on — handing up
            // the submitted value would offer a planter the structure for a
            // stage their dashboard is not about to show them.
            <Button
              type="button"
              className="cursor-pointer"
              onClick={() => onDeclared(recorded.phase)}
              disabled={pending || busy}
            >
              Continue
            </Button>
          ) : (
            <Button
              type="submit"
              className="cursor-pointer"
              disabled={disabled}
              aria-busy={pending}
            >
              {pending ? "Saving…" : "Continue"}
            </Button>
          )}
        </div>
      </div>
    </form>
  );
}

/**
 * "Your starting stage is already recorded" — the refusal, said in full.
 *
 * THREE FACTS, AND ALL THREE ARE OWED (ruled 2026-08-09). A planter re-entering
 * this step and submitting a different stage has had that stage discarded, so
 * the panel must say: which stage is actually on record, where the plant's phase
 * can be changed, and — the one a shorter message would drop — that the launch
 * date on the SAME form did save. Without the third the honest reading of
 * "already recorded" is "none of that went through", and a planter re-enters
 * their date on a page that will refuse to move it.
 *
 * WHY IT IS NOT AN ERROR STYLE. Nothing went wrong: the plant has a starting
 * stage, which is what this step exists to establish. Destructive red on a
 * screen reporting a correct state teaches planters to fear the flow. It is a
 * status, styled as one, and it takes focus (see `recordedRef`) so it is read
 * rather than merely present.
 */
function RecordedNotice({
  ref,
  id,
  recorded,
}: {
  ref: React.Ref<HTMLDivElement>;
  id: string;
  recorded: JourneyRecorded;
}) {
  const option = journeyStageForPhase(recorded.phase);

  return (
    <div
      ref={ref}
      id={id}
      tabIndex={-1}
      role="status"
      // The ring token the rest of the app focuses with (`ui/button.tsx`),
      // rather than an ad-hoc ring — this panel takes focus programmatically,
      // so the indicator has to look like every other one on the screen.
      className="border-primary/40 bg-primary/5 focus-visible:ring-ring/50 space-y-2 rounded-md border p-4 text-sm outline-none focus-visible:ring-[3px]"
    >
      <p className="font-medium">
        {option
          ? `Your starting stage is already recorded: ${option.label} (${option.phaseName}).`
          : `Your starting stage is already recorded as phase ${recorded.phase}.`}
      </p>
      <p className="text-muted-foreground">
        Setup records where you started once, so this answer was kept. You can
        move the plant to a different phase any time from the phase page.
      </p>
      {recorded.targetDate && (
        <p className="text-muted-foreground">
          Your launch date was saved:{" "}
          <span className="text-foreground font-medium">
            {formatDate(parseTargetDate(recorded.targetDate))}
          </span>
          .
        </p>
      )}
    </div>
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
