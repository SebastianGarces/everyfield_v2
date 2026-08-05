"use client";

import { useState, useTransition } from "react";
import { UserRoundCheck, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { LeadershipAnswer } from "@/lib/onboarding/leadership";
import { confirmLeadership } from "./actions";
import { dismissalKey, useDismissed } from "./use-dismissed";

/**
 * F12 / OB-010 — the one-time pastor confirmation for plants that predate the
 * question.
 *
 * WHO SEES THIS. Only a plant with no planter at all and no recorded answer —
 * `shouldPromptPastorConfirmation` is the whole rule and it lives in
 * `src/lib/onboarding/leadership.ts`. A plant whose `users.church_id` + role
 * already names a planter is treated as confirmed (FRD open question 3) and
 * never sees it, which is what keeps this from re-asking every church that
 * existed before OB-004 shipped.
 *
 * WHY IT IS TWO BUTTONS AND NOT THE STEP'S RADIO GROUP. The flow's
 * `LeadershipStep` commits on selection and then advances; here there is no flow
 * to advance and no default to open on — this is an unanswered question on a
 * dashboard, and a pre-selected Yes on a banner somebody might click past is
 * exactly the silent assumption #157 asked us to stop making. So both answers
 * are explicit, and "not now" is a third, separate control.
 *
 * ANSWERING YES ASSIGNS. For these plants the seat is genuinely empty, so Yes is
 * not a confirmation of an existing link — it writes one (`./confirm-leadership`
 * owns that, including the race two team members answering at once would
 * otherwise win together). No records the explicit no-planter state and leaves
 * the standing nudge, which is OB-004's No path unchanged.
 */
export function PastorConfirmationPrompt({ churchId }: { churchId: string }) {
  const { dismissed, dismiss } = useDismissed(
    dismissalKey("pastor-confirmation", churchId),
    "forever"
  );
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function answer(value: LeadershipAnswer) {
    setError(null);
    startTransition(async () => {
      const result = await confirmLeadership(value);
      if (result.status === "error") {
        setError(result.error);
        return;
      }
      // Nothing to do on success: the action revalidates, the answer is now
      // recorded, and this prompt stops rendering because its rule stops being
      // true. Dismissal is stored too, so a browser that never re-renders (an
      // old tab) does not resurrect an answered question.
      dismiss();
    });
  }

  if (dismissed) return null;

  return (
    <Alert role="status" data-testid="pastor-confirmation-prompt">
      <UserRoundCheck />
      <AlertTitle>Who leads this plant?</AlertTitle>
      <AlertDescription>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
        <p>
          This plant has no lead planter or pastor on record. It decides who
          follow-ups, evaluations and reminders go to, so we would rather ask
          once than guess.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Button
            type="button"
            size="sm"
            className="cursor-pointer"
            disabled={pending}
            onClick={() => answer("yes")}
          >
            Yes, I lead this plant
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            disabled={pending}
            onClick={() => answer("no")}
          >
            No, someone else does
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="cursor-pointer"
            disabled={pending}
            onClick={dismiss}
          >
            <X aria-hidden="true" />
            Not now
          </Button>
        </div>
        <p className="text-muted-foreground text-sm">
          Answering no records the plant as having no planter yet and keeps a
          reminder on your dashboard until that changes.
        </p>
      </AlertDescription>
    </Alert>
  );
}
