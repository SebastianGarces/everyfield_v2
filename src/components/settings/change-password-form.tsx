"use client";

// ============================================================================
// Change this account's password — CS-003, the form half.
//
// THREE FIELDS, AND THE THIRD IS A CLIENT-SIDE COURTESY. "Current" and "new"
// are what the server takes; the confirmation field is compared HERE and never
// posted, because a mismatch is a typo the reader can see and fix without a
// round trip. Everything the server refuses — too short, wrong current
// password, the password you already use — comes back as `{ field, message }`
// and lands under the input it is about.
//
// EVERY FIELD IS CLEARED ON EVERY OUTCOME. Three password inputs left mounted
// with their values is three passwords in the next screenshot, and one of them
// still works.
//
// AUTOCOMPLETE IS LOAD-BEARING, not decoration: `current-password` and
// `new-password` are what tell a password manager which box is which, and a
// manager that guesses wrong overwrites the saved entry with the old value.
//
// NO `refresh()` BEHIND THIS ONE. Nothing on the screen renders a password, so
// there is nothing for a re-read to reconcile — the confirmation IS the whole
// feedback, and it says how many other sessions ended.
// ============================================================================

import { useActionState, useState } from "react";

import { changePasswordAction } from "@/app/(dashboard)/settings/account/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// The TYPE comes from the module that DECLARES it and the CONSTANT from the
// import-free leaf. Neither is a bundle edge: a type-only import is erased, and
// `password-policy.ts` exists precisely so a client module never has to reach
// `password-change.ts`, which imports `@/db`.
import type { PasswordChangeOutcome } from "@/lib/auth/password-change";
import { MIN_PASSWORD_LENGTH } from "@/lib/auth/password-policy";

type FormState =
  | PasswordChangeOutcome
  | { ok: false; field: "confirm"; message: string }
  | null;

const PASSWORDS_DIFFER_MESSAGE = "Both new password fields must match";

export function ChangePasswordForm() {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const [state, formAction, submitting] = useActionState<FormState, FormData>(
    async (_previous, formData) => {
      const next = String(formData.get("newPassword") ?? "");

      // Compared here and never sent — see the header.
      if (next !== String(formData.get("confirmPassword") ?? "")) {
        setConfirmPassword("");
        return {
          ok: false,
          field: "confirm",
          message: PASSWORDS_DIFFER_MESSAGE,
        };
      }

      const outcome = await changePasswordAction({
        currentPassword: String(formData.get("currentPassword") ?? ""),
        newPassword: next,
      });

      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");

      return outcome;
    },
    null
  );

  const failure = state && !state.ok ? state : null;
  const succeeded = state?.ok === true ? state : null;

  return (
    <form action={formAction} className="space-y-4">
      {succeeded && (
        <p
          role="status"
          className="bg-muted text-foreground rounded-md p-3 text-sm"
        >
          {succeeded.otherSessionsEnded > 0
            ? `Password changed. We signed you out everywhere else — ${succeeded.otherSessionsEnded} other ${succeeded.otherSessionsEnded === 1 ? "session" : "sessions"} ended.`
            : "Password changed. You are still signed in here."}
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

      <div className="space-y-2">
        <Label htmlFor="currentPassword">Current password</Label>
        <Input
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          className="max-w-md"
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          aria-invalid={failure?.field === "currentPassword"}
          aria-describedby={
            failure?.field === "currentPassword"
              ? "currentPassword-error"
              : undefined
          }
        />
        {failure?.field === "currentPassword" && (
          <p
            id="currentPassword-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {failure.message}
          </p>
        )}
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2">
          <Label htmlFor="newPassword">New password</Label>
          <Input
            id="newPassword"
            name="newPassword"
            type="password"
            autoComplete="new-password"
            minLength={MIN_PASSWORD_LENGTH}
            required
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            aria-invalid={failure?.field === "newPassword"}
            aria-describedby={
              failure?.field === "newPassword"
                ? "newPassword-error"
                : "newPassword-help"
            }
          />
          {failure?.field === "newPassword" ? (
            <p
              id="newPassword-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {failure.message}
            </p>
          ) : (
            <p id="newPassword-help" className="text-muted-foreground text-sm">
              At least {MIN_PASSWORD_LENGTH} characters.
            </p>
          )}
        </div>

        <div className="space-y-2">
          <Label htmlFor="confirmPassword">Repeat new password</Label>
          <Input
            id="confirmPassword"
            name="confirmPassword"
            type="password"
            autoComplete="new-password"
            required
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            aria-invalid={failure?.field === "confirm"}
            aria-describedby={
              failure?.field === "confirm" ? "confirmPassword-error" : undefined
            }
          />
          {failure?.field === "confirm" && (
            <p
              id="confirmPassword-error"
              role="alert"
              className="text-destructive text-sm"
            >
              {failure.message}
            </p>
          )}
        </div>
      </div>

      <Button type="submit" className="cursor-pointer" disabled={submitting}>
        {submitting ? "Changing password…" : "Change password"}
      </Button>
    </form>
  );
}
