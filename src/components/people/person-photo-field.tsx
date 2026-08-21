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
  PERSON_PHOTO_MIME_TYPES,
  personPhotoRefusal,
  personPhotoSrc,
} from "@/lib/people/photo";
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
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const initials =
    `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase();
  const fullName = `${person.firstName} ${person.lastName}`;

  // The pending action outranks the stored row until the revalidation lands,
  // which is what makes a removal show initials at once rather than the face it
  // just deleted.
  const src =
    pending === null
      ? personPhotoSrc(person.id, person.photoUrl)
      : pending.kind === "uploaded"
        ? pending.objectUrl
        : undefined;

  const handleFile = (file: File) => {
    setError(null);

    // THE SAME RULE THE ACTION APPLIES, applied before the request exists.
    // Not a duplicate of the gate — one function, called from both sides —
    // and it is here because a file over the body cap never reaches the
    // action: the platform answers 413 and the planter gets a console error
    // where a sentence belongs.
    const refusal = personPhotoRefusal(file);
    if (refusal) {
      setError(refusal);
      toast.error(refusal);
      return;
    }

    const formData = new FormData();
    formData.append("photo", file);

    startTransition(async () => {
      const result = await uploadPersonPhotoAction(person.id, formData);

      if (!result.success) {
        // The server is the gate — the picker's `accept` is a convenience, and
        // a POST never saw it. A refusal drops the pending state so the avatar
        // goes back to what is actually stored.
        setPending(null);
        setError(result.error);
        toast.error(result.error);
        return;
      }

      setPending({ kind: "uploaded", objectUrl: URL.createObjectURL(file) });
      toast.success("Photo updated");
    });
  };

  const handleRemove = () => {
    setError(null);

    startTransition(async () => {
      const result = await removePersonPhotoAction(person.id);

      if (!result.success) {
        setPending(null);
        setError(result.error);
        toast.error(result.error);
        return;
      }

      setPending({ kind: "removed" });
      toast.success("Photo removed");
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
          accept={PERSON_PHOTO_MIME_TYPES.join(",")}
          className="sr-only"
          data-testid="person-photo-input"
          disabled={isPending}
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
            disabled={isPending}
            onClick={() => inputRef.current?.click()}
          >
            {isPending ? (
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
                  disabled={isPending}
                >
                  <Trash className="mr-2 h-4 w-4" />
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
