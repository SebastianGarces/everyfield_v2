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
// SUCCESS IS NOT RENDERED HERE AT ALL, and the TYPE is what says so: the action
// returns `EmailChangeConfirmRefusal`, because its success redirects to
// `/verify-email/confirmed` instead of returning. So a success pane added back
// here does not compile. It was here, and it never appeared — see
// `confirmEmailChangeAction` for what it waited on (#658).
// ============================================================================

import { useActionState } from "react";

import { confirmEmailChangeAction } from "@/app/(dashboard)/settings/account/actions";
import { Button } from "@/components/ui/button";
// Declared in the logic module, not re-exported by the action module — see the
// header of `@/components/settings/change-email-form`.
import type { EmailChangeConfirmRefusal } from "@/lib/auth/email-change";

export function VerifyEmailConfirm({
  token,
  currentEmail,
}: {
  token: string;
  /** What the account signs in with right now, so the copy can name the swap. */
  currentEmail: string;
}) {
  const [state, formAction, submitting] = useActionState<
    EmailChangeConfirmRefusal | null,
    FormData
  >(async () => confirmEmailChangeAction(token), null);

  return (
    <form action={formAction} className="space-y-4">
      <h1 className="text-xl font-semibold tracking-tight">
        Confirm your new address
      </h1>

      <p className="text-muted-foreground text-pretty">
        Confirming makes the address this link was sent to the one you sign in
        with. You currently sign in as <strong>{currentEmail}</strong>.
      </p>

      {state && (
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
