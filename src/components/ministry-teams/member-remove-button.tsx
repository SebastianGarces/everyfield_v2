"use client";

import { useState } from "react";
import { UserMinus } from "lucide-react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { removeMemberAction } from "@/app/(dashboard)/teams/actions";

interface MemberRemoveButtonProps {
  membershipId: string;
  personName: string;
  roleName: string;
}

/**
 * Removes a person from a role (sets the membership inactive). The role frees
 * up to "Open" and the same person can be re-assigned to it afterwards — the
 * partial unique index only constrains active memberships (F8).
 */
export function MemberRemoveButton({
  membershipId,
  personName,
  roleName,
}: MemberRemoveButtonProps) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleRemove() {
    setLoading(true);
    setError(null);
    try {
      const result = await removeMemberAction(membershipId);
      if (result.success) {
        setOpen(false);
      } else {
        setError(result.error);
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setError(null);
      }}
    >
      <AlertDialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="text-muted-foreground hover:text-destructive h-8 w-8 cursor-pointer"
          aria-label={`Remove ${personName} from ${roleName}`}
        >
          <UserMinus className="h-4 w-4" />
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove from role?</AlertDialogTitle>
          <AlertDialogDescription>
            Remove <span className="font-medium">{personName}</span> from the{" "}
            <span className="font-medium">{roleName}</span> role? The role will
            become open and they can be re-assigned later.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {error && (
          <Alert variant="destructive">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer" disabled={loading}>
            Cancel
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={(e) => {
              e.preventDefault();
              handleRemove();
            }}
            disabled={loading}
            className="cursor-pointer"
          >
            {loading ? "Removing..." : "Remove"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
