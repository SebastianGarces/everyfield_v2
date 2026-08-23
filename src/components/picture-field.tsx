"use client";

import { Loader2, Trash, Upload } from "lucide-react";
import { useRef, type ReactNode } from "react";

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
import { PROFILE_PHOTO_MIME_TYPES } from "@/lib/profile-photo";

// ============================================================================
// THE CONTROL THAT CHANGES A PICTURE — both of them (P-024, #654).
//
// Two surfaces let somebody change a picture: a PERSON's photo on the profile
// form, and an ACCOUNT's own in settings. #617 shared their LOGIC
// (`usePendingPicture`) and left their MARKUP as two ~200-line near-clones —
// deliberately, because merging them changes the person profile and the Vercel
// quota was out, so no browser could prove the merged version right. The quota
// is back and this is that merge.
//
// THE CLONES HAD ALREADY DRIFTED, which is the whole argument for this file.
// Only the newer copy got the accessibility work: the file input out of the tab
// order, `aria-describedby` pointing at the help or the error, the live region
// that announces the upload. A reader of either file could not tell which
// differences were decisions and which were omissions.
//
// SO THE DIFFERENCES BECOME A TABLE. Everything the two surfaces genuinely do
// not share is in `SUBJECTS` below and nowhere else — the copy, and the size.
// A difference not in that table cannot exist, which is what "the drift cannot
// recur" means here. Adding a third picture surface is a row, not a file.
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
// THE PREVIEW LOGIC IS NOT HERE EITHER. `usePendingPicture` owns the optimistic
// value, the object URL and the revoke discipline. This file is the markup and
// the words; that one is the half a reviewer cannot check by eye.
// ============================================================================

/** Whose picture the control changes. The only axis the two surfaces differ on. */
export type PictureSubject = "account" | "person";

type SubjectCopy = {
  /**
   * The prefix for `data-testid` and for the `id`s `aria-describedby` points at.
   * "avatar" and "person-photo" — the spellings the existing tests and the
   * browser gate already use, kept so this merge changes no test's handle.
   */
  id: string;
  /** The picture itself. 80px in the settings identity block, 64px beside the
   *  profile form: the one difference with a layout reason behind it. */
  avatarClass: string;
  fallbackClass: string;
  upload: string;
  replace: string;
  removeTitle: string;
  /** `name` is the account's own name, or the person's — bolded mid-sentence. */
  removeBody: (name: ReactNode) => ReactNode;
  /** For the live region, which is the only account of the work a reader who
   *  cannot see the spinner gets. */
  uploading: string;
  removing: string;
  /** The toasts, handed straight to `usePendingPicture`. */
  uploaded: string;
  removed: string;
};

/**
 * WHOLE SENTENCES, NOT ASSEMBLED ONES.
 *
 * Every string each surface shows, spelled out. The tempting version derives
 * these from a noun ("picture" / "photo") and a possessive, and it very nearly
 * works — but "Remove your profile picture?" against "Remove this photo?" is
 * not one sentence with a hole in it, and a copy edit to one subject should
 * never be a grammar puzzle about the other. Literals also mean every string a
 * reader sees can be found by searching for it.
 *
 * "AVATAR" IN THE CODE, "PROFILE PICTURE" ON THE SCREEN, for the account. The
 * column, the route and the actions all say avatar, so the identifiers do too;
 * CS-004 and the people using it say profile picture, so every string does. One
 * word each way, and this table is the seam where they meet.
 */
const SUBJECTS: Record<PictureSubject, SubjectCopy> = {
  account: {
    id: "avatar",
    avatarClass: "size-20",
    fallbackClass: "text-xl",
    upload: "Upload picture",
    replace: "Replace picture",
    removeTitle: "Remove your profile picture?",
    removeBody: (name) => (
      <>
        This deletes the picture we hold for {name}. Your initials show in its
        place. You can upload another one at any time.
      </>
    ),
    uploading: "Uploading your profile picture",
    removing: "Removing your profile picture",
    uploaded: "Profile picture updated",
    removed: "Profile picture removed",
  },
  person: {
    id: "person-photo",
    avatarClass: "size-16",
    fallbackClass: "text-lg",
    upload: "Upload photo",
    replace: "Replace photo",
    removeTitle: "Remove this photo?",
    removeBody: (name) => (
      <>
        This deletes the photo we hold for {name}. Their initials show in its
        place. You can upload another one at any time.
      </>
    ),
    uploading: "Uploading the photo",
    removing: "Removing the photo",
    uploaded: "Photo updated",
    removed: "Photo removed",
  },
};

