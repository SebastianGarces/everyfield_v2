"use client";

import { useRouter } from "next/navigation";
import { useId, useState, useTransition } from "react";

import { removePlantFromOrg } from "@/app/(dashboard)/oversight/plants/[id]/actions";
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
// An import-free leaf, and imported for that reason: this dialog is a
// `"use client"` component, and `@/lib/oversight/presentation` reaches
// `@/db/schema` through `STATUS_LABELS`. The leaf carries only the two words,
// so the browser gets them and no schema barrel.
import { scopeLabelForOrgType } from "@/lib/oversight/org-label";
import type { AssociationOrgType } from "@/db/schema";

// ============================================================================
// Removing a plant from your organization — the type-to-confirm dialog (#304,
// OV-007b). The org's mirror of `settings/association/leave-org-dialog.tsx`.
//
// WHAT IS TYPED IS THE PLANT'S NAME, not the org's. The planter's dialog asks for
// the ORG's name because that is the counterparty they are about to lose; here
// the admin has many plants and exactly one org, so the org's name is the
// constant on the screen and typing it would confirm nothing. Naming the plant is
// what makes "I clicked the wrong row" impossible — which is the failure this
// control exists for, and the only one it can prevent.
//
// WHY TYPING AT ALL. OV-007 requires it because the sever is not undoable from
// this side either: the plant would have to accept a fresh invitation, and the
// association history is all that survives. Typing is a deliberateness control
// and nothing like a permission — the authority rule (an admin of THIS org), the
// tenancy assertion (the FK is nulled only while it still points at this org),
// the audit row and the notification to the planter all live in
// `removePlantFromOrgAs`, where a request that never opened this dialog meets
// them exactly the same.
//
// THE MATCH IS CASE-INSENSITIVE AND TRIMMED, on purpose — the point is
// deliberateness, not transcription accuracy. Failing somebody who typed their
// own plant's name with a stray trailing space teaches them to copy-paste, which
// defeats the control.
//
// ON SUCCESS THE PAGE IS GONE. The plant leaves `getAccessibleChurchIds` in the
// same write, so this route now 404s for this caller — refreshing in place would
// re-render that 404 as if it were an error. The action revalidates the directory
// and the dialog navigates there, which is also where the admin can see the
// removal took effect.
// ============================================================================

export function RemovePlantDialog({
  churchId,
  plantName,
  orgType,
  orgName,
}: {
  churchId: string;
  plantName: string;
  /** The caller's OWN org — the only one this dialog can name. */
  orgType: AssociationOrgType;
  orgName: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const inputId = useId();

  // The ONE spelling of "network" / "sending church" — this dialog used to keep
  // a third private copy of the table `/oversight/*` already shares.
  const noun = scopeLabelForOrgType(orgType);
  const confirmed =
    confirmation.trim().toLowerCase() === plantName.trim().toLowerCase();

  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setConfirmation("");
      setError(null);
    }
  }

  function remove() {
    setError(null);
    startTransition(async () => {
      const result = await removePlantFromOrg(churchId);
      if (result.success) {
        router.replace("/oversight/plants");
        return;
      }
      setError(result.error);
    });
  }

  return (
    <AlertDialog open={open} onOpenChange={reset}>
      {/*
        RED IS FOR THE BUTTON THAT COMMITS, NOT THE ONE THAT ASKS (design pass,
        #304 "UI ruling round 3"). The trigger wore `text-destructive` while
        doing nothing but opening this dialog; the removal itself is the filled
        destructive button in the footer, which is now the only red control in
        the flow.
      */}
      <AlertDialogTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="shrink-0 cursor-pointer"
        >
          Remove from your {noun}
        </Button>
      </AlertDialogTrigger>

      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Remove {plantName} from {orgName}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            They stop appearing in your church plants directory and you receive
            no further updates about them. Their planter is told. Nothing inside
            their plant is deleted, and you can invite them back later.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          <Label htmlFor={inputId}>
            Type <span className="font-semibold">{plantName}</span> to confirm
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
              would take a refused removal's message down with it. */}
          <Button
            type="button"
            variant="destructive"
            className="cursor-pointer"
            disabled={!confirmed || pending}
            onClick={remove}
          >
            Remove {plantName}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
