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
import { removeDiscoveryAssociate } from "./discovery-actions";

export function DiscoveryAssociates({
  associates,
  canManage,
}: {
  associates: { userId: string; name: string | null; email: string }[];
  canManage: boolean;
}) {
  if (associates.length === 0)
    return (
      <p className="text-muted-foreground text-sm">
        No discovery associates yet.
      </p>
    );
  return (
    <ul className="divide-y">
      {associates.map((associate) => (
        <li
          key={associate.userId}
          className="flex flex-wrap items-center justify-between gap-3 py-3"
        >
          <div className="min-w-0">
            <p className="font-medium break-words">
              {associate.name || associate.email}
            </p>
            {associate.name && (
              <p className="text-muted-foreground text-sm break-all">
                {associate.email}
              </p>
            )}
            <p className="text-muted-foreground text-sm">
              Discovery account · Associated with your organization
            </p>
          </div>
          {canManage && <RemoveDiscoveryAssociate associate={associate} />}
        </li>
      ))}
    </ul>
  );
}

function RemoveDiscoveryAssociate({
  associate,
}: {
  associate: { userId: string; name: string | null; email: string };
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const id = useId();
  const name = associate.name || associate.email;
  function reset(next: boolean) {
    setOpen(next);
    if (!next) {
      setConfirmation("");
      setError(null);
    }
  }
  function remove() {
    startTransition(async () => {
      setError(null);
      const result = await removeDiscoveryAssociate(
        associate.userId,
        confirmation
      );
      if (result.success) reset(false);
      else setError(result.error);
    });
  }
  return (
    <AlertDialog open={open} onOpenChange={reset}>
      <AlertDialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="cursor-pointer"
          aria-label={`End association with ${name}`}
        >
          End association
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>End association with {name}?</AlertDialogTitle>
          <AlertDialogDescription>
            They leave your discovery associates list and receive a notice.
            Their account stays available to them. A new invitation is needed to
            rejoin.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2">
          <Label htmlFor={id}>Type {name} to confirm</Label>
          <Input
            id={id}
            value={confirmation}
            onChange={(event) => setConfirmation(event.target.value)}
            autoComplete="off"
            aria-describedby={error ? `${id}-error` : undefined}
          />
          {error && (
            <p
              id={`${id}-error`}
              role="alert"
              className="text-destructive text-sm"
            >
              {error}
            </p>
          )}
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel className="cursor-pointer" disabled={pending}>
            Keep association
          </AlertDialogCancel>
          <Button
            variant="destructive"
            className="cursor-pointer"
            disabled={
              pending ||
              confirmation.trim().toLowerCase() !== name.trim().toLowerCase()
            }
            onClick={remove}
          >
            {pending ? "Ending association…" : "End association"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
