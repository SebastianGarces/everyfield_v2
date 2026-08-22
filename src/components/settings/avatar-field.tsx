"use client";

// ============================================================================
// The account's profile picture — CS-004, the control half (#617).
//
// NO SAVE STEP. Choosing a file uploads it, and the picture beside the button
// is the confirmation. A second "save" would buy nothing: there is no other
// field on this control to save WITH it, and a picture is the one input whose
// correctness the reader judges by looking at it.
//
// REMOVAL IS THE EXCEPTION THAT ASKS FIRST. An upload somebody regrets is one
// more upload away from fixed. The bytes a removal drops are gone from the
// bucket, and the original is on whatever device it came from — which may be a
// phone that has since been wiped.
//
// "AVATAR" IN THE CODE, "PROFILE PICTURE" ON THE SCREEN. The column, the route
// and the actions all say avatar, so the component does too; CS-004 and the
// people using it say profile picture, so every string does. One word each way,
// and neither leaks into the other.
//
// THE PREVIEW LOGIC IS NOT HERE. `usePendingPicture` owns it — the optimistic
// value, the object URL and the revoke discipline — because the person photo
// field needs exactly the same thing and the two copies had already drifted.
// ============================================================================

import { Loader2, Trash, Upload } from "lucide-react";
import { useCallback, useRef } from "react";
import { toast } from "sonner";

import {
  removeAvatarAction,
  uploadAvatarAction,
} from "@/app/(dashboard)/settings/account/actions";
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
import { usePendingPicture } from "@/components/use-pending-picture";
import {
  PROFILE_PHOTO_MIME_TYPES,
  profilePhotoRefusal,
} from "@/lib/profile-photo";

type AvatarFieldProps = {
  /**
   * The ROUTE the stored picture is served from, or undefined for an account
   * with none.
   *
   * A ROUTE AND NOT THE KEY, and one prop rather than two. This is a client
   * component, so anything it takes is in the RSC payload the browser can read
   * — and the whole point of the private bucket is that a key never gets there.
   * The component needs one more fact than the URL carries ("is a picture
   * set?"), and `undefined` IS that fact: a boolean beside the route would be a
   * second prop that could disagree with the first.
   */
  avatarSrc: string | undefined;
  /** For the fallback, and for naming what a removal is about to drop. */
  initials: string;
  name: string;
};

export function AvatarField({ avatarSrc, initials, name }: AvatarFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const announce = useCallback(
    ({ ok, message }: { ok: boolean; message: string }) =>
      ok ? toast.success(message) : toast.error(message),
    []
  );

  const picture = usePendingPicture({
    storedSrc: avatarSrc,
    refuse: profilePhotoRefusal,
    send: {
      upload: (file) => {
        const formData = new FormData();
        formData.append("avatar", file);
        return uploadAvatarAction(formData);
      },
      remove: removeAvatarAction,
    },
    copy: {
      uploaded: "Profile picture updated",
      removed: "Profile picture removed",
    },
    onSettled: announce,
  });

  const isBusy = picture.inFlight !== null;

  return (
    <div className="flex flex-wrap items-center gap-4">
      <Avatar className="size-20">
        {/* EMPTY ALT, and it is the right call rather than a lazy one. The
            picture carries no information a screen reader could use, and the
            account it belongs to is named twice within a few lines. What a
            reader without sight actually needs to know — whether a picture is
            SET — is carried by the button, which says Upload or Replace. */}
        <AvatarImage src={picture.src} alt="" />
        <AvatarFallback className="text-xl font-semibold">
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
          name="avatar"
          accept={PROFILE_PHOTO_MIME_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid="avatar-input"
          disabled={isBusy}
          onChange={(event) => {
            const file = event.target.files?.[0];
            // Reset the input so re-choosing the same file fires `change` again.
            event.target.value = "";
            if (file) picture.chooseFile(file);
          }}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="cursor-pointer"
            data-testid="avatar-upload"
            disabled={isBusy}
            aria-describedby={picture.error ? "avatar-error" : "avatar-help"}
            onClick={() => inputRef.current?.click()}
          >
            {/* The spinner belongs to the control that owns the work, not to
                whichever one happens to be first in the row. The label does not
                change with it: a control that renames itself mid-request is a
                control the reader has to re-read to find again. */}
            {picture.inFlight === "upload" ? (
              <Loader2
                className="mr-2 size-4 animate-spin"
                aria-hidden="true"
              />
            ) : (
              <Upload className="mr-2 size-4" aria-hidden="true" />
            )}
            {picture.src ? "Replace picture" : "Upload picture"}
          </Button>

          {picture.src && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive cursor-pointer"
                  data-testid="avatar-remove"
                  disabled={isBusy}
                >
                  {picture.inFlight === "remove" ? (
                    <Loader2
                      className="mr-2 size-4 animate-spin"
                      aria-hidden="true"
                    />
                  ) : (
                    <Trash className="mr-2 size-4" aria-hidden="true" />
                  )}
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    Remove your profile picture?
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    This deletes the picture we hold for{" "}
                    <span className="font-semibold">{name}</span>. Your initials
                    show in its place. You can upload another one at any time.
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
                    data-testid="avatar-remove-confirm"
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
            id="avatar-error"
            role="alert"
            className="text-destructive text-sm"
          >
            {picture.error}
          </p>
        ) : (
          <p id="avatar-help" className="text-muted-foreground text-sm">
            JPG, PNG or WebP. Up to 3MB.
          </p>
        )}

        {/* The work itself, for a reader who cannot see the spinner. Rendered
            always and filled when busy: a live region inserted at the moment it
            has something to say is announced unreliably. */}
        <p role="status" aria-live="polite" className="sr-only">
          {picture.inFlight === "upload"
            ? "Uploading your profile picture"
            : picture.inFlight === "remove"
              ? "Removing your profile picture"
              : ""}
        </p>
      </div>
    </div>
  );
}