type PictureFieldProps = {
  subject: PictureSubject;
  /**
   * The ROUTE the stored picture is served from, or undefined for none.
   *
   * A ROUTE AND NOT THE KEY, and one prop rather than two. This is a client
   * component, so anything it takes is in the RSC payload the browser can read
   * — and the whole point of the private bucket is that a key never gets there
   * (#617 for the account, #654 for the person). The component needs one more
   * fact than the URL carries ("is a picture set?"), and `undefined` IS that
   * fact: a boolean beside the route would be a second prop that could disagree
   * with the first.
   */
  src: string | undefined;
  /** The fallback when there is no picture. */
  initials: string;
  /** Whose picture this is, for the sentence that asks before removing it. */
  name: string;
  send: {
    upload: (file: File) => Promise<PictureOutcome>;
    remove: () => Promise<PictureOutcome>;
  };
};

export function PictureField({
  subject,
  src,
  initials,
  name,
  send,
}: PictureFieldProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const copy = SUBJECTS[subject];

  const picture = usePendingPicture({
    storedSrc: src,
    send,
    copy: { uploaded: copy.uploaded, removed: copy.removed },
  });

  const isBusy = picture.inFlight !== null;
  const errorId = `${copy.id}-error`;
  const helpId = `${copy.id}-help`;

  return (
    <div className="flex flex-wrap items-center gap-4">
      {/* AN EDGE, DRAWN INSIDE. A portrait shot against a white wall has no
          boundary of its own, so without this it bleeds into the card and the
          picture stops reading as one round thing. `outline` rather than
          `border` because the Avatar clips its image to the box — a border
          would be painted over — and the negative offset keeps the ring inside
          the 80px rather than growing the control by two pixels. */}
      <Avatar
        className={`${copy.avatarClass} outline outline-1 -outline-offset-1 outline-black/10`}
      >
        {/* EMPTY ALT, and it is the right call rather than a lazy one. The
            picture carries no information a screen reader could use, and whose
            picture it is is named within a few lines either way. What a reader
            without sight actually needs to know — whether a picture is SET — is
            carried by the button, which says Upload or Replace. */}
        <AvatarImage src={picture.src} alt="" />
        <AvatarFallback className={`${copy.fallbackClass} font-semibold`}>
          {initials}
        </AvatarFallback>
      </Avatar>

      <div className="space-y-2">
        {/* NOT IN THE TAB ORDER. The button below is the control — it carries
            the name, the focus ring and the busy state — so leaving this
            focusable would put an unlabelled file input in the tab order right
            beside it, announcing nothing.

            NO `name`, because this input is not in a form and never was: the
            file is read in `onChange` and appended to a FormData the send
            callback builds. The two copies of this markup carried `avatar` and
            `photo` here, neither of which anything read. */}
        <input
          ref={inputRef}
          type="file"
          accept={PROFILE_PHOTO_MIME_TYPES.join(",")}
          className="sr-only"
          tabIndex={-1}
          aria-hidden="true"
          data-testid={`${copy.id}-input`}
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
            data-testid={`${copy.id}-upload`}
            disabled={isBusy}
            aria-describedby={picture.error ? errorId : helpId}
            onClick={() => inputRef.current?.click()}
          >
            {/* The spinner belongs to the control that owns the work, not to
                whichever one happens to be first in the row. The label does not
                change with it: a control that renames itself mid-request is a
                control the reader has to re-read to find again. */}
            {picture.inFlight === "upload" ? (
              <Loader2 className="animate-spin" aria-hidden="true" />
            ) : (
              <Upload aria-hidden="true" />
            )}
            {picture.src ? copy.replace : copy.upload}
          </Button>

          {picture.src && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-destructive hover:text-destructive cursor-pointer"
                  data-testid={`${copy.id}-remove`}
                  disabled={isBusy}
                >
                  {picture.inFlight === "remove" ? (
                    <Loader2 className="animate-spin" aria-hidden="true" />
                  ) : (
                    <Trash aria-hidden="true" />
                  )}
                  Remove
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>{copy.removeTitle}</AlertDialogTitle>
                  <AlertDialogDescription>
                    {copy.removeBody(
                      <span className="font-semibold">{name}</span>
                    )}
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
                    data-testid={`${copy.id}-remove-confirm`}
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
            id={errorId}
            role="alert"
            className="text-destructive text-sm"
            data-testid={errorId}
          >
            {picture.error}
          </p>
        ) : (
          <p id={helpId} className="text-muted-foreground text-sm">
            JPG, PNG or WebP. Up to 3MB.
          </p>
        )}

        {/* The work itself, for a reader who cannot see the spinner. Rendered
            always and filled when busy: a live region inserted at the moment it
            has something to say is announced unreliably. */}
        <p role="status" aria-live="polite" className="sr-only">
          {picture.inFlight === "upload"
            ? copy.uploading
            : picture.inFlight === "remove"
              ? copy.removing
              : ""}
        </p>
      </div>
    </div>
  );
}
