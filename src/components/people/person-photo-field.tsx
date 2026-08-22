"use client";

import {
  removePersonPhotoAction,
  uploadPersonPhotoAction,
} from "@/app/(dashboard)/people/actions";
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
  usePendingPicture,
  type PictureOutcome,
} from "@/components/use-pending-picture";
import {
  PROFILE_PHOTO_MIME_TYPES,
  personPhotoSrc,
  profilePhotoRefusal,
} from "@/lib/profile-photo";
import type { PersonForClient } from "@/lib/people/types";
import { Loader2, Trash, Upload } from "lucide-react";
import { useCallback, useRef } from "react";
import { toast } from "sonner";

interface PersonPhotoFieldProps {
  person: PersonForClient;
}

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
 *
 * THE PREVIEW LOGIC IS `usePendingPicture`, shared with the account picture
 * (#617). It used to live here in full, and the copy #617 made of it fixed
 * three things this one never had — an object URL revoked at unmount, a revoke
 * that is not a side effect inside a state updater, and a caught rejection —
 * plus the accessibility this file was missing. Sharing the hook is what stops
 * the next fix landing on one surface again.
 */
export function PersonPhotoField({ person }: PersonPhotoFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const initials =
    `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase();
  const fullName = `${person.firstName} ${person.lastName}`;

  const announce = useCallback(
    ({ ok, message }: { ok: boolean; message: string }) =>
      ok ? toast.success(message) : toast.error(message),
    []
  );

  /** The people actions answer in `ActionResult`; the hook speaks one shape. */
  const asOutcome = (result: {
    success: boolean;
    error?: string;
  }): PictureOutcome =>
    result.success
      ? { ok: true }
      : { ok: false, message: result.error ?? "That did not work" };

  const picture = usePendingPicture({
    storedSrc: personPhotoSrc(person.id, person.photoUrl),
    refuse: profilePhotoRefusal,
    send: {
      upload: async (file) => {
        const formData = new FormData();
        formData.append("photo", file);
        return asOutcome(await uploadPersonPhotoAction(person.id, formData));
      },
      remove: async () => asOutcome(await removePersonPhotoAction(person.id)),
    },
    copy: { uploaded: "Photo updated", removed: "Photo removed" },
    onSettled: announce,
  });

  const isBusy = picture.inFlight !== null;

  return (
    <div className="flex items-center gap-4">
      <Avatar className="h-16 w-16">
        <AvatarImage src={picture.src} alt="" />
        <AvatarFallback className="text-lg font-semibold">
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="space-y-2">
        {/* NOT IN THE TAB ORDER. The button below is the control — it carries
            the name, the focus ring and the busy state — so leaving this
            focusable would put an unlabelled file input in the tab order right
            beside it, announcing nothing. */}
        <input
          ref={inputRef}
          type="file"
          name="photo"
          accept={PROFILE_PHOTO_MIME_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="person-photo-input"
          disabled={isBusy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset the input so re-choosing the same file fires `change` again.
            event.target.value = "";
            if (file) picture.chooseFile(file);
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
            aria-describedby={
              picture.error ? "person-photo-error" : "person-photo-help"
            }
            onClick={() => inputRef.current?.click()}
          >
            {/* The spinner belongs to the control that owns the work, not to
                whichever one happens to be first in the row. */}
            {picture.inFlight === "upload" ? (
              <Loader2
                className="mr-2 h-4 w-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Upload className="mr-2 h-4 w-4" aria-hidden="true" />
            )}
            {picture.src ? "Replace photo" : "Upload photo"}
          </Button>

          {picture.src && (
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
                  {picture.inFlight === "remove" ? (
                    <Loader2
                      className="mr-2 h-4 w-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Trash className="mr-2 h-4 w-4" aria-hidden="true" />
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
                    onClick={picture.removePicture}
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

        {picture.error ? (
          <p
            id="person-photo-error"
            role="alert"
            className="text-destructive text-sm"
            data-testid="person-photo-error"
          >
            {picture.error}
          </p>
        ) : (
          <p id="person-photo-help" className="text-muted-foreground text-xs">
            JPG, PNG or WebP. Up to 3MB.
          </p>
        )}

        {/* The work itself, for a reader who cannot see the spinner. Rendered
            always and filled when busy: a live region inserted at the moment it
            has something to say is announced unreliably. */}
        <p role="status" aria-live="polite" className="sr-only">
          {picture.inFlight === "upload"
            ? "Uploading the photo"
            : picture.inFlight === "remove"
              ? "Removing the photo"
              : ""}
        </p>
      </div>
    </div>
  );
}
