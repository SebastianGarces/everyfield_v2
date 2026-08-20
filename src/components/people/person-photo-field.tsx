"use client";

import { uploadPersonPhotoAction } from "@/app/(dashboard)/people/actions";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  PERSON_PHOTO_MIME_TYPES,
  personPhotoRefusal,
  personPhotoSrc,
} from "@/lib/people/photo";
import type { PersonForClient } from "@/lib/people/types";
import { Loader2, Upload } from "lucide-react";
import { useRef, useState, useTransition } from "react";
import { toast } from "sonner";

interface PersonPhotoFieldProps {
  person: PersonForClient;
}

/**
 * The person photo control on the profile form (P-024a).
 *
 * OUTSIDE the profile `<form>`, and its own server action: a photo is bytes,
 * not a field, and the key it produces is never a value the form may carry
 * (`personUpdateSchema` refuses to have one). Choosing a file uploads it
 * immediately — a second "save" step buys nothing here, and the avatar beside
 * the picker is the confirmation.
 *
 * `preview` is the object URL of the file the planter just chose. That is
 * genuine client state, not a copy of server data: it exists so the new face
 * appears before the round trip finishes, and the revalidated `person` prop
 * carries the stored key from then on.
 */
export function PersonPhotoField({ person }: PersonPhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const initials =
    `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase();

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
        // a POST never saw it. A refusal clears the preview so the avatar goes
        // back to what is actually stored.
        setPreview(null);
        setError(result.error);
        toast.error(result.error);
        return;
      }

      setPreview(URL.createObjectURL(file));
      toast.success("Photo updated");
    });
  };

  return (
    <div className="flex items-center gap-4">
      <Avatar className="h-16 w-16">
        <AvatarImage
          src={preview ?? personPhotoSrc(person.id, person.photoUrl)}
          alt={`${person.firstName} ${person.lastName}`}
        />
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="cursor-pointer"
          disabled={isPending}
          onClick={() => inputRef.current?.click()}
        >
          {isPending ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Upload className="mr-2 h-4 w-4" />
          )}
          {person.photoUrl || preview ? "Replace photo" : "Upload photo"}
        </Button>
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
