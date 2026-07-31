"use client";

import { useState, useTransition, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { confirmLeadership } from "@/app/(dashboard)/dashboard/actions";
import {
  DEFAULT_LEADERSHIP_ANSWER,
  NO_PLANTER_LIMITS,
  isLeadershipAnswer,
  type LeadershipAnswer,
} from "@/lib/onboarding/leadership";

/**
 * F12 / OB-004 — step 2 of onboarding: the pastor confirmation.
 *
 * The question is asked rather than assumed (#157): the platform's default is
 * that the first account on a church leads it, and the radio group opens on
 * Yes, but a planter who is setting the plant up on someone else's behalf gets
 * a real way to say so instead of being silently recorded as the pastor.
 *
 * Answering No is not a dead end and not a scolding — it is a choice with
 * consequences, so the consequences appear next to the choice, at the moment it
 * is made, and the same list is echoed by the dashboard nudge afterwards.
 *
 * The selected answer is the planter's own input, not server data, so holding
 * it in `useState` is not the "server data in useState" anti-pattern; the
 * server's copy arrives once as `initialAnswer` and the action + `refresh` are
 * what reconcile it.
 */
export function LeadershipStep({
  initialAnswer = DEFAULT_LEADERSHIP_ANSWER,
  submitLabel = "Continue",
  pendingLabel = "Saving…",
  secondary = null,
  onSaved,
}: {
  initialAnswer?: LeadershipAnswer;
  /** "Continue" in the flow (PR #234's labels); "Save" on the re-entry card. */
  submitLabel?: string;
  pendingLabel?: string;
  /** The step's other control — "Finish setup later", or a way back. */
  secondary?: ReactNode;
  onSaved: (answer: LeadershipAnswer) => void;
}) {
  const [answer, setAnswer] = useState<LeadershipAnswer>(initialAnswer);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function handleSubmit(formData: FormData) {
    setError(null);
    const submitted = formData.get("leadership");

    if (!isLeadershipAnswer(submitted)) {
      setError("Please choose yes or no");
      return;
    }

    startTransition(async () => {
      const result = await confirmLeadership(submitted);

      if (result.status === "saved") {
        onSaved(submitted);
        return;
      }

      setError(result.error);
    });
  }

  return (
    <form action={handleSubmit} className="space-y-6">
      {error && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
        >
          {error}
        </p>
      )}

      <fieldset className="space-y-3">
        <legend className="text-sm font-medium">
          Will you be the lead planter/pastor of this church plant?
        </legend>
        <p className="text-muted-foreground text-sm">
          We assume the person setting things up is the one leading — but it is
          worth asking, because it decides who tasks and follow-ups land with.
        </p>

        <RadioGroup
          name="leadership"
          value={answer}
          onValueChange={(value) => {
            if (isLeadershipAnswer(value)) setAnswer(value);
          }}
          disabled={pending}
          className="gap-2"
        >
          <AnswerOption
            id="leadership-yes"
            value="yes"
            label="Yes — I'm the lead planter/pastor"
            hint="Follow-ups, evaluations and reminders come to you."
          />
          <AnswerOption
            id="leadership-no"
            value="no"
            label="No — someone else will lead this plant"
            hint="The plant is recorded as having no planter yet."
          />
        </RadioGroup>
      </fieldset>

      {/* Rendered only on No, and announced, so the consequence arrives with
          the answer rather than as a surprise on the dashboard later. */}
      {answer === "no" && (
        <div
          aria-live="polite"
          className="border-border bg-muted/50 space-y-2 rounded-md border p-4"
        >
          <p className="text-sm font-medium">
            What that means until a planter is assigned
          </p>
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
            {NO_PLANTER_LIMITS.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
          <p className="text-muted-foreground text-sm">
            Nothing else about your plant changes, and we&apos;ll keep a
            reminder on your dashboard until this is sorted.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
        {secondary}
        <Button type="submit" className="cursor-pointer" disabled={pending}>
          {pending ? pendingLabel : submitLabel}
        </Button>
      </div>
    </form>
  );
}

function AnswerOption({
  id,
  value,
  label,
  hint,
}: {
  id: string;
  value: LeadershipAnswer;
  label: string;
  hint: string;
}) {
  return (
    <div className="border-border has-[button[data-state=checked]]:border-primary has-[button[data-state=checked]]:bg-primary/5 flex items-start gap-3 rounded-md border p-3 transition-colors">
      <RadioGroupItem id={id} value={value} className="mt-0.5" />
      <div className="space-y-1">
        <Label htmlFor={id} className="cursor-pointer font-medium">
          {label}
        </Label>
        <p className="text-muted-foreground text-sm">{hint}</p>
      </div>
    </div>
  );
}
