"use client";

import {
  removePersonPhotoAction,
  uploadPersonPhotoAction,
} from "@/app/(dashboard)/people/actions";
import { PictureField } from "@/components/picture-field";
import type { PictureOutcome } from "@/components/use-pending-picture";
import type { PersonForClient } from "@/lib/people/types";

interface PersonPhotoFieldProps {
  person: PersonForClient;
}

/**
 * The person photo control on the profile form — the wiring half (P-024a,
 * P-024b, #654).
 *
 * THE MARKUP IS `PictureField`, shared with the account's profile picture. This
 * file is what makes the control a PERSON's: the two Server Actions it calls,
 * the name and initials it draws from the row, and the subject that selects the
 * copy. It used to hold a near-clone of that markup, and the clone had drifted.
 *
 * OUTSIDE the profile `<form>`, and its own server actions: a photo is bytes,
 * not a field, and the key it produces is never a value the form may carry
 * (`personUpdateSchema` refuses to have one).
 *
 * `person.photoSrc` IS A ROUTE, not the stored key (#654). `toPersonForClient`
 * trades one for the other at the boundary, so this component — like every
 * other client surface that draws a face — never holds a bucket key.
 */
export function PersonPhotoField({ person }: PersonPhotoFieldProps) {
  /** The people actions answer in `ActionResult`; `PictureField` speaks one shape. */
  const asOutcome = (result: {
    success: boolean;
    error?: string;
  }): PictureOutcome =>
    result.success
      ? { ok: true }
      : { ok: false, message: result.error ?? "That did not work" };

  return (
    <PictureField
      subject="person"
      src={person.photoSrc}
      initials={`${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase()}
      name={`${person.firstName} ${person.lastName}`}
      send={{
        upload: async (file) => {
          const formData = new FormData();
          formData.append("photo", file);
          return asOutcome(await uploadPersonPhotoAction(person.id, formData));
        },
        remove: async () => asOutcome(await removePersonPhotoAction(person.id)),
      }}
    />
  );
}
