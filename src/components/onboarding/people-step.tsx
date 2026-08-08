"use client";

import { ImportWizard } from "@/components/people/import-wizard";
import { QuickAddForm } from "@/components/people/quick-add-form";
import { Button } from "@/components/ui/button";
import { isLastOnboardingStep } from "@/lib/onboarding/steps";
import { FileUp, UserPlus } from "lucide-react";
import type { ReactNode } from "react";

/**
 * F12 / OB-006 — step 4 of onboarding: bring your people.
 *
 * THIS STEP OWNS NO IMPORT CODE. It is a caller, and deliberately nothing else:
 * the CSV wizard (`ImportWizard`) and the quick-add dialog (`QuickAddForm`) are
 * the same two components `/people` renders in its header, imported here rather
 * than re-implemented. That is what makes the FRD's third acceptance criterion
 * — "import from onboarding behaves identically to import from /people" — a
 * structural fact instead of a promise: the template, the row-by-row preview,
 * the duplicate detection, the `person_created` activity and the
 * `emitPersonCreated` event all come from one code path, so they cannot drift
 * between the two entry points. `people-step.test.ts` pins that shape.
 *
 * The corollary is that this file must NOT reach into `@/lib/people/import` or
 * the people server actions itself. Beyond the duplication argument that would
 * be a build hazard: this is a client component and `@/lib/people/import` pulls
 * in the database client.
 *
 * The step writes nothing of its own, so skipping it is just leaving — which is
 * why the controls below are the flow's controls, not a form's.
 */

/**
 * What having people in the system turns on. Framed as consequences rather than
 * features because the question a planter is actually asking here is "why am I
 * being asked to do work before I have even seen the app?".
 */
const IMPORT_UNLOCKS = [
  "The pipeline shows where every person stands, from first conversation to launch team.",
  "Vision meetings, follow-ups and tasks have someone to be about.",
  "Your core group and ministry teams get built from this list instead of from memory.",
];

export function PeopleStep({
  onBack,
  onSkip,
  onFinish,
  busy,
}: {
  /** `null` when the previous step cannot be re-entered. See `JourneyStep`. */
  onBack: (() => void) | null;
  onSkip: () => void;
  onFinish: () => void;
  busy: boolean;
}) {
  // Step 4 is the last step today, so "forward" from here is finishing. Derived
  // rather than assumed so appending a step later changes the control set here
  // without changing this file.
  const isLast = isLastOnboardingStep("people");

  return (
    <div className="space-y-6">
      <div className="space-y-3">
        <p className="text-sm">
          Add the people already walking with you — the ones who have said yes,
          the ones you are still praying about, and everyone in between. This
          list is what the rest of EveryField runs on:
        </p>
        <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-sm">
          {IMPORT_UNLOCKS.map((unlocked) => (
            <li key={unlocked}>{unlocked}</li>
          ))}
        </ul>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <PeopleOption
          icon={<FileUp className="text-primary size-5" aria-hidden="true" />}
          title="Import a list you already keep"
          body="Download the template, upload your CSV, and review every row before anything is created. Likely duplicates are flagged so nobody lands twice."
          action={
            <ImportWizard>
              <Button
                type="button"
                variant="outline"
                className="w-full cursor-pointer"
                disabled={busy}
              >
                Import from CSV
              </Button>
            </ImportWizard>
          }
        />

        <PeopleOption
          icon={<UserPlus className="text-primary size-5" aria-hidden="true" />}
          title="Add someone now"
          body="A name and, if you have it, a way to reach them. Best for the handful of people you already know by heart."
          action={
            <QuickAddForm>
              <Button
                type="button"
                variant="outline"
                className="w-full cursor-pointer"
                disabled={busy}
              >
                Add a person
              </Button>
            </QuickAddForm>
          }
        />
      </div>

      {/* OB-007: this step is skippable, and on the last step skipping and
          finishing are the same move — so the way out is said in words rather
          than duplicated as a second button that does what the primary already
          does. */}
      <p className="text-muted-foreground bg-muted/50 rounded-md p-3 text-sm">
        Nothing here is required. Your church plant is already saved, and the
        same import and quick-add live on the People page whenever you are
        ready.
      </p>

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

function PeopleOption({
  icon,
  title,
  body,
  action,
}: {
  icon: ReactNode;
  title: string;
  body: string;
  /** The dialog trigger. The card itself is not clickable — one target only. */
  action: ReactNode;
}) {
  return (
    <div className="border-border flex flex-col gap-3 rounded-md border p-4">
      <div className="space-y-2">
        {icon}
        <h3 className="text-sm font-medium">{title}</h3>
        <p className="text-muted-foreground text-sm">{body}</p>
      </div>
      <div className="mt-auto">{action}</div>
    </div>
  );
}
