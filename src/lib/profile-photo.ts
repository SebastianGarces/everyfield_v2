/**
 * WHAT A PROFILE PHOTO MAY BE, AND WHERE ONE IS READ FROM (P-024a).
 *
 * Two things in this product are a picture of somebody: a PERSON in the
 * directory (`persons.photo_url`) and an ACCOUNT (`users.avatar_key`, #617).
 * Both hold a PRIVATE-BUCKET STORAGE KEY, never a URL, and both are read
 * through a session-checked app route — so the rule for what may be uploaded
 * and the trick that makes a replacement visible are one rule and one trick,
 * spelled once here rather than twice.
 *
 * The alternative was a second copy of `MAX_BYTES` for the account, and that
 * number is not a taste number to hold in two places: it is pinned under
 * `next.config.ts`'s `serverActions.bodySizeLimit`, which is pinned under the
 * serverless platform's own body cap. Two copies drift, and the drift shows up
 * as a bare 413 with no sentence in it.
 *
 * IMPORT-FREE LEAF ON PURPOSE. The rules below are applied from BOTH sides —
 * the picker in the browser refuses a file before it becomes a request, and the
 * server action refuses it again on what it actually received. `src/lib/storage.ts`
 * pulls in the AWS SDK and can never be imported into a client component, so
 * nothing here may reach for it.
 */

// ============================================================================
// What a profile photo may be
// ============================================================================

/** The image types a profile photo may be. */
export const PROFILE_PHOTO_MIME_TYPES = [
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
] as const;

/**
 * The largest photo we accept, and it is a PLATFORM number, not a taste one.
 *
 * A server action's payload is one request body, and both Next (its own
 * `serverActions.bodySizeLimit`) and the serverless platform under it cap that
 * body — the platform at 4.5MB, which nothing in this codebase can raise. Past
 * the cap the upload never reaches the action at all: the reader gets a bare
 * 413 and a console error where a sentence should be. So the limit we PROMISE
 * sits under the limit that exists, `next.config.ts` raises Next's own bound
 * above it, and the refusal below is what a too-large file meets.
 */
export const PROFILE_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Why this file cannot be a profile photo, or `null` if it can.
 *
 * ONE spelling of the rule, read from both sides. The server action calls it on
 * what it received — that call IS the gate, and a POST that never saw the form
 * meets it there. The picker calls it before it sends, because a file the
 * server would refuse should not become a request at all: over the body cap the
 * refusal stops being ours.
 */
export function profilePhotoRefusal(file: {
  type: string;
  size: number;
}): string | null {
  if (
    !(PROFILE_PHOTO_MIME_TYPES as readonly string[]).includes(file.type) ||
    file.size === 0
  ) {
    return "That file is not an image. Use a JPG, PNG or WebP.";
  }

  if (file.size > PROFILE_PHOTO_MAX_BYTES) {
    return "That image is too large. The limit is 3MB.";
  }

  return null;
}

// ============================================================================
// Where a profile photo is read from
// ============================================================================

/**
 * An app route plus the stored key's uuid as a cache buster.
 *
 * The buster is the whole reason this is a function and not a string constant.
 * A replacement puts NEW BYTES BEHIND THE SAME ADDRESS, so without something in
 * the URL that changes with the object, the browser keeps showing the face that
 * was just replaced — from its own cache, with no request for the route to
 * answer. The uuid is fresh on every upload (see `personPhotoStorageKey` and
 * `userAvatarStorageKey`), which makes it exactly the value that changes when
 * and only when the bytes do.
 *
 * The KEY itself never rides along: only its last segment, which names no
 * church and no bucket path.
 */
function versionedSrc(
  route: string,
  key: string | null | undefined
): string | undefined {
  if (!key) return undefined;

  const version = key.split("/").pop() ?? "";
  return `${route}?v=${encodeURIComponent(version)}`;
}

/** The route that serves a person's photo, or `undefined` when there is none. */
export function personPhotoSrc(
  personId: string,
  photoKey: string | null | undefined
): string | undefined {
  return versionedSrc(`/api/people/${personId}/photo`, photoKey);
}

/**
 * The route that serves the SIGNED-IN account's picture, or `undefined` when it
 * has none — in which case the initials fallback renders.
 *
 * NO ACCOUNT ID IN THE ADDRESS, and that is the point: the route answers for
 * whoever holds the session and for nobody else, so there is no id to forge and
 * no id to enumerate. A person photo needs one because a planter reads OTHER
 * people's photos; an account only ever reads its own.
 */
export function userAvatarSrc(
  avatarKey: string | null | undefined
): string | undefined {
  return versionedSrc("/api/account/avatar", avatarKey);
}
