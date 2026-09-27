"use client";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import type { DuplicateCheck, PersonWithTags } from "@/lib/people/types";
import { AlertTriangle, ExternalLink, Users } from "lucide-react";
import Link from "next/link";

interface DuplicateWarningProps {
  duplicates: DuplicateCheck;
  onCreateAnyway: () => void;
  isSubmitting?: boolean;
  onCreateForReview?: (personId: string) => void;
}

function PersonSummary({
  person,
  onReview,
  isSubmitting,
}: {
  person: PersonWithTags;
  onReview?: (personId: string) => void;
  isSubmitting?: boolean;
}) {
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 rounded-md border p-2 text-sm">
      <div className="min-w-0 basis-full">
        <p className="font-medium break-words">
          {person.firstName} {person.lastName}
        </p>
        <p className="text-muted-foreground truncate">
          {[person.email, person.phone].filter(Boolean).join(" • ") ||
            "No contact info"}
        </p>
      </div>
      {onReview && (
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-auto min-h-8 max-w-full py-2 whitespace-normal"
          disabled={isSubmitting}
          onClick={() => onReview(person.id)}
        >
          Create and review merge
        </Button>
      )}
      <Button variant="ghost" size="sm" asChild>
        <Link href={`/people/${person.id}`} target="_blank">
          <ExternalLink className="h-3.5 w-3.5" />
          <span className="sr-only">View</span>
        </Link>
      </Button>
    </div>
  );
}

export function DuplicateWarning({
  duplicates,
  onCreateAnyway,
  isSubmitting,
  onCreateForReview,
}: DuplicateWarningProps) {
  const { exactMatch, potentialMatches } = duplicates;
  const hasDuplicates = exactMatch || potentialMatches.length > 0;

  if (!hasDuplicates) return null;

  return (
    <div className="space-y-3">
      {/* Exact match warning */}
      {exactMatch && (
        <Alert variant="destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Exact match found</AlertTitle>
          <AlertDescription className="mt-2 min-w-0 space-y-2">
            <p>A person with the same email address already exists:</p>
            <PersonSummary
              person={exactMatch}
              onReview={onCreateForReview}
              isSubmitting={isSubmitting}
            />
          </AlertDescription>
        </Alert>
      )}

      {/* Potential matches */}
      {potentialMatches.length > 0 && (
        <Alert>
          <Users className="h-4 w-4" />
          <AlertTitle>Potential duplicates</AlertTitle>
          <AlertDescription className="mt-2 min-w-0 space-y-2">
            <p>
              {potentialMatches.length === 1
                ? "1 person with a similar name or phone was found:"
                : `${potentialMatches.length} people with similar names or phones were found:`}
            </p>
            <div className="w-full min-w-0 space-y-1">
              {potentialMatches.map((person) => (
                <PersonSummary
                  key={person.id}
                  person={person}
                  onReview={onCreateForReview}
                  isSubmitting={isSubmitting}
                />
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      {onCreateForReview && (
        <p className="text-muted-foreground text-xs">
          Create and review saves this new contact, then opens a side-by-side
          review. Nothing is merged until you confirm. Cancelling keeps both
          contacts.
        </p>
      )}
      <div className="flex flex-wrap justify-end gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link href="/people/duplicates">Review existing duplicates</Link>
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={onCreateAnyway}
          disabled={isSubmitting}
        >
          Create Anyway
        </Button>
      </div>
    </div>
  );
}
