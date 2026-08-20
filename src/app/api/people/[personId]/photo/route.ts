import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth";
import { getPerson } from "@/lib/people/service";
import { getFileBytes } from "@/lib/storage";

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
 *  2. No church, or a person outside the caller's church → 404. `getPerson` is
 *     church-scoped, so a foreign `personId` reads as MISSING rather than
 *     forbidden — the same answer a person with no photo gets, and the same
 *     shape the generated-documents read uses (`memory/invariants.md` →
 *     Generated Documents).
 *  3. A row pointing at an object that is gone → 404, so a half-failed
 *     replacement renders the initials fallback instead of a broken image.
 *
 * The key never leaves the server: the client asks for a person, not for a
 * storage key, and gets no signed URL it could pass on.
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
  const person = await getPerson(user.churchId, personId);
  if (!person?.photoUrl) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const file = await getFileBytes(person.photoUrl);
  if (!file) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  return new NextResponse(Buffer.from(file.body), {
    headers: {
      "Content-Type": file.contentType,
      // PRIVATE, and revalidated every time. The photo is personal data behind
      // a session check: a shared cache holding it would serve one church's
      // avatar from another church's request.
      "Cache-Control": "private, no-cache, must-revalidate",
    },
  });
}
