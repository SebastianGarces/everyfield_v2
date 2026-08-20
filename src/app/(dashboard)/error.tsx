"use client";

import Link from "next/link";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";

/**
 * Error boundary for all dashboard routes.
 *
 * WHY IT EXISTS (#498). The seat guard made two refusals into THROWS: a
 * sessionless call to any action leaves `withChurchSession` / `withChurch` as
 * `Unauthorized` rather than as a handled `{ success: false }`, which is the
 * property the auth invariant wants — an anonymous POST gets no well-formed
 * answer. But a throw from a server action inside a `useActionState` transition
 * lands on the nearest error boundary, and the only boundary in the tree was
 * `src/app/global-error.tsx`: it replaces the whole DOCUMENT with Next's bare
 * `statusCode 0` page — no sentence, no way back, and the session-expiry case
 * that produces it is one a real planter hits by leaving a form open.
 *
 * Fifteen client components call a people action alone, so a `catch` per caller
 * would be the same sentence written fifteen times and missing from the
 * sixteenth. One boundary covers every dashboard action instead.
 *
 * WHAT IT CANNOT DO is keep what the planter typed: `reset()` re-renders the
 * segment. So the copy does not promise otherwise — it offers the two moves
 * that do work, retrying and signing in again, and says the likely cause rather
 * than "something went wrong".
 *
 * It is NOT an authorization surface. A seat refusal never reaches here: the
 * envelopes catch `SeatRefusalError` and return a sentence inline, because a
 * signed-in caller who may not do a thing is a normal answer, not a fault.
 */
export default function DashboardError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex h-full flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-2xl font-bold">That didn&apos;t go through</h2>
      <p className="text-muted-foreground max-w-sm">
        Your sign-in may have expired while this page was open. Try again, or
        sign in and come back — anything already saved is safe.
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset} className="cursor-pointer">
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/login">Sign in</Link>
        </Button>
      </div>
    </div>
  );
}
