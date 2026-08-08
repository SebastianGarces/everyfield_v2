"use client";

import { useId, useState, useTransition } from "react";

import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { AssociationOrgType } from "@/db/schema";

import { leaveOversightOrg } from "./actions";

// ============================================================================
// Leaving an oversight org — the type-to-confirm dialog (#304, OV-007a).
//
// WHY TYPING, AND WHAT IT IS NOT. OV-007 requires a type-to-confirm because the
// sever is not undoable from this side: re-joining needs a fresh invitation from
// the org, which the planter cannot issue. Typing the org's name is a
// deliberateness control — it makes the click impossible to make by reflex — and
// it is nothing at all like a permission. The authority rule (planter only), the
// tenancy assertion (the FK is nulled only if it still points at THIS org) and
// the audit row live in `leaveOversightOrgAs`, where a request that never opened
// this dialog meets them exactly the same.
//
// THE MATCH IS CASE-INSENSITIVE AND TRIMMED, on purpose. The point is
// deliberateness, not transcription accuracy; failing somebody who typed their
// own sending church's name with a stray trailing space teaches them to
// copy-paste, which defeats the control.
//
// The org is identified to the ACTION by its KIND — "sending_church" or
// "network" — never by the id rendered here. There is no id in this component
// at all, so there is nothing on this screen for a forged submit to re-aim.
// ============================================================================

const ORG_NOUN: Record<AssociationOrgType, string> = {
  sending_church: "sending church",
  network: "network",
};

export function LeaveOrgDialog({
  orgType,
  orgName,
}: {
  orgType: AssociationOrgType;
  orgName: string;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();

  const noun = ORG_NOUN[orgType];
  const confirmed =
    confirmation.trim().toLowerCase() === orgName.trim().toLowerCase();

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setConfirmation("");
      setError(null);
    }
  }

  function leave() {
    setError(null);
    startTransition(async () => {
      const result = await leaveOversightOrg(orgType);
      if (result.success) {
        reset(false);
        return;
      }
      setError(result.error);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={reset}>
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="text-destructive hover:text-destructive cursor-pointer"
        >
          Leave {noun}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave {orgName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Your plant stops appearing in their directory and they receive no
            further updates about you. They are told that you left. Only they
            can invite you back.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor={inputId}>
            Type <span className="font-semibold">{orgName}</span> to confirm
          </Label>
          <Input
            id={inputId}
            value={confirmation}
            autoComplete="off"
            onChange={(event) => setConfirmation(event.target.value)}
            aria-describedby={error ? `${inputId}-error` : undefined}
          />
          {error && (
            <p
              id={`${inputId}-error`}
              role="alert"
              className="text-destructive text-sm"
            >
              {error}
            </p>
          )}
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer">
            Keep the association
          </AlertDialogCancel>
          {/* Not `AlertDialogAction`: that closes the dialog on click, which
              would take a refused sever's message down with it. */}
          <Button
            type="button"
            variant="destructive"
            className="cursor-pointer"
            disabled={!confirmed || pending}
            onClick={leave}
          >
            Leave {noun}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
