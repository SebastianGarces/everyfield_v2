"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { ResponseStatus } from "@/db/schema/meetings";
import type { OwnRsvpResponse } from "@/lib/meetings/own-rsvp-input";

export function OwnRsvp({
  meetingId,
  response,
}: {
  meetingId: string;
  response: ResponseStatus | null;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState("");

  function answer(next: OwnRsvpResponse) {
    setError(null);
    setNotice("");
    startTransition(async () => {
      try {
        const result = await fetch(`/api/meetings/${meetingId}/rsvp`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ response: next }),
        });
        if (!result.ok) {
          setError(
            result.status === 401
              ? "Sign in again to save your RSVP."
              : "Unable to save your RSVP. Reload the meeting and try again."
          );
          return;
        }
        setNotice("Your RSVP has been saved.");
        router.refresh();
      } catch {
        setError(
          "Unable to save your RSVP. Check your connection and try again."
        );
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Your RSVP</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm">
          {response === "confirmed"
            ? "You're confirmed for this meeting."
            : response === "declined"
              ? "You've declined this meeting."
              : "You're invited. Can you make it?"}
        </p>
        <div className="flex flex-wrap gap-3" aria-busy={pending}>
          <Button
            type="button"
            className="min-h-11 cursor-pointer"
            disabled={pending}
            aria-pressed={response === "confirmed"}
            onClick={() => answer("confirmed")}
          >
            Confirm attendance
          </Button>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 cursor-pointer"
            disabled={pending}
            aria-pressed={response === "declined"}
            onClick={() => answer("declined")}
          >
            Decline invitation
          </Button>
        </div>
        <p role="status" className="text-muted-foreground text-sm">
          {pending ? "Saving your RSVP…" : notice}
        </p>
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        )}
      </CardContent>
    </Card>
  );
}
