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
}

function PersonSummary({ person }: { person: PersonWithTags }) {
  return (
    <div className="flex items-center justify-between gap-2 rounded-md border p-2 text-sm">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {person.firstName} {person.lastName}
        </p>
        <p className="text-muted-foreground truncate">
          {[person.email, person.phone].filter(Boolean).join(" • ") ||
            "No contact info"}
        </p>
      </div>
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
          <AlertDescription className="mt-2 space-y-2">
            <p>A person with the same email address already exists:</p>
            <PersonSummary person={exactMatch} />
          </AlertDescription>
        </Alert>
      )}

      {/* Potential matches */}
      {potentialMatches.length > 0 && (
        <Alert>
          <Users className="h-4 w-4" />
          <AlertTitle>Potential duplicates</AlertTitle>
          <AlertDescription className="mt-2 space-y-2">
            <p>
              {potentialMatches.length === 1
                ? "1 person with a similar name or phone was found:"
                : `${potentialMatches.length} people with similar names or phones were found:`}
            </p>
            <div className="space-y-1">
              {potentialMatches.map((person) => (
                <PersonSummary key={person.id} person={person} />
              ))}
            </div>
          </AlertDescription>
        </Alert>
      )}

      <div className="flex justify-end">
        <Button
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
