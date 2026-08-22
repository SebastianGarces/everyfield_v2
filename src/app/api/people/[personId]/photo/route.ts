import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { getPersonPhotoKey } from "@/lib/people/service";
import { storedImageResponse } from "@/lib/stored-image-response";

// The S3 client needs the Node.js runtime.
export const runtime = "nodejs";

/**
 * GET /api/people/[personId]/photo
 *
 * THE ONLY READ PATH FOR A PERSON PHOTO (P-024a).
 *
 * `persons.photo_url` holds a private-bucket key, and this handler is what
 * turns one into pixels. Three refusals, in this order:
 *
 *  1. No session → 401. The bucket object has no other address a browser can
 *     reach, so an anonymous fetch of a person's photo ends here.
 *  2. No church, or a person outside the caller's church → 404.
 *     `getPersonPhotoKey` is church-scoped, so a foreign `personId` reads as
 *     MISSING rather than forbidden — the same answer a person with no photo
 *     gets, and the same shape the generated-documents read uses
 *     (`memory/invariants.md` → Generated Documents).
 *  3. A row pointing at an object that is gone → 404, so a half-failed
 *     replacement renders the initials fallback instead of a broken image.
 *
 * `read` IS THE CAPABILITY, and it is spelled here rather than imported. In the
 * seat rules `read` is `{ seats: null, tenancy: "any" }` — "a session is the
 * whole rule" — so a `requireSeat("read")` above this would assert exactly what
 * the session check already asserts and then still need the church scoping
 * underneath it to mean anything. The scoping IS the authorization: a person
 * profile is church-visible, so every seat that can be in this church may draw
 * this face, and nobody outside it can. Not `self.write`, which is the account
 * avatar's neighbour and answers a different question (whose row is this?);
 * that route needs no id at all, and this one is an id away from being wrong.
 *
 * A ROUTE HANDLER, so `CAPABILITY_BY_EXPORT` does not reach it — that map
 * covers Server Action exports. Every other handler under `src/app/api` guards
 * the same way, by session plus a scoped read.
 *
 * The key never leaves the server: the client asks for a person, not for a
 * storage key, and gets no signed URL it could pass on. Since #654 it could not
 * ask for one — `PersonForClient` has no `photo_url` to hand over, and this
 * handler reaches the column through the one server-only read that still can.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ personId: string }> }
) {
  const { user } = await getCurrentSession();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!user.churchId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const { personId } = await params;
  const person = await getPersonPhotoKey(user.churchId, personId);

  // Refusals 2 and 3 are one call: `storedImageResponse` answers 404 for a
  // person with no photo AND for a row naming an object the bucket no longer
  // has, which is the same 404 the account avatar route gets from it (#617).
  // The cache header and `nosniff` live there too — they were retyped here, and
  // a header this codebase calls load-bearing is not a string two files should
  // have to keep agreeing about.
  return storedImageResponse(person?.photoKey);
}
