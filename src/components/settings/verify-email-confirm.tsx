"use client";

// ============================================================================
// The press that completes an address change — CS-002 (#616).
//
// A BUTTON AND NOTHING ELSE. Everything that decides the outcome — whether the
// token is live, unexpired and this account's — is the action's, and this
// component renders whichever sentence comes back. It deliberately diagnoses
// nothing itself: a client that reasoned about the token would be a second
// reading of a rule the server already owns, and it holds no token state to get
// out of step with the URL that carried one.
//
// SUCCESS IS TERMINAL HERE. The address has moved, so the page it came from is
// about an account identity that no longer holds — `refresh()` in the action
// re-reads the chrome, and this pane then says what happened and points at
// Settings rather than leaving a spent button on screen.
// ============================================================================

import Link from "next/link";
import { useActionState } from "react";

import { confirmEmailChangeAction } from "@/app/(dashboard)/settings/account/actions";
import { Button } from "@/components/ui/button";
// Declared in the logic module, not re-exported by the action module — see the
// header of `@/components/settings/change-email-form`.
import type { EmailChangeConfirmOutcome } from "@/lib/auth/email-change";

export function VerifyEmailConfirm({
  token,
  currentEmail,
}: {
  token: string;
  /** What the account signs in with right now, so the copy can name the swap. */
  currentEmail: string;
}) {
  const [state, formAction, submitting] = useActionState<
    EmailChangeConfirmOutcome | null,
    FormData
  >(async () => confirmEmailChangeAction(token), null);

  if (state?.ok) {
    return (
      <div className="space-y-4">
        <h1 className="text-xl font-semibold tracking-tight">
          Your address is confirmed
        </h1>
        <p className="text-muted-foreground text-pretty">
          You now sign in as <strong>{state.newEmail}</strong>.{" "}
          <strong>{state.previousEmail}</strong> no longer works, and we have
          told it about the change.
        </p>
        <Button asChild className="cursor-pointer">
          <Link href="/settings/account">Back to settings</Link>
        </Button>
      </div>
    );
  }

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">
        Confirm your new address
      </h1>

      <p className="text-muted-foreground text-pretty">
        Confirming makes the address this link was sent to the one you sign in
        with. You currently sign in as <strong>{currentEmail}</strong>.
      </p>

      {state && !state.ok && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
        >
          {state.message}
        </p>
      )}

      <Button type="submit" className="cursor-pointer" disabled={submitting}>
        {submitting ? "Confirming…" : "Confirm this address"}
      </Button>
    </form>
  );
}
