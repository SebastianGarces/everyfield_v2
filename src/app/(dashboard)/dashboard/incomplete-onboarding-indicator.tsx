"use client";

import Link from "next/link";
import { ArrowRight, ListChecks, X } from "lucide-react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { IncompleteOnboardingItem } from "./incomplete-onboarding";
import { dismissalKey, useDismissed } from "./use-dismissed";

/**
 * F12 / OB-011 — the incomplete-onboarding indicator.
 *
 * One banner listing every fact onboarding did not get, each with the link that
 * captures it. Not a progress bar and not a checklist to complete: skipping is a
 * legitimate way through the flow (OB-007), so this states what each gap costs
 * and leaves the choice alone.
 *
 * Dismissal is FOREVER, unlike the no-planter nudge's per-session one, and the
 * asymmetry is deliberate: a plant with no planter silently loses follow-up
 * tasks for as long as that is true, whereas skipping the people import costs
 * only what the planter already decided to skip. Answering the questions clears
 * the banner without any of this — the rows are derived from the church row, so
 * the last one dropping off is what makes it disappear for everyone, dismissed
 * or not.
 */
export function IncompleteOnboardingIndicator({
  items,
  churchId,
}: {
  items: IncompleteOnboardingItem[];
  /**
   * `null` for a viewer with no church (a coach on the empty dashboard shell)
   * — their dismissal lands in the shared no-church bucket, which is the key
   * this component has always produced for them.
   */
  churchId: string | null;
}) {
  const { dismissed, dismiss } = useDismissed(
    dismissalKey("incomplete-onboarding", churchId),
    "forever"
  );

  if (dismissed || items.length === 0) return null;

  return (
    // `role="status"`: a standing condition, not an interruption. Assertive
    // would talk over the dashboard on every load.
    <Alert
      role="status"
      data-testid="incomplete-onboarding-indicator"
      className="pr-12"
    >
      <ListChecks />
      <AlertTitle>
        {items.length === 1
          ? "One thing setup never got to"
          : `${items.length} things setup never got to`}
      </AlertTitle>
      <AlertDescription>
        <p>
          You can pick these up whenever you like — each one changes how much
          the rest of EveryField can do for your plant.
        </p>
        <ul className="w-full space-y-3">
          {items.map((item) => (
            <li key={item.id} className="space-y-1">
              <p className="text-foreground text-sm font-medium">
                {item.title}
              </p>
              <p className="text-sm">{item.detail}</p>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="cursor-pointer"
              >
                <Link href={item.href}>
                  {item.cta}
                  <ArrowRight aria-hidden="true" />
                </Link>
              </Button>
            </li>
          ))}
        </ul>
      </AlertDescription>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        onClick={dismiss}
        className="absolute top-2 right-2 cursor-pointer"
      >
        <X aria-hidden="true" />
        <span className="sr-only">Dismiss setup reminders</span>
      </Button>
    </Alert>
  );
}
