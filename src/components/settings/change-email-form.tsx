"use client";

// ============================================================================
// Change the address this account signs in with — CS-002, the form half.
//
// TWO FIELDS, AND BOTH ARE CREDENTIALS' WORTH. The new address, and the current
// password: the login identifier is itself a credential, so a borrowed session
// must not be able to move it (see `@/lib/auth/email-change`). The password
// field is `autoComplete="current-password"` so a manager fills it, and it is
// cleared on every outcome — a password sitting in a mounted input is a
// password on the next screenshot.
//
// THE FAILURE NAMES THE FIELD. `field` comes back on the refusal and drives
// both `aria-invalid` and which input the sentence sits under, so a reader who
// mistyped their password is not left rereading the address they got right.
//
// THE LIVE REQUEST IS A PROP, not client state: the server section reads it and
// the action calls `refresh()`, so "check your inbox" reconciles with the same
// server state the write produced (memory/contracts/data-patterns.md). Asking
// again supersedes the last ask in the database, which is why there is no
// Cancel control here to build or to keep honest.
// ============================================================================

import { useActionState, useState } from "react";

import { requestEmailChangeAction } from "@/app/(dashboard)/settings/account/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// THE TYPE COMES FROM THE MODULE THAT DECLARES IT, never from the action module
// that returns it: a `"use server"` module may not re-export another's names —
// `next build` enumerates its exports into the action manifest BY NAME and the
// erased type is then not found (`memory/invariants.md` → Authentication). A
// type-only import is erased at compile time, so it is not a bundle edge and the
// client/`@/db` guard is untouched.
import type { EmailChangeRequestOutcome } from "@/lib/auth/email-change";

type FormState = EmailChangeRequestOutcome | null;

export interface ChangeEmailFormProps {
  /** The address the account signs in with today. */
  currentEmail: string;
  /** The outstanding request, if the account is holding one. */
  pending: { newEmail: string } | null;
}

export function ChangeEmailForm({
  currentEmail,
  pending,
}: ChangeEmailFormProps) {
  const [newEmail, setNewEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");

  const [state, formAction, submitting] = useActionState<FormState, FormData>(
    async (_previous, formData) => {
      const outcome = await requestEmailChangeAction({
        newEmail: String(formData.get("newEmail") ?? ""),
        currentPassword: String(formData.get("currentPassword") ?? ""),
      });

      // The password never survives a submit, whichever way it went.
      setCurrentPassword("");
      if (outcome.ok) setNewEmail("");

      return outcome;
    },
    null
  );

  const failure = state && !state.ok ? state : null;

  return (
    <form action={formAction} className="space-y-4">
      {state?.ok && (
        <p
          role="status"
          className="border-primary/30 bg-primary/5 rounded-md border p-3 text-sm"
        >
          {state.emailSent
            ? `Check ${state.newEmail} for a confirmation link. Until you open it, you keep signing in as ${currentEmail}.`
            : `Saved, but the confirmation link could not be sent to ${state.newEmail}. Check the address and send it again.`}
        </p>
      )}

      {failure && failure.field == null && (
        <p
          role="alert"
          className="bg-destructive/10 text-destructive rounded-md p-3 text-sm"
        >
          {failure.message}
        </p>
      )}

      {pending && !state?.ok && (
        <p className="text-muted-foreground text-sm text-pretty">
          Waiting on confirmation at <strong>{pending.newEmail}</strong>. Asking
          again replaces that link.
        </p>
      )}

      <div className="grid gap-4 @md:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="newEmail">New email address</Label>
          <Input
            id="newEmail"
            name="newEmail"
            type="email"
            inputMode="email"
            autoComplete="off"
            placeholder="you@example.com"
            required
            value={newEmail}
            onChange={(event) => setNewEmail(event.target.value)}
            aria-invalid={failure?.field === "email"}
            aria-describedby={
              failure?.field === "email" ? "newEmail-error" : undefined
            }
          />
          {failure?.field === "email" && (
            <p
              id="newEmail-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {failure.message}
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="emailChangePassword">Current password</Label>
          <Input
            id="emailChangePassword"
            name="currentPassword"
            type="password"
            autoComplete="current-password"
            required
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            aria-invalid={failure?.field === "currentPassword"}
            aria-describedby={
              failure?.field === "currentPassword"
                ? "emailChangePassword-error"
                : "emailChangePassword-help"
            }
          />
          {failure?.field === "currentPassword" ? (
            <p
              id="emailChangePassword-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {failure.message}
            </p>
          ) : (
            <p
              id="emailChangePassword-help"
              className="text-muted-foreground text-sm"
            >
              Confirms it is you making the change.
            </p>
          )}
        </div>
      </div>

      <Button type="submit" className="cursor-pointer" disabled={submitting}>
        {submitting ? "Sending link…" : "Send confirmation link"}
      </Button>
    </form>
  );
}
