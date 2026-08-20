/**
 * WHAT A PERSON PHOTO MAY BE, AND WHERE IT IS READ FROM (P-024a).
 *
 * `persons.photo_url` holds a STORAGE KEY, never a URL. The bucket is private,
 * so a key is not something a browser can fetch and a signed URL is not
 * something we want it to hold: a signed URL is a bearer token, and handing one
 * to the page would make the photo readable by anyone who copied it out of the
 * markup, church membership or no.
 *
 * So the only address the browser ever sees is this app route, which checks the
 * session and scopes the person lookup to the caller's church before it reads a
 * byte. An unauthenticated fetch is 401; another church's person is 404.
 *
 * Import-free leaf on purpose: the marketing embeds render `PersonCard`, and
 * the rules below have to be readable from the BROWSER as well as the action —
 * `src/lib/storage.ts` pulls in the AWS SDK and can never be imported there.
 */

// ============================================================================
// What a photo may be
// ============================================================================

/** The image types a person photo may be. */
export const PERSON_PHOTO_MIME_TYPES = [
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
 * the cap the upload never reaches the action at all: the planter gets a bare
 * 413 and a console error where a sentence should be. So the limit we PROMISE
 * sits under the limit that exists, `next.config.ts` raises Next's own bound
 * above it, and the refusal below is what a too-large file meets.
 */
export const PERSON_PHOTO_MAX_BYTES = 3 * 1024 * 1024;

/**
 * Why this file cannot be a person's photo, or `null` if it can.
 *
 * ONE spelling of the rule, read from both sides. The server action calls it on
 * what it received — that call IS the gate, and a POST that never saw the form
 * meets it there. The picker calls it before it sends, because a file the
 * server would refuse should not become a request at all: over the body cap the
 * refusal stops being ours.
 */
export function personPhotoRefusal(file: {
  type: string;
  size: number;
}): string | null {
  if (
    !(PERSON_PHOTO_MIME_TYPES as readonly string[]).includes(file.type) ||
    file.size === 0
  ) {
    return "That file is not an image. Use a JPG, PNG or WebP.";
  }

  if (file.size > PERSON_PHOTO_MAX_BYTES) {
    return "That image is too large. The limit is 3MB.";
  }

  return null;
}

// ============================================================================
// Where a photo is read from
// ============================================================================

/** The route that serves a person's photo, or `undefined` when there is none. */
export function personPhotoSrc(
  personId: string,
  photoKey: string | null | undefined
): string | undefined {
  if (!photoKey) return undefined;

  // The key's uuid rides along as a cache buster. Without it the browser keeps
  // showing the old avatar after a replacement: the route's address does not
  // change when the object behind it does.
  const version = photoKey.split("/").pop() ?? "";
  return `/api/people/${personId}/photo?v=${encodeURIComponent(version)}`;
}
