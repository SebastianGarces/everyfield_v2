/**
 * WHERE A PERSON PHOTO IS READ FROM (P-024a).
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
 * Import-free leaf on purpose — the marketing embeds render `PersonCard` too.
 */

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
