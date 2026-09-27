"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Alert, AlertTitle, AlertDescription } from "@/components/ui/alert";
import { mergePeopleAction } from "@/app/(dashboard)/people/duplicates/actions";
import {
  mergeFields,
  mergeFieldText,
  type MergeChoices,
  type MergeReview,
  type MergeSide,
} from "@/lib/people/merge-model";

export function MergeReviewForm({
  review,
  canWrite,
}: {
  review: MergeReview;
  canWrite: boolean;
}) {
  const [survivor, setSurvivor] = useState<MergeSide>();
  const [choices, setChoices] = useState<MergeChoices>({});
  const [error, setError] = useState<string>();
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const blockers = survivor
    ? review.survivorBlockers[survivor]
    : review.blockers;
  const complete = survivor && review.conflicts.every((key) => choices[key]);
  const wrongSurvivor =
    survivor && review[survivor === "left" ? "right" : "left"].linkedAccount;
  const name = (side: MergeSide) =>
    `${review[side].person.firstName} ${review[side].person.lastName}`;
  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!survivor) return;
    setError(undefined);
    startTransition(async () => {
      try {
        const result = await mergePeopleAction({
          leftId: review.left.person.id,
          rightId: review.right.person.id,
          leftVersion: review.left.version,
          rightVersion: review.right.version,
          survivor,
          choices,
        });
        if (!result.success) {
          setError(result.error);
          return;
        }
        router.push(`/people/${result.data.survivorId}`);
        router.refresh();
      } catch {
        setError(
          "The merge could not be confirmed. Your choices are saved here. Try again."
        );
      }
    });
  }
  if (!canWrite)
    return (
      <section className="space-y-5">
        <p className="rounded-lg border p-4">
          You can review these profiles. An owner or admin can merge them.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {(["left", "right"] as const).map((side) => (
            <Link
              key={side}
              className="font-medium underline underline-offset-4"
              href={`/people/${review[side].person.id}`}
            >
              {name(side)}
            </Link>
          ))}
        </div>
        <dl className="space-y-4">
          {mergeFields.map((field) => (
            <div key={field.key} className="rounded-lg border p-4">
              <dt className="font-medium">{field.label}</dt>
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {(["left", "right"] as const).map((side) => (
                  <dd
                    key={side}
                    className="min-w-0 text-sm break-words whitespace-pre-wrap"
                  >
                    <span className="text-muted-foreground mb-1 block text-xs">
                      {name(side)}
                    </span>
                    {field.key === "photo" && review[side].person.photoSrc && (
                      <Avatar className="mb-2 size-16">
                        <AvatarImage
                          src={review[side].person.photoSrc}
                          alt={`Photo for ${name(side)}`}
                        />
                        <AvatarFallback>Photo</AvatarFallback>
                      </Avatar>
                    )}
                    {mergeFieldText(review[side], field.key)}
                  </dd>
                ))}
              </div>
            </div>
          ))}
        </dl>
        <Button variant="outline" asChild>
          <Link href="/people/duplicates">Back to potential duplicates</Link>
        </Button>
      </section>
    );

  return (
    <form onSubmit={submit} className="space-y-6">
      {blockers.length > 0 && (
        <Alert variant="destructive">
          <AlertTitle>These profiles cannot be merged yet</AlertTitle>
          <AlertDescription>
            <ul className="list-disc space-y-1 pl-4">
              {blockers.map((blocker) => (
                <li key={blocker}>{blocker}</li>
              ))}
            </ul>
            <p className="mt-2">
              Both profiles and their history will stay unchanged.
            </p>
          </AlertDescription>
        </Alert>
      )}
      <fieldset disabled={pending} className="space-y-4">
        <legend className="text-lg font-semibold">
          1. Choose the profile to keep
        </legend>
        <p className="text-muted-foreground text-sm">
          The other profile will leave the directory. Its original details and a
          merge record are retained. Account access and message preferences
          never transfer.
        </p>
        <RadioGroup
          value={survivor ?? ""}
          onValueChange={(value) =>
            setSurvivor(value === "left" ? "left" : "right")
          }
          className="grid gap-3 sm:grid-cols-2"
        >
          {(["left", "right"] as const).map((side) => (
            <div
              key={side}
              className="flex items-start gap-3 rounded-lg border p-4"
            >
              <RadioGroupItem
                id={`keep-${side}`}
                value={side}
                className="mt-1 cursor-pointer"
              />
              <Label
                htmlFor={`keep-${side}`}
                className="block cursor-pointer space-y-1"
              >
                <span className="block font-semibold">{name(side)}</span>
                <span className="text-muted-foreground block font-normal">
                  {review[side].person.email ||
                    review[side].person.phone ||
                    "No contact details"}
                </span>
                {review[side].linkedAccount && (
                  <span className="block text-sm">
                    Account-linked profile. Keep this profile.
                  </span>
                )}
                <Link
                  href={`/people/${review[side].person.id}`}
                  target="_blank"
                  className="block text-sm font-normal underline underline-offset-4"
                >
                  Open profile in new tab
                </Link>
              </Label>
            </div>
          ))}
        </RadioGroup>
        {wrongSurvivor && (
          <p role="alert" className="text-destructive text-sm">
            Keep the account-linked profile. Account identity cannot move to
            another profile.
          </p>
        )}
      </fieldset>
      <section className="space-y-4">
        <h2 className="text-lg font-semibold">2. Choose the details to keep</h2>
        <p className="text-muted-foreground text-sm">
          Choose a side for every difference. Shared details stay the same. The
          original values remain in the merge history.
        </p>
        {mergeFields.map((field) => {
          const differs = review.conflicts.includes(field.key);
          return (
            <fieldset
              key={field.key}
              disabled={pending}
              className="space-y-2 rounded-lg border p-4"
            >
              <legend className="px-1 font-medium">
                {field.label}
                {differs ? " · choice required" : " · same on both"}
              </legend>
              {differs ? (
                <RadioGroup
                  aria-label={`${field.label} to keep`}
                  value={choices[field.key] ?? ""}
                  onValueChange={(value) =>
                    setChoices((previous) => ({
                      ...previous,
                      [field.key]: value === "left" ? "left" : "right",
                    }))
                  }
                  className="grid gap-3 sm:grid-cols-2"
                >
                  {(["left", "right"] as const).map((side) => (
                    <div className="flex items-start gap-2" key={side}>
                      <RadioGroupItem
                        className="mt-1 cursor-pointer"
                        id={`${field.key}-${side}`}
                        value={side}
                      />
                      <Label
                        className="block min-w-0 cursor-pointer font-normal break-words whitespace-pre-wrap"
                        htmlFor={`${field.key}-${side}`}
                      >
                        <span className="text-muted-foreground mb-1 block text-xs">
                          {name(side)}
                        </span>
                        {field.key === "photo" &&
                          review[side].person.photoSrc && (
                            <Avatar className="mb-2 size-16">
                              <AvatarImage
                                src={review[side].person.photoSrc}
                                alt={`Photo for ${name(side)}`}
                              />
                              <AvatarFallback>Photo</AvatarFallback>
                            </Avatar>
                          )}
                        {mergeFieldText(review[side], field.key)}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>
              ) : (
                <p className="text-sm break-words whitespace-pre-wrap">
                  {mergeFieldText(review.left, field.key)}
                </p>
              )}
            </fieldset>
          );
        })}
      </section>
      <div className="rounded-lg border p-4 text-sm">
        <p>
          All assessments, interviews, commitments, skills, activities and
          compatible related records move to the kept profile. Conflicting
          meeting, training or follow-up records must be resolved separately.
        </p>
        {review.sharedTags > 0 && (
          <p className="mt-2">
            {review.sharedTags} shared tag assignments already exist on the kept
            profile. Both original assignments are retained; each tag appears
            once.
          </p>
        )}
        <p className="mt-2">
          Merging sends no messages and cannot be undone from this screen.
        </p>
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Merge not completed</AlertTitle>
          <AlertDescription>
            <p role="alert">{error}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-2"
              onClick={() => router.refresh()}
            >
              Refresh review
            </Button>
          </AlertDescription>
        </Alert>
      )}
      <div className="flex flex-wrap gap-3">
        <Button
          type="submit"
          disabled={
            pending || !complete || !!wrongSurvivor || blockers.length > 0
          }
        >
          {pending ? "Merging…" : "Confirm merge"}
        </Button>
        <Button variant="outline" asChild>
          <Link href="/people/duplicates">Cancel</Link>
        </Button>
      </div>
    </form>
  );
}
