"use client";

import {
  removePersonPhotoAction,
  uploadPersonPhotoAction,
} from "@/app/(dashboard)/people/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  PROFILE_PHOTO_MIME_TYPES,
  profilePhotoRefusal,
  personPhotoSrc,
} from "@/lib/profile-photo";
import type { PersonForClient } from "@/lib/people/types";
import { Loader2, Trash, Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

interface PersonPhotoFieldProps {
  person: PersonForClient;
}

/**
 * What the planter has just done to the photo, before the round trip that makes
 * it the server's answer.
 *
 * ONE value rather than a preview string beside a `removed` boolean: those two
 * can disagree, and "a preview I also removed" has no meaning. The absent case
 * is `null` — nothing pending, so the stored row is what the avatar shows.
 */
type PendingPhoto =
  | { kind: "uploaded"; objectUrl: string }
  | { kind: "removed" };

/**
 * The person photo control on the profile form (P-024a, P-024b).
 *
 * OUTSIDE the profile `<form>`, and its own server actions: a photo is bytes,
 * not a field, and the key it produces is never a value the form may carry
 * (`personUpdateSchema` refuses to have one). Choosing a file uploads it
 * immediately — a second "save" step buys nothing here, and the avatar beside
 * the picker is the confirmation.
 *
 * Removal is the exception that DOES ask first: an upload the planter regrets
 * is one more upload away from fixed, while the bytes a removal drops are gone
 * from the bucket and the original is on whatever device it came from.
 */
export function PersonPhotoField({ person }: PersonPhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<PendingPhoto | null>(null);
  const [inFlight, setInFlight] = useState<"upload" | "remove" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const initials =
    `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase();
  const fullName = `${person.firstName} ${person.lastName}`;
  const isBusy = inFlight !== null;

  // The pending action outranks the stored row until the revalidation lands,
  // which is what makes a removal show initials at once rather than the face it
  // just deleted.
  const src =
    pending === null
      ? personPhotoSrc(person.id, person.photoUrl)
      : pending.kind === "uploaded"
        ? pending.objectUrl
        : undefined;

  /**
   * The ONE way `pending` moves, because an object URL that is dropped without
   * being revoked strands its bytes for the life of the document — and every
   * transition off an `uploaded` value drops one.
   */
  const settle = (next: PendingPhoto | null) => {
    setPending((current) => {
      if (current?.kind === "uploaded" && current !== next) {
        URL.revokeObjectURL(current.objectUrl);
      }
      return next;
    });
  };

  const handleFile = (file: File) => {
    setError(null);

    // THE SAME RULE THE ACTION APPLIES, applied before the request exists.
    // Not a duplicate of the gate — one function, called from both sides —
    // and it is here because a file over the body cap never reaches the
    // action: the platform answers 413 and the planter gets a console error
    // where a sentence belongs.
    const refusal = profilePhotoRefusal(file);
    if (refusal) {
      setError(refusal);
      toast.error(refusal);
      return;
    }

    const formData = new FormData();
    formData.append("photo", file);

    setInFlight("upload");
    startTransition(async () => {
      try {
        const result = await uploadPersonPhotoAction(person.id, formData);

        if (!result.success) {
          // The server is the gate — the picker's `accept` is a convenience,
          // and a POST never saw it. A refusal drops the pending state so the
          // avatar goes back to what is actually stored.
          settle(null);
          setError(result.error);
          toast.error(result.error);
          return;
        }

        settle({ kind: "uploaded", objectUrl: URL.createObjectURL(file) });
        toast.success("Photo updated");
      } finally {
        setInFlight(null);
      }
    });
  };

  const handleRemove = () => {
    setError(null);

    setInFlight("remove");
    startTransition(async () => {
      try {
        const result = await removePersonPhotoAction(person.id);

        if (!result.success) {
          settle(null);
          setError(result.error);
          toast.error(result.error);
          return;
        }

        settle({ kind: "removed" });
        toast.success("Photo removed");
      } finally {
        setInFlight(null);
      }
    });
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar className="h-16 w-16">
        <AvatarImage src={src} alt={fullName} />
        <AvatarFallback className="text-lg font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="space-y-2">
        <input
          ref={inputRef}
          type="file"
          name="photo"
          accept={PROFILE_PHOTO_MIME_TYPES.join(",")}
          className="sr-only"
          data-testid="person-photo-input"
          disabled={isBusy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset the input so re-choosing the same file fires `change` again.
            event.target.value = "";
            if (file) handleFile(file);
          }}
        />
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            data-testid="person-photo-upload"
            disabled={isBusy}
            onClick={() => inputRef.current?.click()}
          >
            {/* The spinner belongs to the control that owns the work, not to
                whichever one happens to be first in the row. */}
            {inFlight === "upload" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Upload className="mr-2 h-4 w-4" />
            )}
            {src ? "Replace photo" : "Upload photo"}
          </Button>

          {src && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive cursor-pointer"
                  data-testid="person-photo-remove"
                  disabled={isBusy}
                >
                  {inFlight === "remove" ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Trash className="mr-2 h-4 w-4" />
                  )}
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Remove this photo?</AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes the photo we hold for{" "}
                    <span className="font-semibold">{fullName}</span>. Their
                    initials show in its place. You can upload another one at
                    any time.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="cursor-pointer">
                    Cancel
                  </AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleRemove}
                    variant="destructive"
                    className="cursor-pointer"
                    data-testid="person-photo-remove-confirm"
                  >
                    Remove
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </div>
        <p className="text-muted-foreground text-xs">
          JPG, PNG or WebP. Up to 3MB.
        </p>
        {error && (
          <Alert variant="destructive" data-testid="person-photo-error">
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>
    </div>
  );
}
