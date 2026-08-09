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

import { leaveNetwork } from "./actions";

// ============================================================================
// A sending church leaving its network — the type-to-confirm dialog (#304 WS3,
// OV-013).
//
// The sibling of `LeaveOrgDialog` (the planter's), and deliberately a separate
// component rather than a prop on that one: the two call DIFFERENT server
// actions, because the two authority rules are different and each endpoint
// derives its own entity from the session. A shared component with an
// `action` prop would put the choice of endpoint in the client's hands, which
// is the one thing neither rule permits.
//
// WHY TYPING. Same reason as the planter's: OV-007 requires it because the
// sever is not undoable from this side — re-joining needs a fresh invitation
// from the network, which the sending church cannot issue. Typing the network's
// name makes the click impossible to make by reflex. It is not a permission:
// the admin-only rule, the tenancy assertion and the audit row live in
// `leaveNetworkAsSendingChurchAdmin`, where a request that never opened this
// dialog meets them the same.
//
// THE MATCH IS CASE-INSENSITIVE AND TRIMMED, on purpose — deliberateness, not
// transcription accuracy.
//
// THERE IS NOTHING TO AIM. The action takes no argument at all: no id, no kind,
// nothing. So this component renders the network's name and sends nothing back.
// ============================================================================

export function LeaveNetworkDialog({ networkName }: { networkName: string }) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();

  const confirmed =
    confirmation.trim().toLowerCase() === networkName.trim().toLowerCase();

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
      const result = await leaveNetwork();
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
          Leave network
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave {networkName}?</AlertDialogTitle>
          <AlertDialogDescription>
            Your sending church stops appearing in their roster and they receive
            no further updates about you. They are told that you left. Only they
            can invite you back.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor={inputId}>
            Type <span className="font-semibold">{networkName}</span> to confirm
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
            Leave network
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
