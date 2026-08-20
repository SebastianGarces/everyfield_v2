"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import * as Sentry from "@sentry/nextjs";

import { Button } from "@/components/ui/button";
import { loginPathFor } from "@/lib/auth/safe-redirect";
import { isSessionExpiry } from "@/lib/auth/unauthorized";

/**
 * What every recoverable error boundary in the app renders.
 *
 * WHY IT EXISTS (#498). The seat guard made two refusals into THROWS: a
 * sessionless call to any action leaves `withChurchSession` / `withChurch` as
 * `Unauthorized` rather than as a handled `{ success: false }`, which is the
 * property the auth invariant wants — an anonymous POST gets no well-formed
 * answer. But a throw from a server action inside a transition lands on the
 * nearest error boundary, and the only boundary in the tree was
 * `src/app/global-error.tsx`: it replaces the whole DOCUMENT with Next's bare
 * `statusCode 0` page — no sentence, no way back, and the session-expiry case
 * that produces it is one a real planter hits by leaving a form open.
 *
 * Fifteen client components call a people action alone, so a `catch` per caller
 * would be the same sentence written fifteen times and missing from the
 * sixteenth. Boundaries cover every one of them instead.
 *
 * IT IS MOUNTED TWICE, and #508 is why. `error.tsx` catches its segment's
 * CHILDREN, never the layout that renders it — so `(dashboard)/error.tsx` does
 * not cover the sidebar, and the Send Feedback button lives there. Once
 * `submitFeedbackAction` started rethrowing, that press fell past the dashboard
 * boundary to `global-error.tsx` and produced Next's bare "Application error".
 * `src/app/error.tsx` is the parent segment's boundary and does cover the
 * dashboard layout; the nested one stays because it catches CLOSER, keeping the
 * sidebar and the chrome around the message.
 *
 * WHAT IT CANNOT DO is keep what the planter typed: `reset()` re-renders the
 * segment. So the copy does not promise otherwise — it offers the moves that do
 * work.
 *
 * It is NOT an authorization surface. A seat refusal never reaches here: the
 * action envelopes catch `SeatRefusalError` and return a sentence inline,
 * because a signed-in caller who may not do a thing is a normal answer, not a
 * fault.
 *
 * WHAT IT SAYS DEPENDS ON WHAT IT CAUGHT (#508). It used to tell every reader
 * their sign-in had probably expired, and during #498's own validation it said
 * that about a schema drift — a diagnosis it had no evidence for, offering a
 * Sign in button that could not have helped.
 */
export function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  // "Sign in and come back" is a promise, so the link keeps it (#503). The
  // reader is standing on the page they wanted — sending them to a bare /login
  // spent that fact and dropped them on the dashboard afterwards. `usePathname`
  // is the client-side spelling of what the proxy stamps for the server side;
  // `loginPathFor` is the same builder both of those use, and `safe-redirect`
  // is an import-free leaf, so pulling it into this client bundle costs nothing.
  const signInHref = loginPathFor(usePathname());

  // THE ONE DISCRIMINATOR, and it has to be the digest: in production Next.js
  // replaces the message of a server error before the client ever sees it, so
  // `error.message` here is a generic sentence and `error.digest` is the whole
  // channel. `UnauthorizedError` sets its own, and Next.js keeps a digest an
  // error already carries (`@/lib/auth/unauthorized`).
  const sessionExpired = isSessionExpiry(error);

  return (
    <div className="flex h-full min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <h2 className="text-2xl font-bold">That didn&apos;t go through</h2>
      <p className="text-muted-foreground max-w-sm">
        {sessionExpired
          ? "Your sign-in expired while this page was open. Sign in and come back, or try again — anything already saved is safe."
          : "Something went wrong on our end, and we have been told about it. Try again — anything already saved is safe."}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button onClick={reset} className="cursor-pointer">
          Try again
        </Button>
        {sessionExpired && (
          <Button asChild variant="outline">
            <Link href={signInHref}>Sign in</Link>
          </Button>
        )}
      </div>
    </div>
  );
}
