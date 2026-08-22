"use client";

// ============================================================================
// The account's profile picture — CS-004, the wiring half (#617, #654).
//
// THE MARKUP IS `PictureField`, shared with the person photo control. This file
// is what makes the control an ACCOUNT's: the two Server Actions it calls, and
// the subject name that selects the copy. Everything visible lives there, once.
// ============================================================================

import {
  removeAvatarAction,
  uploadAvatarAction,
} from "@/app/(dashboard)/settings/account/actions";
import { PictureField } from "@/components/picture-field";

type AvatarFieldProps = {
  /**
   * The ROUTE the stored picture is served from, or undefined for an account
   * with none. Never the key — `userAvatarSrc` resolves it on the server, and
   * `picture-key-boundary.test.ts` ratchets that.
   */
  avatarSrc: string | undefined;
  /** For the fallback, and for naming what a removal is about to drop. */
  initials: string;
  name: string;
};

export function AvatarField({ avatarSrc, initials, name }: AvatarFieldProps) {
  return (
    <PictureField
      subject="account"
      src={avatarSrc}
      initials={initials}
      name={name}
      send={{
        upload: (file) => {
          const formData = new FormData();
          formData.append("avatar", file);
          return uploadAvatarAction(formData);
        },
        remove: removeAvatarAction,
      }}
    />
  );
}
