import { getFileBytes } from "@/lib/storage";

// ============================================================================
// WHAT A STORED PICTURE ANSWERS WITH (P-024).
//
// The body of both photo routes — `/api/people/{id}/photo` and
// `/api/account/avatar` — minus the checks each does first. Those two differ
// entirely in WHO may read (a church-scoped person lookup on one side, the
// session alone on the other) and not at all in what a key turns into, so this
// is the half they share.
//
// ONE SPELLING OF THE CACHE HEADER, and that is the point of the file. It was
// retyped in both routes, which made a header this codebase calls load-bearing
// a string two files had to keep agreeing about. `private` is what keeps a
// shared cache from serving one account's face to another account's request;
// getting it wrong in one route and not the other is a bug no reader would see.
//
// SPLIT FROM THE ROUTES SO IT CAN BE RUN. A route module may export nothing but
// its HTTP verbs and Next's config keys, so a test wanting the response shape
// would have to import a handler whole and stand up a session and a bucket to
// reach it. What is worth asserting — the object's own content type comes back,
// a missing object is a 404 rather than a 500, the cache is private and the
// bytes are not sniffed — needs neither.
// ============================================================================

/** How the bytes are fetched. Injected only by tests; production reads the bucket. */
export type StoredImageReader = (
  key: string
) => Promise<{ body: Uint8Array; contentType: string } | null>;

/**
 * Turn a private-bucket key into pixels, or a 404.
 *
 * A NULL KEY AND A MISSING OBJECT ANSWER THE SAME 404, deliberately. Both mean
 * "no picture to show" to every caller there is, and the initials fallback is
 * what renders for either. The second case is the half-failed replacement P-024
 * tolerates: the row names an object the bucket no longer has, and a 404 makes
 * that a fallback rather than a broken image nothing in the app can repair.
 */
export async function storedImageResponse(
  key: string | null | undefined,
  readBytes: StoredImageReader = getFileBytes
): Promise<Response> {
  const file = key ? await readBytes(key) : null;

  if (!file) {
    return Response.json({ error: "Not found" }, { status: 404 });
  }

  return new Response(Buffer.from(file.body), {
    headers: {
      // The type the object was STORED with, which is the type its uploader
      // declared — so `nosniff` below is doing real work, not ceremony.
      "Content-Type": file.contentType,
      // PRIVATE, and revalidated every time. A face is personal data behind a
      // session check: a shared cache holding it would serve one church's — or
      // one account's — picture from another's request.
      "Cache-Control": "private, no-cache, must-revalidate",
      // Nothing here inspects the bytes: the upload gate reads the type the
      // CLIENT declared, and this reads the type S3 recorded from it. The gate's
      // four-value allow-list keeps that off the sharp edge, but a file whose
      // bytes are HTML or SVG and whose declared type is `image/png` would
      // otherwise be one content-type sniff away from executing on this app's
      // own origin.
      "X-Content-Type-Options": "nosniff",
    },
  });
}
